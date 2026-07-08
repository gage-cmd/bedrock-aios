/**
 * Adapted from core/tenant-resolver/tenant-isolation.template.spec.ts.
 *
 * Proves that cross-tenant reads of shared_messaging.tenant_phone_numbers are
 * blocked by Postgres Row-Level Security itself, not an application-level
 * WHERE clause. Connects directly to Postgres, bypassing PostgREST/Supabase
 * Auth, and reproduces exactly what PostgREST does when it serves an
 * authenticated request: it switches into the `authenticated` role and sets
 * the `request.jwt.claims` session GUC, which is what the `tenant_isolation`
 * policy reads via `auth.jwt()`.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

interface TenantPhoneNumberRow {
  tenant_id: string;
  phone_number: string;
}

describe('shared_messaging tenant isolation', () => {
  let client: Client;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();

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

    // Two fake tenants, one phone number row each. Run as the pooler's
    // default role (postgres), which bypasses RLS, so setup itself isn't
    // subject to the policy under test.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Isolation Test Tenant A', 'active'), ($2, 'Isolation Test Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );
    await client.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, '+15550001111', 'PN_test_a', true), ($2, '+15550002222', 'PN_test_b', true)`,
      [tenantAId, tenantBId],
    );
  });

  afterAll(async () => {
    await client.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id in ($1, $2)`,
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

  it("blocks Tenant A from reading Tenant B's phone number", async () => {
    await asTenant(tenantAId);

    const result = await client.query(
      'select * from shared_messaging.tenant_phone_numbers where tenant_id = $1',
      [tenantBId],
    );

    expect(result.rows).toHaveLength(0);

    await endSession();
  });

  it('proves the block above is RLS, not an application filter -- the row genuinely exists', async () => {
    const result = await client.query<TenantPhoneNumberRow>(
      'select * from shared_messaging.tenant_phone_numbers where tenant_id = $1',
      [tenantBId],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].phone_number).toBe('+15550002222');
  });

  it('still lets Tenant A read their own phone number', async () => {
    await asTenant(tenantAId);

    const result = await client.query<TenantPhoneNumberRow>(
      'select * from shared_messaging.tenant_phone_numbers',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tenant_id).toBe(tenantAId);

    await endSession();
  });
});
