/**
 * Proves the DB-level mutual exclusion between platform_admins and users
 * (migration 0016): one auth user cannot hold rows in both tables at once, and
 * the rule is enforced whichever table you try to insert into second.
 *
 * Runs directly against Postgres as the pooler's default (RLS-exempt) role --
 * the same connection the backend uses to write these tables. The point is
 * that even that fully privileged writer is stopped by the trigger, so the
 * invariant does not depend on application code remembering to check.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

// Postgres SQLSTATE for check_violation, which the exclusion triggers raise.
const CHECK_VIOLATION = '23514';

describe('platform_admins / users mutual exclusion (DB level)', () => {
  let client: Client;

  const tenantId = randomUUID();
  const tenantUserId = randomUUID();
  const adminUserId = randomUUID();
  const cleanAdminId = randomUUID();

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

    // A tenant with one existing tenant user, and (separately) one existing
    // platform admin who has no users row.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Exclusion Test Tenant', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into users (id, tenant_id, email, role) values ($1, $2, 'tenant-user@example.com', 'owner')`,
      [tenantUserId, tenantId],
    );
    await client.query(`insert into platform_admins (user_id) values ($1)`, [
      adminUserId,
    ]);
  });

  afterAll(async () => {
    await client.query(
      `delete from platform_admins where user_id in ($1, $2)`,
      [adminUserId, cleanAdminId],
    );
    await client.query(`delete from users where tenant_id = $1`, [tenantId]);
    await client.query(`delete from tenants where id = $1`, [tenantId]);
    await client.end();
  });

  it('rejects inserting a platform_admins row for a user who already has a users row', async () => {
    await expect(
      client.query(`insert into platform_admins (user_id) values ($1)`, [
        tenantUserId,
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });

    // And nothing was written -- the insert failed atomically.
    const check = await client.query(
      `select 1 from platform_admins where user_id = $1`,
      [tenantUserId],
    );
    expect(check.rows).toHaveLength(0);
  });

  it('rejects inserting a users row for someone who is already a platform admin (reverse direction)', async () => {
    await expect(
      client.query(
        `insert into users (id, tenant_id, email, role) values ($1, $2, 'admin-as-user@example.com', 'staff')`,
        [adminUserId, tenantId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });

    const check = await client.query(`select 1 from users where id = $1`, [
      adminUserId,
    ]);
    expect(check.rows).toHaveLength(0);
  });

  it('still allows a platform admin who has no users row (the constraint only blocks conflicts)', async () => {
    await expect(
      client.query(`insert into platform_admins (user_id) values ($1)`, [
        cleanAdminId,
      ]),
    ).resolves.toBeDefined();

    const check = await client.query(
      `select 1 from platform_admins where user_id = $1`,
      [cleanAdminId],
    );
    expect(check.rows).toHaveLength(1);
  });
});
