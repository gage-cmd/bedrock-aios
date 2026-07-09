/**
 * Step 9 test (3): a tenant created through the Onboarding Console gets the
 * exact same Row-Level Security posture as every hand-built tenant. Onboards
 * a tenant end to end (stub SMS + stub invite), then reproduces PostgREST
 * sessions (set role authenticated + request.jwt.claims GUC, as in the
 * tenant-isolation template) to prove:
 *
 *   - EVERY other tenant in the database sees zero of the new tenant's rows,
 *     across users, module_manifest, notifications, and phone numbers;
 *   - the new tenant sees only its own rows -- onboarding grants it no view
 *     into anyone else;
 *   - the rows genuinely exist for the RLS-exempt role, so the zero-row
 *     reads above prove isolation rather than absence.
 */
import { Client } from 'pg';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import type { ModuleContract } from '../module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../shared/messaging/stub-sms-client';
import { OnboardingService } from './onboarding.service';
import { StubInviteClient } from './stub-invite-client';

// The isolation surface is data, not module behavior, so a minimal contract
// stands in for real module services (same approach as the executive
// oversight e2e's demo module). Registered under the REAL module keys so the
// manifest rows match production.
const stubContract: ModuleContract = {
  handleRequest: () => Promise.resolve({}),
  getSnapshot: () => Promise.resolve({ metric: 'x', value: 'y' }),
  getStatus: () => Promise.resolve({ status: 'connected' }),
  getCapabilities: () => [],
};

// Every tenant-scoped table onboarding writes to.
const ISOLATED_TABLES = [
  { table: 'users', column: 'tenant_id' },
  { table: 'module_manifest', column: 'tenant_id' },
  { table: 'notifications', column: 'tenant_id' },
  { table: 'shared_messaging.tenant_phone_numbers', column: 'tenant_id' },
];

describe('onboarded tenant isolation', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let messaging: MessagingService;
  let onboarding: OnboardingService;

  let newTenantId: string;
  let otherTenantIds: string[] = [];

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

    registry = new ModuleRegistryService();
    registry.registerModule('review-generation', stubContract);
    registry.registerModule('missed-call-textback', stubContract);
    messaging = new MessagingService(new StubSmsClient());
    onboarding = new OnboardingService(
      registry,
      messaging,
      new StubInviteClient(),
    );

    // Full onboarding, exactly as the console drives it.
    const created = await onboarding.createTenant({
      name: 'Isolation Flow Tenant',
      contactEmail: 'isolation-owner@example.com',
      plan: 'core',
    });
    newTenantId = created.tenantId;
    await onboarding.enableModules(newTenantId, [
      'review-generation',
      'missed-call-textback',
    ]);
    await onboarding.saveModuleConfig(newTenantId, 'review-generation', {
      businessName: 'Isolation Flow Tenant',
      googleReviewUrl: 'https://g.page/r/isolation/review',
      smsTemplate: 'Thanks from {business_name}!',
    });
    await onboarding.provisionNumber(newTenantId);
    await onboarding.inviteOwner(newTenantId, 'isolation-owner@example.com');
    await onboarding.activate(newTenantId);

    // EVERY other tenant in the database, not a fixture pair.
    const others = await client.query<{ id: string }>(
      `select id from tenants where id != $1`,
      [newTenantId],
    );
    otherTenantIds = others.rows.map((r) => r.id);
  });

  afterAll(async () => {
    await client.query(`delete from notifications where tenant_id = $1`, [
      newTenantId,
    ]);
    await client.query(`delete from users where tenant_id = $1`, [newTenantId]);
    await client.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id = $1`,
      [newTenantId],
    );
    await client.query(`delete from module_manifest where tenant_id = $1`, [
      newTenantId,
    ]);
    await client.query(`delete from subscriptions where tenant_id = $1`, [
      newTenantId,
    ]);
    await client.query(`delete from tenants where id = $1`, [newTenantId]);
    await onboarding.onModuleDestroy();
    await messaging.onModuleDestroy();
    await registry.onModuleDestroy();
    await client.end();
  });

  async function asTenant(tenantId: string) {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ tenant_id: tenantId, role: 'authenticated' }),
    ]);
  }

  async function endSession() {
    await client.query('rollback');
  }

  // One round-trip probing all four tables at once: counts of the NEW
  // tenant's rows visible to whatever session runs it. Keeps the every-tenant
  // sweep below fast enough for a remote pooler under a parallel test run.
  function visibleRowsProbe() {
    return ISOLATED_TABLES.map(
      ({ table, column }) =>
        `select '${table}' as tbl, count(*)::int as n from ${table} where ${column} = $1`,
    ).join(' union all ');
  }

  it("the new tenant's rows genuinely exist for the RLS-exempt role", async () => {
    const result = await client.query<{ tbl: string; n: number }>(
      visibleRowsProbe(),
      [newTenantId],
    );
    for (const row of result.rows) {
      expect({ table: row.tbl, empty: row.n === 0 }).toEqual({
        table: row.tbl,
        empty: false,
      });
    }
  });

  it("EVERY existing tenant sees zero of the new tenant's rows, in every table", async () => {
    expect(otherTenantIds.length).toBeGreaterThan(0);

    for (const otherId of otherTenantIds) {
      await asTenant(otherId);
      const result = await client.query<{ tbl: string; n: number }>(
        visibleRowsProbe(),
        [newTenantId],
      );
      for (const row of result.rows) {
        // Tagged so a failure names the leaking table and tenant.
        expect({ otherId, table: row.tbl, leaked: row.n }).toEqual({
          otherId,
          table: row.tbl,
          leaked: 0,
        });
      }
      await endSession();
    }
    // 30s: the sweep grows with the number of tenants in the database and
    // runs against a remote pooler alongside every other suite.
  }, 30_000);

  it('the new tenant sees only its own rows -- onboarding grants no view into anyone else', async () => {
    await asTenant(newTenantId);
    for (const { table, column } of ISOLATED_TABLES) {
      const all = await client.query<{ tenant_id: string }>(
        `select ${column} as tenant_id from ${table}`,
      );
      const foreign = all.rows.filter((r) => r.tenant_id !== newTenantId);
      expect({ table, foreignRows: foreign.length }).toEqual({
        table,
        foreignRows: 0,
      });
      expect(all.rows.length).toBeGreaterThan(0);
    }
    await endSession();
  });
});
