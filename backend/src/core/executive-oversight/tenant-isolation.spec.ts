/**
 * Copied from core/tenant-resolver/tenant-isolation.template.spec.ts and
 * adapted for executive_oversight.weekly_reports.
 *
 * Proves that cross-tenant reads of a tenant's weekly reports are blocked by
 * Postgres Row-Level Security itself, not by an application-level WHERE
 * clause. Connects directly to Postgres (bypassing PostgREST/Supabase Auth)
 * and reproduces exactly what PostgREST does when it serves an authenticated
 * request: it switches into the `authenticated` role and sets the
 * `request.jwt.claims` session GUC, which is what the `tenant_isolation`
 * policy reads via `auth.jwt()`.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

interface WeeklyReportRow {
  tenant_id: string;
  week_of: string;
  status: string;
}

describe('tenant isolation (executive_oversight.weekly_reports)', () => {
  let client: Client;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const weekOf = '2026-06-29';

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

    // Two fake tenants, one weekly_reports row each. Run as the pooler's
    // default role (postgres), which bypasses RLS, so setup itself isn't
    // subject to the policy under test.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Isolation Test Tenant A', 'active'), ($2, 'Isolation Test Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );
    await client.query(
      `insert into executive_oversight.weekly_reports (tenant_id, week_of, generated_at, report_data, status)
         values ($1, $3, now(), '{"sections":{}}'::jsonb, 'generated'),
                ($2, $3, now(), '{"sections":{}}'::jsonb, 'generated')`,
      [tenantAId, tenantBId, weekOf],
    );
  });

  afterAll(async () => {
    await client.query(
      `delete from executive_oversight.weekly_reports where tenant_id in ($1, $2)`,
      [tenantAId, tenantBId],
    );
    await client.query(`delete from tenants where id in ($1, $2)`, [
      tenantAId,
      tenantBId,
    ]);
    await client.end();
  });

  // Simulates authenticating as a given tenant by reproducing the session
  // state PostgREST would set up from that tenant's JWT.
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

  it("blocks Tenant A from reading Tenant B's weekly report", async () => {
    await asTenant(tenantAId);

    const result = await client.query(
      'select * from executive_oversight.weekly_reports where tenant_id = $1',
      [tenantBId],
    );

    expect(result.rows).toHaveLength(0);

    await endSession();
  });

  it('proves the block above is RLS, not an application filter -- the row genuinely exists', async () => {
    // No `set local role` here: still running as the unrestricted `postgres`
    // role, which is not subject to RLS. If this returns nothing, the test
    // above would be meaningless (it'd prove nothing since there'd be no row
    // to leak in the first place).
    const result = await client.query<WeeklyReportRow>(
      'select * from executive_oversight.weekly_reports where tenant_id = $1',
      [tenantBId],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tenant_id).toBe(tenantBId);
  });

  it('still lets Tenant A read their own weekly report', async () => {
    await asTenant(tenantAId);

    const result = await client.query<WeeklyReportRow>(
      'select * from executive_oversight.weekly_reports',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tenant_id).toBe(tenantAId);

    await endSession();
  });
});
