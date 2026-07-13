import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { AnthropicAiClient } from '../../shared/ai/anthropic-ai-client';
import {
  AiMessageParam,
  AiTool,
  AiToolResultBlock,
  isTextBlock,
  isToolUseBlock,
} from '../../shared/ai/ai-client.interface';
import type { AiClient } from '../../shared/ai/ai-client.interface';

// One orchestrator turn may fan out to several modules; a single slow module
// must degrade into a partial answer, never hang the whole request. Read at
// call time (not module load) so tests can tighten it per-case.
function moduleCallTimeoutMs(): number {
  return Number(process.env.ORCHESTRATOR_MODULE_TIMEOUT_MS ?? 10_000);
}

// Short-TTL cache for module results so repeated or related questions don't
// re-query every module. 10 minutes sits inside the 5-15 minute freshness
// window these weekly-scale metrics tolerate.
function cacheTtlMs(): number {
  return Number(process.env.ORCHESTRATOR_CACHE_TTL_MS ?? 10 * 60 * 1000);
}

const MAX_LOOP_ITERATIONS = 6;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

interface ToolCallRecord {
  module: string;
  action: string;
  ok: boolean;
  fromCache: boolean;
  durationMs: number;
}

interface ModuleTool {
  definition: AiTool;
  allowedActions: Set<string>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`module call timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// The Command Center orchestrator: takes a tenant's natural-language
// question, lets the model pick which enabled module(s) to consult (each
// module is a tool), routes in-process to those modules' contract methods,
// and synthesizes one coherent answer. The system prompt carries business
// context and the capability list ONLY -- raw tenant data reaches the model
// exclusively through tool results the model itself asked for.
@Injectable()
export class OrchestratorService implements OnModuleDestroy {
  private readonly pool = getSharedPool();

  private readonly ai: AiClient;

  private readonly cache = new Map<string, CacheEntry>();

  // Same @Optional() pattern as MessagingService: the param is an interface,
  // only ever passed explicitly (StubAiClient in tests) -- without the
  // decorator Nest tries to resolve a provider for it and crashes at boot.
  constructor(
    private readonly registry: ModuleRegistryService,
    @Optional() aiClient?: AiClient,
  ) {
    this.ai =
      aiClient ??
      new AnthropicAiClient(
        process.env.ORCHESTRATOR_MODEL ?? 'claude-sonnet-5',
      );
  }

  async ask(tenantId: string, question: string): Promise<{ answer: string }> {
    if (!question || !question.trim()) {
      throw new Error('Question is required');
    }

    const [tenantName, tools] = await Promise.all([
      this.getTenantName(tenantId),
      this.buildTools(tenantId),
    ]);

    const system = this.buildSystemPrompt(tenantName, tools);
    const messages: AiMessageParam[] = [{ role: 'user', content: question }];

    const toolCalls: ToolCallRecord[] = [];
    const reasoning: string[] = [];
    let answer = '';

    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
      const response = await this.ai.createMessage({
        system,
        messages,
        tools: tools.map((t) => t.definition),
        usage: { tenantId, moduleKey: 'orchestrator' },
      });

      const textBlocks = response.content.filter(isTextBlock);
      const toolUseBlocks = response.content.filter(isToolUseBlock);

      if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
        answer = textBlocks
          .map((b) => b.text)
          .join('\n')
          .trim();
        break;
      }

      // Text emitted alongside tool calls is the model explaining its routing
      // choice -- keep it for the routing log, not the final answer.
      reasoning.push(...textBlocks.map((b) => b.text));

      // Echo the assistant content back verbatim (including any thinking
      // blocks), then answer every tool_use in a single user message.
      messages.push({ role: 'assistant', content: response.content });

      const results: AiToolResultBlock[] = await Promise.all(
        toolUseBlocks.map((block) =>
          this.executeToolCall(tenantId, tools, block.name, block.input).then(
            (outcome) => {
              toolCalls.push(outcome.record);
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: outcome.content,
                ...(outcome.record.ok ? {} : { is_error: true }),
              };
            },
          ),
        ),
      );

      messages.push({ role: 'user', content: results });
    }

    await this.logRoutingDecision(tenantId, question, toolCalls, reasoning);

    return { answer };
  }

  private async executeToolCall(
    tenantId: string,
    tools: ModuleTool[],
    moduleKey: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; record: ToolCallRecord }> {
    const action = typeof input.action === 'string' ? input.action : '';
    const limit = typeof input.limit === 'number' ? input.limit : undefined;
    const startedAt = Date.now();

    const record = (ok: boolean, fromCache = false): ToolCallRecord => ({
      module: moduleKey,
      action,
      ok,
      fromCache,
      durationMs: Date.now() - startedAt,
    });

    const tool = tools.find((t) => t.definition.name === moduleKey);
    if (!tool || !tool.allowedActions.has(action)) {
      return {
        content: `Unknown module or action: ${moduleKey}/${action}. Use only the tools and actions provided.`,
        record: record(false),
      };
    }

    const cacheKey = `${tenantId}:${moduleKey}:${action}:${limit ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        content: JSON.stringify(cached.value),
        record: record(true, true),
      };
    }

    try {
      const value = await withTimeout(
        this.callModule(tenantId, moduleKey, action, limit),
        moduleCallTimeoutMs(),
      );
      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + cacheTtlMs(),
      });
      return { content: JSON.stringify(value), record: record(true) };
    } catch (err) {
      // Graceful degradation: the failure becomes an is_error tool result the
      // model can acknowledge in a partial answer, never a failed response.
      console.error(
        `[orchestrator] module "${moduleKey}" action "${action}" failed for tenant ${tenantId}:`,
        err instanceof Error ? err.message : err,
      );
      return {
        content: `This data source is temporarily unavailable. Answer with what you have from other sources and note that this part could not be checked right now.`,
        record: record(false),
      };
    }
  }

  private callModule(
    tenantId: string,
    moduleKey: string,
    action: string,
    limit?: number,
  ): Promise<unknown> {
    const instance = this.registry.getModuleInstance(moduleKey);
    if (!instance) {
      return Promise.reject(new Error(`Module ${moduleKey} is not registered`));
    }
    if (action === 'snapshot') {
      return instance.getSnapshot(tenantId);
    }
    if (action === 'status') {
      return instance.getStatus(tenantId);
    }
    return instance.handleRequest(
      tenantId,
      action,
      limit === undefined ? undefined : { limit },
    );
  }

  private async buildTools(tenantId: string): Promise<ModuleTool[]> {
    const capabilities = await this.registry.getCapabilitiesForTenant(tenantId);

    const byModule = new Map<string, string[]>();
    for (const { moduleKey, capability } of capabilities) {
      const list = byModule.get(moduleKey) ?? [];
      list.push(capability);
      byModule.set(moduleKey, list);
    }

    const tools: ModuleTool[] = [];
    for (const [moduleKey, moduleCapabilities] of byModule) {
      const instance = this.registry.getModuleInstance(moduleKey);
      if (!instance) continue;

      const intents = instance.getQueryableIntents?.() ?? [];
      const actions = [
        {
          intent: 'snapshot',
          description: "This week's headline metric for this area.",
        },
        {
          intent: 'status',
          description: 'Whether this area is fully set up and running.',
        },
        ...intents,
      ];

      tools.push({
        definition: {
          name: moduleKey,
          description:
            `Consult this data source when the question is about: ${moduleCapabilities.join('; ')}. ` +
            `Actions: ${actions.map((a) => `"${a.intent}" (${a.description})`).join(' ')}`,
          input_schema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: actions.map((a) => a.intent),
                description: 'Which data to fetch from this source.',
              },
              limit: {
                type: 'number',
                description: 'Optional max number of records for list actions.',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
        },
        allowedActions: new Set(actions.map((a) => a.intent)),
      });
    }
    return tools;
  }

  // Business context + capability list only. Raw tenant data (contacts,
  // reviews, call logs) must never be embedded here -- it reaches the model
  // only through tool results.
  private buildSystemPrompt(tenantName: string, tools: ModuleTool[]): string {
    const capabilityLines = tools
      .map((t) => `- ${t.definition.name}: ${t.definition.description}`)
      .join('\n');

    return [
      `You are the Command Center assistant for ${tenantName}, a local business.`,
      `You answer the business owner's questions about how their business is performing, using ONLY data fetched through the tools below. Never invent numbers, names, or events.`,
      tools.length > 0
        ? `Available data sources and what they can answer:\n${capabilityLines}`
        : `No data sources are currently connected for this business.`,
      `Rules:`,
      `- If the question matches one or more data sources, fetch what you need (from several sources if the question spans them) and synthesize one coherent answer in plain business language.`,
      `- If a data source reports it is temporarily unavailable, answer with what you did get and say plainly which part you could not check.`,
      `- If the question is unrelated to every data source above, say you can only answer questions about the business areas listed and briefly name them. Do not call any tool and do not guess.`,
      `- Speak about the business's results (calls, reviews, customers, revenue). Never mention tools, modules, systems, or AI in your answer.`,
      `- Be concise: a direct answer first, then only the details that matter.`,
      `- Write in plain conversational text. No markdown, no asterisks, no headers.`,
    ].join('\n\n');
  }

  private async getTenantName(tenantId: string): Promise<string> {
    const result = await this.pool.query<{ name: string }>(
      'select name from tenants where id = $1',
      [tenantId],
    );
    const name = result.rows[0]?.name;
    if (!name) {
      throw new Error('Unknown tenant');
    }
    return name;
  }

  // Required audit trail for reviewing routing accuracy: every question, the
  // module calls the model chose (or none), and the model's stated reasoning.
  private async logRoutingDecision(
    tenantId: string,
    question: string,
    toolCalls: ToolCallRecord[],
    reasoning: string[],
  ): Promise<void> {
    const modulesCalled = [...new Set(toolCalls.map((c) => c.module))];
    try {
      await this.pool.query(
        `insert into activity_log (tenant_id, module_key, event_type, value) values ($1, 'orchestrator', 'orchestrator_routing_decision', $2)`,
        [
          tenantId,
          JSON.stringify({
            question,
            modulesCalled,
            toolCalls,
            reasoning: reasoning.join('\n'),
          }),
        ],
      );
    } catch (err) {
      // The answer is already synthesized; a logging failure must not turn a
      // good response into an error. Surface it loudly instead.
      console.error('[orchestrator] failed to write routing decision:', err);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async onModuleDestroy(): Promise<void> {
    await closeSharedPool();
  }
}
