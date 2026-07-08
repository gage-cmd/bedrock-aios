/**
 * Adapted from core/tenant-resolver/tenant-isolation.template.spec.ts.
 *
 * Proves that cross-tenant reads are blocked by Postgres Row-Level Security
 * itself (not an application-level WHERE clause) for all three
 * review_generation tables. Connects directly to Postgres, bypassing
 * PostgREST/Supabase Auth, and reproduces exactly what PostgREST does when it
 * serves an authenticated request: it switches into the `authenticated` role
 * and sets the `request.jwt.claims` session GUC, which is what the
 * `tenant_isolation` policies read via `auth.jwt()`.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';

interface ContactRow {
  tenant_id: string;
  name: string;
}

interface ReviewRequestRow {
  tenant_id: string;
  channel: string;
}

interface ReviewResponseRow {
  tenant_id: string;
  rating: number;
}

describe('review_generation tenant isolation', () => {
  let client: Client;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();

  const contactAId = randomUUID();
  const contactBId = randomUUID();
  const requestAId = randomUUID();
  const requestBId = randomUUID();
  const responseAId = randomUUID();
  const responseBId = randomUUID();

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

    // Two fake tenants, one row per table each. Run as the pooler's default
    // role (postgres), which bypasses RLS, so setup itself isn't subject to
    // the policy under test.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Isolation Test Tenant A', 'active'), ($2, 'Isolation Test Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );
    await client.query(
      `insert into review_generation.contacts (id, tenant_id, name, phone) values ($1, $2, 'Contact A', '+15550000001'), ($3, $4, 'Contact B', '+15550000002')`,
      [contactAId, tenantAId, contactBId, tenantBId],
    );
    await client.query(
      `insert into review_generation.review_requests (id, tenant_id, contact_id, channel) values ($1, $2, $3, 'sms'), ($4, $5, $6, 'sms')`,
      [requestAId, tenantAId, contactAId, requestBId, tenantBId, contactBId],
    );
    await client.query(
      `insert into review_generation.review_responses (id, tenant_id, request_id, rating) values ($1, $2, $3, 5), ($4, $5, $6, 2)`,
      [responseAId, tenantAId, requestAId, responseBId, tenantBId, requestBId],
    );
  });

  afterAll(async () => {
    await client.query(
      `delete from review_generation.review_responses where tenant_id in ($1, $2)`,
      [tenantAId, tenantBId],
    );
    await client.query(
      `delete from review_generation.review_requests where tenant_id in ($1, $2)`,
      [tenantAId, tenantBId],
    );
    await client.query(
      `delete from review_generation.contacts where tenant_id in ($1, $2)`,
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

  describe('contacts', () => {
    it("blocks Tenant A from reading Tenant B's contact", async () => {
      await asTenant(tenantAId);

      const result = await client.query(
        'select * from review_generation.contacts where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(0);

      await endSession();
    });

    it('proves the block above is RLS, not an application filter -- the row genuinely exists', async () => {
      const result = await client.query<ContactRow>(
        'select * from review_generation.contacts where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Contact B');
    });

    it('still lets Tenant A read their own contact', async () => {
      await asTenant(tenantAId);

      const result = await client.query<ContactRow>(
        'select * from review_generation.contacts',
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].tenant_id).toBe(tenantAId);

      await endSession();
    });
  });

  describe('review_requests', () => {
    it("blocks Tenant A from reading Tenant B's review request", async () => {
      await asTenant(tenantAId);

      const result = await client.query(
        'select * from review_generation.review_requests where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(0);

      await endSession();
    });

    it('proves the block above is RLS, not an application filter -- the row genuinely exists', async () => {
      const result = await client.query<ReviewRequestRow>(
        'select * from review_generation.review_requests where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].channel).toBe('sms');
    });

    it('still lets Tenant A read their own review request', async () => {
      await asTenant(tenantAId);

      const result = await client.query<ReviewRequestRow>(
        'select * from review_generation.review_requests',
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].tenant_id).toBe(tenantAId);

      await endSession();
    });
  });

  describe('review_responses', () => {
    it("blocks Tenant A from reading Tenant B's review response", async () => {
      await asTenant(tenantAId);

      const result = await client.query(
        'select * from review_generation.review_responses where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(0);

      await endSession();
    });

    it('proves the block above is RLS, not an application filter -- the row genuinely exists', async () => {
      const result = await client.query<ReviewResponseRow>(
        'select * from review_generation.review_responses where tenant_id = $1',
        [tenantBId],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rating).toBe(2);
    });

    it('still lets Tenant A read their own review response', async () => {
      await asTenant(tenantAId);

      const result = await client.query<ReviewResponseRow>(
        'select * from review_generation.review_responses',
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].tenant_id).toBe(tenantAId);

      await endSession();
    });
  });
});
