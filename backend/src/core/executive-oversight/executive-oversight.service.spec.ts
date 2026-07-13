import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleContract } from '../module-registry/module-contract';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { AiResponse } from '../../shared/ai/ai-client.interface';
import { StubAiClient } from '../../shared/ai/stub-ai-client';
import {
  ExecutiveOversightService,
  WeeklyReportRow,
} from './executive-oversight.service';

// The JSON the model is asked to return; StubAiClient plays it back as a
// single text block so parsing is deterministic and no tokens are spent.
const SECTIONS = {
  performance_summary: 'Solid week overall.',
  wins: '- 4 reviews completed at 4.8 stars\n- 3 missed calls recovered',
  issues: '- 2 missed calls still unanswered',
  opportunities: '- Ask happy reviewers for referrals',
  recommendations: '- Keep texting back missed calls within 5 minutes',
};

function finalTurn(): AiResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(SECTIONS) }],
    stop_reason: 'end_turn',
  };
}

function mockModule(
  capabilities: string[],
  headline: { label: string; value: string },
): jest.Mocked<Required<ModuleContract>> {
  return {
    handleRequest: jest.fn(),
    getSnapshot: jest.fn().mockResolvedValue({
      headline,
      metrics: [],
      attention: [],
      recentEvents: [],
    }),
    getStatus: jest.fn().mockResolvedValue({ status: 'connected' }),
    getCapabilities: jest.fn().mockReturnValue(capabilities),
    getQueryableIntents: jest.fn().mockReturnValue([]),
  };
}

describe('ExecutiveOversightService', () => {
  let setupClient: Client;
  let registry: ModuleRegistryService;

  const tenantId = randomUUID();
  const services: ExecutiveOversightService[] = [];

  let reviewModule: jest.Mocked<Required<ModuleContract>>;
  let missedCallModule: jest.Mocked<Required<ModuleContract>>;

  function buildService(script: AiResponse[]): {
    service: ExecutiveOversightService;
    stub: StubAiClient;
  } {
    const stub = new StubAiClient(script);
    const service = new ExecutiveOversightService(registry, stub);
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
    // A week of real activity for each module, all inside the 7-day window.
    await setupClient.query(
      `insert into activity_log (tenant_id, module_key, event_type, value) values
         ($1, 'review-generation', 'review_request_sent', '{"channel":"sms"}'),
         ($1, 'review-generation', 'review_completed', '{"rating":5}'),
         ($1, 'missed-call-textback', 'missed_call_logged', '{"from":"+15551234567"}')`,
      [tenantId],
    );

    registry = new ModuleRegistryService();
  });

  beforeEach(() => {
    reviewModule = mockModule(['How many reviews were requested this week'], {
      label: 'Reviews this week',
      value: '4 completed, 4.8 avg',
    });
    missedCallModule = mockModule(['How many missed calls were recovered'], {
      label: 'Missed calls recovered',
      value: '3 of 5',
    });
    registry.registerModule('review-generation', reviewModule);
    registry.registerModule('missed-call-textback', missedCallModule);
  });

  afterAll(async () => {
    await setupClient.query(
      `delete from executive_oversight.weekly_reports where tenant_id = $1`,
      [tenantId],
    );
    await setupClient.query(`delete from notifications where tenant_id = $1`, [
      tenantId,
    ]);
    await setupClient.query(`delete from activity_log where tenant_id = $1`, [
      tenantId,
    ]);
    await setupClient.query(
      `delete from module_manifest where tenant_id = $1`,
      [tenantId],
    );
    await setupClient.query(`delete from tenants where id = $1`, [tenantId]);
    await setupClient.end();
    await Promise.all(services.map((s) => s.onModuleDestroy()));
    await registry.onModuleDestroy();
  });

  async function storedReport(): Promise<WeeklyReportRow> {
    const result = await setupClient.query<WeeklyReportRow>(
      `select id, week_of, generated_at, status, report_data
         from executive_oversight.weekly_reports where tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0];
  }

  it("assembles every enabled module's snapshot + activity into the model call and stores the report", async () => {
    const { service, stub } = buildService([finalTurn()]);

    const result = await service.generateReport(tenantId);

    expect(result.status).toBe('generated');
    expect(stub.calls).toHaveLength(1);

    // System prompt locks the role and forbids inventing data.
    const system = stub.calls[0].system.toLowerCase();
    expect(system).toContain('operations analyst');
    expect(system).toMatch(/never invent|do not make it/);

    // The user message carries BOTH modules' real data -- snapshot metrics
    // and the week's activity events -- so the model is grounded, not guessing.
    const userContent = stub.calls[0].messages[0].content as string;
    expect(userContent).toContain('review-generation');
    expect(userContent).toContain('4 completed, 4.8 avg');
    expect(userContent).toContain('missed-call-textback');
    expect(userContent).toContain('3 of 5');
    expect(userContent).toContain('review_request_sent');
    expect(userContent).toContain('missed_call_logged');

    // Both modules were consulted for their snapshot.
    expect(reviewModule.getSnapshot).toHaveBeenCalledWith(tenantId);
    expect(missedCallModule.getSnapshot).toHaveBeenCalledWith(tenantId);

    // Stored, parsed into sections, grounded data retained.
    const report = await storedReport();
    expect(report.status).toBe('generated');
    expect(report.report_data.sections?.performance_summary).toBe(
      SECTIONS.performance_summary,
    );
    expect(report.report_data.model).toBe(
      process.env.REPORT_MODEL ?? 'claude-sonnet-5',
    );
    const modules = report.report_data.modules ?? [];
    expect(modules).toHaveLength(2);
    for (const m of modules) {
      expect(m.available).toBe(true);
      expect(m.activity && m.activity.length).toBeGreaterThan(0);
    }
  });

  it("still generates the report when one module's data pull fails, marking only that section unavailable", async () => {
    // The review module's snapshot blows up; the report must survive.
    reviewModule.getSnapshot.mockRejectedValue(new Error('module exploded'));

    const { service, stub } = buildService([finalTurn()]);

    const result = await service.generateReport(tenantId);

    // Whole generation succeeds despite the one broken module.
    expect(result.status).toBe('generated');
    expect(stub.calls).toHaveLength(1);

    const report = await storedReport();
    expect(report.status).toBe('generated');

    const modules = report.report_data.modules ?? [];
    const failed = modules.find((m) => m.moduleKey === 'review-generation');
    const ok = modules.find((m) => m.moduleKey === 'missed-call-textback');

    expect(failed?.available).toBe(false);
    expect(failed?.note).toBe('data unavailable this week');
    expect(ok?.available).toBe(true);
    expect(ok?.value).toBe('3 of 5');

    // The unavailable module's data was still flagged to the model as such.
    const userContent = stub.calls[0].messages[0].content as string;
    expect(userContent).toContain('data unavailable this week');
  });
});
