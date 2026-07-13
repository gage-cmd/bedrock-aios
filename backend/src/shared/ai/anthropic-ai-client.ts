import Anthropic from '@anthropic-ai/sdk';
import {
  AiContentBlock,
  AiCreateMessageParams,
  AiResponse,
  AiUsageContext,
} from './ai-client.interface';
import type { AiClient } from './ai-client.interface';
import { getSharedPool } from '../db/pg-pool';

// USD per million tokens, by model. Source: platform.claude.com pricing,
// checked 2026-07-13 (claude-sonnet-5 sticker price; an intro discount runs
// through 2026-08-31, so recorded cost is an upper bound until then).
// Override or extend per-deployment without a code change via AI_PRICING_JSON,
// e.g. '{"claude-sonnet-5":{"input":2,"output":10}}'.
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

function pricingFor(
  model: string,
): { input: number; output: number } | null {
  const overrides = process.env.AI_PRICING_JSON;
  if (overrides) {
    try {
      const parsed = JSON.parse(overrides) as Record<
        string,
        { input: number; output: number }
      >;
      if (parsed[model]) return parsed[model];
    } catch {
      console.error('[ai-client] AI_PRICING_JSON is not valid JSON; ignoring');
    }
  }
  return DEFAULT_PRICING[model] ?? null;
}

// Real AiClient backed by the Anthropic Messages API, shared by every caller
// that needs the model (the Command Center orchestrator and the Executive
// Oversight report engine). The model is supplied by the caller's
// constructor -- each caller reads its own env var (ORCHESTRATOR_MODEL,
// REPORT_MODEL) so the model is never hardcoded at the call site. Auth comes
// from ANTHROPIC_API_KEY, which the SDK reads from the environment itself.
// claude-sonnet-5 notes: adaptive thinking is on by default (thinking blocks
// may appear in content and are passed through untouched so the loop can echo
// them back), and sampling params like temperature are rejected -- none sent.
export class AnthropicAiClient implements AiClient {
  private readonly client = new Anthropic();

  constructor(private readonly model: string) {}

  async createMessage(params: AiCreateMessageParams): Promise<AiResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: params.tools as unknown as Anthropic.Tool[],
    });

    if (params.usage) {
      // Fire-and-forget on purpose: usage accounting must never delay or
      // fail the answer the caller is waiting on.
      void this.recordUsage(params.usage, response.usage);
    }

    return {
      content: response.content as AiContentBlock[],
      stop_reason: response.stop_reason,
    };
  }

  // One usage_logs row per API call: total tokens processed and the dollar
  // cost at this model's list price. Cache reads bill at 0.1x input and cache
  // writes at 1.25x input, so cost is computed per bucket while tokens_used
  // stays the plain total processed.
  private async recordUsage(
    context: AiUsageContext,
    usage: Anthropic.Usage,
  ): Promise<void> {
    try {
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;

      const price = pricingFor(this.model);
      const cost = price
        ? (input * price.input +
            cacheWrite * price.input * 1.25 +
            cacheRead * price.input * 0.1 +
            output * price.output) /
          1_000_000
        : 0;
      if (!price) {
        console.error(
          `[ai-client] no pricing for model "${this.model}"; recording cost 0 (set AI_PRICING_JSON)`,
        );
      }

      await getSharedPool().query(
        `insert into usage_logs (tenant_id, module_key, event_type, tokens_used, cost)
         values ($1, $2, 'model_call', $3, $4)`,
        [
          context.tenantId,
          context.moduleKey,
          input + cacheWrite + cacheRead + output,
          cost.toFixed(4),
        ],
      );
    } catch (err) {
      console.error(
        `[ai-client] failed to record usage for tenant ${context.tenantId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
