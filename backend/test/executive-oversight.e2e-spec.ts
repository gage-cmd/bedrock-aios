import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleContract } from '../src/core/module-registry/module-contract';
import { ModuleRegistryService } from '../src/core/module-registry/module-registry.service';
import { AiResponse } from '../src/shared/ai/ai-client.interface';
import { StubAiClient } from '../src/shared/ai/stub-ai-client';
import { ExecutiveOversightService } from '../src/core/executive-oversight/executive-oversight.service';

// End-to-end (real DB, real registry, generation triggered manually): seed a
// demo tenant's week of activity, generate its report, and confirm both that
// the report is stored AND that a "report ready" notification fires. Only the
// AI call is stubbed -- no tokens spent -- so this proves the whole
// data-assembly -> store -> notify path against Postgres.
const SECTIONS = {
  performance_summary: 'A strong week for reviews.',
  wins: '- 5 reviews completed at 4.9 stars',
  issues: '',
  opportunities: '- Turn happy reviewers into referrals',
  recommendations: '- Keep requesting a review after every visit',
};

function finalTurn(): AiResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(SECTIONS) }],
    stop_reason: 'end_turn',
  };
}

// A minimal demo module registered under a real module key, so the registry's
// getCapabilitiesForTenant returns it and the engine pulls its snapshot.
const demoModule: ModuleContract = {
  handleRequest: () => Promise.resolve({}),
  getSnapshot: () =>
    Promise.resolve({
      metric: 'Reviews this week',
      value: '5 completed, 4.9 avg',
    }),
  getStatus: () => Promise.resolve({ status: 'connected' }),
  getCapabilities: () => ['How many reviews were requested this week'],
};

describe('Executive Oversight report generation (e2e)', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let service: ExecutiveOversightService;

  const tenantId = randomUUID();

  beforeAll(async () => {
    client = new Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Demo Co e2e', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config)
         values ($1, 'review-generation', true, '{}')`,
      [tenantId],
    );
    await client.query(
      `insert into activity_log (tenant_id, module_key, event_type, value) values
         ($1, 'review-generation', 'review_request_sent', '{"channel":"sms"}'),
         ($1, 'review-generation', 'review_completed', '{"rating":5}')`,
      [tenantId],
    );

    registry = new ModuleRegistryService();
    registry.registerModule('review-generation', demoModule);
    service = new ExecutiveOversightService(
      registry,
      new StubAiClient([finalTurn()]),
    );
  });

  afterAll(async () => {
    await client.query(
      `delete from executive_oversight.weekly_reports where tenant_id = $1`,
      [tenantId],
    );
    await client.query(`delete from notifications where tenant_id = $1`, [
      tenantId,
    ]);
    await client.query(`delete from activity_log where tenant_id = $1`, [
      tenantId,
    ]);
    await client.query(`delete from module_manifest where tenant_id = $1`, [
      tenantId,
    ]);
    await client.query(`delete from tenants where id = $1`, [tenantId]);
    await service.onModuleDestroy();
    await registry.onModuleDestroy();
    await client.end();
  });

  it('stores a report and fires a notification when generation is triggered', async () => {
    const result = await service.generateReport(tenantId);
    expect(result.status).toBe('generated');

    // A report row is stored for this tenant's current week, parsed into
    // sections and grounded in the demo module's data.
    const reports = await client.query<{
      status: string;
      report_data: {
        sections: { performance_summary: string };
        modules: { value?: string }[];
      };
    }>(
      `select status, report_data from executive_oversight.weekly_reports where tenant_id = $1`,
      [tenantId],
    );
    expect(reports.rows).toHaveLength(1);
    expect(reports.rows[0].status).toBe('generated');
    expect(reports.rows[0].report_data.sections.performance_summary).toBe(
      SECTIONS.performance_summary,
    );
    expect(reports.rows[0].report_data.modules[0].value).toBe(
      '5 completed, 4.9 avg',
    );

    // A notification fired with the exact, brand-safe copy -- no mention of
    // AI, agents, modules, or systems.
    const notifications = await client.query<{ title: string; body: string }>(
      `select title, body from notifications where tenant_id = $1`,
      [tenantId],
    );
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0].title).toBe(
      'Your weekly business report is ready.',
    );
    const copy = `${notifications.rows[0].title} ${notifications.rows[0].body}`;
    expect(copy).not.toMatch(/\b(AI|agent|module|system|bot)\b/i);
  });
});
