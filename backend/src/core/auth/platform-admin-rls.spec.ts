/**
 * Proof that platform-admin status grants NO blanket bypass of tenant RLS.
 *
 * Adapted from core/tenant-resolver/tenant-isolation.template.spec.ts. It
 * connects directly to Postgres and reproduces exactly what PostgREST does for
 * an authenticated request -- switch into the `authenticated` role and set the
 * `request.jwt.claims` GUC that the tenant_isolation policies read via
 * auth.jwt(). The difference here is the claims we set: those of a PLATFORM
 * ADMIN (a real platform_admins row, keyed on the auth user id) that carries
 * NO tenant_id.
 *
 * The security property under test: admin membership lives in a table that no
 * tenant_isolation policy consults. Those policies key on
 * `tenant_id = auth.jwt() ->> 'tenant_id'`; an admin session has no tenant_id
 * claim, so it matches nothing. Being an admin therefore opens exactly zero
 * tenant-scoped rows -- admin power comes only from the routes that mount
 * AdminGuard, never from a relaxed isolation rule elsewhere.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

describe('platform admin does not bypass tenant RLS', () => {
  let client: Client;

  const tenantId = randomUUID();
  const ownerUserId = randomUUID();
  const adminUserId = randomUUID();

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

    // Run as the pooler's default role (postgres, RLS-exempt) for setup: a
    // tenant with one user and one module_manifest row, plus a platform admin
    // who belongs to no tenant.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Admin RLS Tenant', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into users (id, tenant_id, email, role) values ($1, $2, 'owner@example.com', 'owner')`,
      [ownerUserId, tenantId],
    );
    await client.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'rls-probe-module', true, '{}')`,
      [tenantId],
    );
    await client.query(`insert into platform_admins (user_id) values ($1)`, [
      adminUserId,
    ]);
  });

  afterAll(async () => {
    await client.query(`delete from platform_admins where user_id = $1`, [
      adminUserId,
    ]);
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

  it('the seeded tenant rows genuinely exist (visible to the RLS-exempt role)', async () => {
    // No `set role`: still the unrestricted postgres role. If this saw
    // nothing, the zero-row assertions below would prove nothing.
    const users = await client.query(
      'select * from users where tenant_id = $1',
      [tenantId],
    );
    const modules = await client.query(
      'select * from module_manifest where tenant_id = $1',
      [tenantId],
    );
    expect(users.rows).toHaveLength(1);
    expect(modules.rows).toHaveLength(1);
  });

  it("an admin session (no tenant_id claim) reads ZERO rows of another tenant's users", async () => {
    await asAuthenticated({ sub: adminUserId, role: 'authenticated' });
    const result = await client.query(
      'select * from users where tenant_id = $1',
      [tenantId],
    );
    expect(result.rows).toHaveLength(0);
    await endSession();
  });

  it('an admin session reads ZERO rows of any tenant module_manifest', async () => {
    await asAuthenticated({ sub: adminUserId, role: 'authenticated' });
    const result = await client.query('select * from module_manifest');
    expect(result.rows).toHaveLength(0);
    await endSession();
  });

  it('even a forged is_platform_admin claim opens no tenant rows -- no policy reads it', async () => {
    await asAuthenticated({
      sub: adminUserId,
      role: 'authenticated',
      is_platform_admin: true,
    });
    const result = await client.query('select * from users');
    expect(result.rows).toHaveLength(0);
    await endSession();
  });

  it('contrast: a proper tenant session for this tenant DOES see its own user (RLS is working, not broken)', async () => {
    await asAuthenticated({ tenant_id: tenantId, role: 'authenticated' });
    const result = await client.query<{ id: string }>('select id from users');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(ownerUserId);
    await endSession();
  });

  it('the platform_admins table itself is invisible to any tenant/authenticated session (fail-closed)', async () => {
    // Its own membership is not enumerable from a tenant session: with RLS on
    // and no policy, the authenticated role either sees zero rows or is denied
    // outright. Either way it cannot read the admin list -- so a tenant user
    // can neither discover admins nor add themselves.
    await asAuthenticated({ tenant_id: tenantId, role: 'authenticated' });
    let visibleRows = -1;
    try {
      const result = await client.query('select * from platform_admins');
      visibleRows = result.rows.length;
    } catch {
      // permission denied at the grant level is an equally valid fail-closed
      // outcome; normalise it to "saw nothing".
      visibleRows = 0;
    }
    await endSession();
    expect(visibleRows).toBe(0);

    // And it really does exist for the RLS-exempt role.
    const asPostgres = await client.query(
      'select * from platform_admins where user_id = $1',
      [adminUserId],
    );
    expect(asPostgres.rows).toHaveLength(1);
  });
});
