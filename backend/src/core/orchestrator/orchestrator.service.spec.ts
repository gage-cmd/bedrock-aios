import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleContract } from '../module-registry/module-contract';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import {
  AiResponse,
  AiToolResultBlock,
} from '../../shared/ai/ai-client.interface';
import { OrchestratorService } from './orchestrator.service';
import { StubAiClient } from '../../shared/ai/stub-ai-client';

function text(t: string): { type: 'text'; text: string } {
  return { type: 'text', text: t };
}

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
} {
  return { type: 'tool_use', id, name, input };
}

function toolTurn(...blocks: AiResponse['content']): AiResponse {
  return { content: blocks, stop_reason: 'tool_use' };
}

function finalTurn(answer: string): AiResponse {
  return { content: [text(answer)], stop_reason: 'end_turn' };
}

function lastToolResults(stub: StubAiClient): AiToolResultBlock[] {
  const lastCall = stub.calls[stub.calls.length - 1];
  const lastMessage = lastCall.messages[lastCall.messages.length - 1];
  return lastMessage.content as AiToolResultBlock[];
}

describe('OrchestratorService', () => {
  let setupClient: Client;
  let registry: ModuleRegistryService;

  const tenantId = randomUUID();
  const services: OrchestratorService[] = [];

  let reviewModule: jest.Mocked<Required<ModuleContract>>;
  let missedCallModule: jest.Mocked<Required<ModuleContract>>;

  function buildService(script: AiResponse[]): {
    service: OrchestratorService;
    stub: StubAiClient;
  } {
    const stub = new StubAiClient(script);
    const service = new OrchestratorService(registry, stub);
    services.push(service);
    return { service, stub };
  }

  beforeAll(async () => {
    setupClient = new Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await setupClient.connect();

    await setupClient.query(
      `insert into tenants (id, name, status) values ($1, 'Bright Smiles Dental', 'active')`,
      [tenantId],
    );
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values
         ($1, 'review-generation', true, '{}'),
         ($1, 'missed-call-textback', true, '{}')`,
      [tenantId],
    );

    registry = new ModuleRegistryService();
  });

  beforeEach(() => {
    reviewModule = {
      handleRequest: jest
        .fn()
        .mockResolvedValue([{ rating: 5, feedback_text: 'Great' }]),
      getSnapshot: jest.fn().mockResolvedValue({
        headline: { label: 'Reviews this week', value: '2 completed, 4.5★ avg' },
        metrics: [],
        attention: [],
        recentEvents: [],
      }),
      getStatus: jest.fn().mockResolvedValue({ status: 'connected' }),
      getCapabilities: jest
        .fn()
        .mockReturnValue([
          'How many reviews were requested this week',
          "What's our average rating",
        ]),
      getQueryableIntents: jest.fn().mockReturnValue([
        {
          intent: 'get-recent-responses',
          description: 'Recent review responses.',
        },
      ]),
    };
    missedCallModule = {
      handleRequest: jest
        .fn()
        .mockResolvedValue([
          { contact_phone: '+15550001111', textback_sent: true },
        ]),
      getSnapshot: jest.fn().mockResolvedValue({
        headline: {
          label: 'Missed calls recovered this week',
          value: '3 text-backs sent',
        },
        metrics: [],
        attention: [],
        recentEvents: [],
      }),
      getStatus: jest.fn().mockResolvedValue({ status: 'connected' }),
      getCapabilities: jest
        .fn()
        .mockReturnValue(['How many missed calls did we recover this week']),
      getQueryableIntents: jest.fn().mockReturnValue([
        {
          intent: 'get-recent-missed-calls',
          description: 'Recent missed calls.',
        },
      ]),
    };
    registry.registerModule('review-generation', reviewModule);
    registry.registerModule('missed-call-textback', missedCallModule);
    delete process.env.ORCHESTRATOR_MODULE_TIMEOUT_MS;
  });

  afterAll(async () => {
    await setupClient.query(`delete from activity_log where tenant_id = $1`, [
      tenantId,
    ]);
    await setupClient.query(
      `delete from module_manifest where tenant_id = $1`,
      [tenantId],
    );
    await setupClient.query(`delete from tenants where id = $1`, [tenantId]);
    await setupClient.end();
    for (const service of services) {
      await service.onModuleDestroy();
    }
    await registry.onModuleDestroy();
  });

  it('routes a single-module question to that module and returns the synthesized answer', async () => {
    const { service, stub } = buildService([
      toolTurn(
        text('Checking review data.'),
        toolUse('t1', 'review-generation', { action: 'snapshot' }),
      ),
      finalTurn('You collected 2 reviews this week with a 4.5 star average.'),
    ]);

    const { answer } = await service.ask(
      tenantId,
      'How are our reviews doing this week?',
    );

    expect(answer).toBe(
      'You collected 2 reviews this week with a 4.5 star average.',
    );
    expect(reviewModule.getSnapshot).toHaveBeenCalledWith(tenantId);
    expect(missedCallModule.getSnapshot).not.toHaveBeenCalled();
    expect(missedCallModule.handleRequest).not.toHaveBeenCalled();

    // The tool result fed back to the model is the module's real payload.
    const results = lastToolResults(stub);
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBeUndefined();
    expect(JSON.parse(results[0].content)).toEqual({
      headline: { label: 'Reviews this week', value: '2 completed, 4.5★ avg' },
      metrics: [],
      attention: [],
      recentEvents: [],
    });
  });

  it('exposes one tool per enabled module, and a system prompt with business context and capabilities but no tenant data', async () => {
    const { service, stub } = buildService([finalTurn('Hi!')]);

    await service.ask(tenantId, 'Hello');

    const call = stub.calls[0];
    expect(call.tools.map((t) => t.name).sort()).toEqual([
      'missed-call-textback',
      'review-generation',
    ]);
    expect(call.system).toContain('Bright Smiles Dental');
    expect(call.system).toContain('How many reviews were requested this week');
    expect(call.system).toContain(
      'How many missed calls did we recover this week',
    );
    // No raw tenant data in the prompt -- it only arrives via tool results.
    expect(call.system).not.toContain('4.5');
    expect(call.system).not.toContain('+1555');
  });

  it('consults multiple modules for a question spanning both and returns one combined answer', async () => {
    const { service, stub } = buildService([
      toolTurn(
        toolUse('t1', 'review-generation', { action: 'snapshot' }),
        toolUse('t2', 'missed-call-textback', { action: 'snapshot' }),
      ),
      finalTurn('2 reviews at 4.5 stars, and 3 missed calls recovered.'),
    ]);

    const { answer } = await service.ask(
      tenantId,
      'Give me a full performance summary for this week.',
    );

    expect(answer).toBe(
      '2 reviews at 4.5 stars, and 3 missed calls recovered.',
    );
    expect(reviewModule.getSnapshot).toHaveBeenCalledWith(tenantId);
    expect(missedCallModule.getSnapshot).toHaveBeenCalledWith(tenantId);

    // Both tool_results answered in a single user message.
    const results = lastToolResults(stub);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.is_error)).toEqual([undefined, undefined]);
  });

  it('degrades gracefully when a module throws mid-question: is_error tool result, partial answer, no failed response', async () => {
    missedCallModule.getSnapshot.mockRejectedValue(
      new Error('database exploded'),
    );
    const { service, stub } = buildService([
      toolTurn(
        toolUse('t1', 'review-generation', { action: 'snapshot' }),
        toolUse('t2', 'missed-call-textback', { action: 'snapshot' }),
      ),
      finalTurn(
        'Reviews look great; missed-call data is unavailable right now.',
      ),
    ]);

    const { answer } = await service.ask(
      tenantId,
      'How did we do this week overall?',
    );

    expect(answer).toBe(
      'Reviews look great; missed-call data is unavailable right now.',
    );
    const results = lastToolResults(stub);
    const failed = results.find((r) => r.tool_use_id === 't2');
    const succeeded = results.find((r) => r.tool_use_id === 't1');
    expect(failed?.is_error).toBe(true);
    expect(failed?.content).toContain('temporarily unavailable');
    expect(succeeded?.is_error).toBeUndefined();
  });

  it('turns a hung module call into a timeout error result instead of hanging the request', async () => {
    process.env.ORCHESTRATOR_MODULE_TIMEOUT_MS = '200';
    reviewModule.getSnapshot.mockReturnValue(new Promise(() => {}));
    const { service, stub } = buildService([
      toolTurn(toolUse('t1', 'review-generation', { action: 'snapshot' })),
      finalTurn('Review data could not be checked right now.'),
    ]);

    const { answer } = await service.ask(tenantId, 'How are reviews?');

    expect(answer).toBe('Review data could not be checked right now.');
    const results = lastToolResults(stub);
    expect(results[0].is_error).toBe(true);
  });

  it('serves repeated module calls from the short-TTL cache', async () => {
    const script = [
      toolTurn(toolUse('t1', 'review-generation', { action: 'snapshot' })),
      finalTurn('First answer.'),
      toolTurn(toolUse('t2', 'review-generation', { action: 'snapshot' })),
      finalTurn('Second answer.'),
    ];
    const { service } = buildService(script);

    await service.ask(tenantId, 'How are reviews?');
    await service.ask(tenantId, 'And how are those reviews again?');

    // Second ask hit the cache -- the module itself was only queried once.
    expect(reviewModule.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('logs every routing decision with question, modules called, and reasoning', async () => {
    const question = `Routing log test ${randomUUID()}`;
    const { service } = buildService([
      toolTurn(
        text('The question is about reviews, so I will check review data.'),
        toolUse('t1', 'review-generation', {
          action: 'get-recent-responses',
          limit: 5,
        }),
      ),
      finalTurn('Here is your recent feedback.'),
    ]);

    await service.ask(tenantId, question);

    const { rows } = await setupClient.query<{
      value: {
        question: string;
        modulesCalled: string[];
        toolCalls: { module: string; action: string; ok: boolean }[];
        reasoning: string;
      };
    }>(
      `select value from activity_log
       where tenant_id = $1 and module_key = 'orchestrator' and event_type = 'orchestrator_routing_decision'
         and value ->> 'question' = $2`,
      [tenantId, question],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].value.modulesCalled).toEqual(['review-generation']);
    expect(rows[0].value.toolCalls[0]).toMatchObject({
      module: 'review-generation',
      action: 'get-recent-responses',
      ok: true,
    });
    expect(rows[0].value.reasoning).toContain('about reviews');
    expect(reviewModule.handleRequest).toHaveBeenCalledWith(
      tenantId,
      'get-recent-responses',
      { limit: 5 },
    );
  });

  it('answers an off-topic question directly without calling any module, and logs the empty routing decision', async () => {
    const question = `Off topic test ${randomUUID()}`;
    const { service } = buildService([
      finalTurn(
        'I can only answer questions about your reviews and missed calls.',
      ),
    ]);

    const { answer } = await service.ask(tenantId, question);

    expect(answer).toContain('reviews and missed calls');
    expect(reviewModule.getSnapshot).not.toHaveBeenCalled();
    expect(reviewModule.handleRequest).not.toHaveBeenCalled();
    expect(missedCallModule.getSnapshot).not.toHaveBeenCalled();
    expect(missedCallModule.handleRequest).not.toHaveBeenCalled();

    const { rows } = await setupClient.query<{
      value: { modulesCalled: string[] };
    }>(
      `select value from activity_log
       where tenant_id = $1 and event_type = 'orchestrator_routing_decision' and value ->> 'question' = $2`,
      [tenantId, question],
    );
    expect(rows[0].value.modulesCalled).toEqual([]);
  });

  it('refuses actions a module never advertised (write intents stay unreachable)', async () => {
    const { service, stub } = buildService([
      toolTurn(
        toolUse('t1', 'review-generation', { action: 'send-review-request' }),
      ),
      finalTurn('I cannot send messages, only report on results.'),
    ]);

    await service.ask(tenantId, 'Send a review request to Jane');

    expect(reviewModule.handleRequest).not.toHaveBeenCalled();
    const results = lastToolResults(stub);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('Unknown module or action');
  });

  it('rejects an empty question', async () => {
    const { service } = buildService([]);

    await expect(service.ask(tenantId, '   ')).rejects.toThrow(
      'Question is required',
    );
  });
});
