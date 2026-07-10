/**
 * Proof that the direct-write door on module_manifest is closed at the DB
 * level, not just in the dashboard UI.
 *
 * Adapted from core/auth/platform-admin-rls.spec.ts. It connects directly to
 * Postgres and reproduces exactly what PostgREST/the Supabase client does for
 * an authenticated request -- switch into the `authenticated` role and set the
 * `request.jwt.claims` GUC that carries tenant_id/app_role.
 *
 * The security property under test (migration 0018): a tenant member's session
 * has SELECT on module_manifest but NO insert/update/delete grant, so any
 * direct write is refused by Postgres before RLS is even consulted -- and this
 * holds regardless of the member's app_role, because the revoke is role-blind.
 * Owner-only enforcement therefore lives in the backend endpoint, which runs on
 * the RLS/grant-exempt pooler role and is proven here to still be able to write.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

describe('module_manifest direct writes are revoked for tenant sessions', () => {
  let client: Client;

  const tenantId = randomUUID();
  const ownerUserId = randomUUID();
  const staffUserId = randomUUID();

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

    // Setup runs as the pooler's default role (postgres, RLS/grant-exempt): a
    // tenant with an owner and a staff member and one existing manifest row.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Manifest Lockdown Tenant', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into users (id, tenant_id, email, role) values
         ($1, $3, 'owner@example.com', 'owner'),
         ($2, $3, 'staff@example.com', 'staff')`,
      [ownerUserId, staffUserId, tenantId],
    );
    await client.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config)
       values ($1, 'lockdown-probe-module', true, '{}')`,
      [tenantId],
    );
  });

  afterAll(async () => {
    await client.query(`delete from module_manifest where tenant_id = $1`, [
      tenantId,
    ]);
    await client.query(`delete from users where tenant_id = $1`, [tenantId]);
    await client.query(`delete from tenants where id = $1`, [tenantId]);
    await client.end();
  });

  // Reproduce a PostgREST session for a given set of JWT claims.
  async function asAuthenticated(claims: Record<string, unknown>) {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
  }

  async function endSession() {
    await client.query('rollback');
  }

  const ownerClaims = {
    tenant_id: tenantId,
    app_role: 'owner',
    role: 'authenticated',
  };
  const staffClaims = {
    tenant_id: tenantId,
    app_role: 'staff',
    role: 'authenticated',
  };

  it('a non-owner (staff) tenant session cannot INSERT into module_manifest', async () => {
    await asAuthenticated(staffClaims);
    await expect(
      client.query(
        `insert into module_manifest (tenant_id, module_key, enabled, config)
         values ($1, 'staff-inserted-module', true, '{}')`,
        [tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await endSession();
  });

  it('a non-owner (staff) tenant session cannot UPDATE module_manifest config', async () => {
    await asAuthenticated(staffClaims);
    await expect(
      client.query(
        `update module_manifest set config = '{"hacked":true}'
         where tenant_id = $1 and module_key = 'lockdown-probe-module'`,
        [tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await endSession();
  });

  it('a non-owner (staff) tenant session cannot DELETE from module_manifest', async () => {
    await asAuthenticated(staffClaims);
    await expect(
      client.query(
        `delete from module_manifest where tenant_id = $1 and module_key = 'lockdown-probe-module'`,
        [tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await endSession();
  });

  it('even an OWNER tenant session cannot write directly -- the revoke is role-blind, writes go through the backend', async () => {
    await asAuthenticated(ownerClaims);
    await expect(
      client.query(
        `update module_manifest set config = '{"via":"direct"}'
         where tenant_id = $1 and module_key = 'lockdown-probe-module'`,
        [tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await endSession();
  });

  it('reads are unaffected: a tenant session still SELECTs its own manifest row', async () => {
    await asAuthenticated(staffClaims);
    const result = await client.query<{ module_key: string }>(
      `select module_key from module_manifest where tenant_id = $1`,
      [tenantId],
    );
    await endSession();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].module_key).toBe('lockdown-probe-module');
  });

  it('the backend path is unaffected: the RLS/grant-exempt pooler role still writes (as the onboarding console and settings endpoint do)', async () => {
    // No `set local role`: still the unrestricted postgres role, exactly what
    // both OnboardingService and ModuleRegistryService.saveModuleConfig use.
    await client.query('begin');
    const result = await client.query(
      `update module_manifest set config = '{"via":"backend"}'
       where tenant_id = $1 and module_key = 'lockdown-probe-module'`,
      [tenantId],
    );
    await client.query('rollback');
    expect(result.rowCount).toBe(1);
  });
});
