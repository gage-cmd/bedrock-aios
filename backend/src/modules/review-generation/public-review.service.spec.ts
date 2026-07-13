import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { PublicReviewService } from './public-review.service';
import { ValueLedgerService } from '../../shared/value-ledger/value-ledger.service';

// Known, fixed tokens so the tests can drive the funnel deterministically.
// Real tokens are 64 hex chars (gen_random_bytes(32)); these match that shape.
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

describe('PublicReviewService (public review funnel)', () => {
  let service: PublicReviewService;
  let db: Client;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  let contactAId: string;
  let contactBId: string;

  // Sequential, not parallel: a single pg.Client cannot run overlapping
  // queries (doing so triggers a deprecation warning and risks errors).
  async function counts(tenantId: string) {
    const responses = await db.query<{ n: number }>(
      'select count(*)::int as n from review_generation.review_responses where tenant_id = $1',
      [tenantId],
    );
    const notifications = await db.query<{ n: number }>(
      'select count(*)::int as n from notifications where tenant_id = $1',
      [tenantId],
    );
    const activity = await db.query<{ n: number }>(
      'select count(*)::int as n from activity_log where tenant_id = $1',
      [tenantId],
    );
    const requestStatuses = await db.query<{ status: string }>(
      'select status from review_generation.review_requests where tenant_id = $1',
      [tenantId],
    );
    return {
      responses: responses.rows[0].n,
      notifications: notifications.rows[0].n,
      activity: activity.rows[0].n,
      statuses: requestStatuses.rows.map((r) => r.status),
    };
  }

  beforeAll(async () => {
    db = new Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();

    await db.query(
      `insert into tenants (id, name, status) values ($1, 'Public Funnel Tenant A', 'active'), ($2, 'Public Funnel Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );
    await db.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'review-generation', true, $2), ($3, 'review-generation', true, $4)`,
      [
        tenantAId,
        JSON.stringify({ googleReviewUrl: 'https://g.page/r/tenant-a/review' }),
        tenantBId,
        JSON.stringify({ googleReviewUrl: 'https://g.page/r/tenant-b/review' }),
      ],
    );

    const cA = await db.query<{ id: string }>(
      `insert into review_generation.contacts (tenant_id, name, phone) values ($1, 'Alice A', '+15550000001') returning id`,
      [tenantAId],
    );
    contactAId = cA.rows[0].id;
    const cB = await db.query<{ id: string }>(
      `insert into review_generation.contacts (tenant_id, name, phone) values ($1, 'Bob B', '+15550000002') returning id`,
      [tenantBId],
    );
    contactBId = cB.rows[0].id;

    await db.query(
      `insert into review_generation.review_requests (tenant_id, contact_id, channel, token) values ($1, $2, 'sms', $3), ($4, $5, 'sms', $6)`,
      [tenantAId, contactAId, TOKEN_A, tenantBId, contactBId, TOKEN_B],
    );

    service = new PublicReviewService(new ValueLedgerService());
  });

  afterAll(async () => {
    const ids = [tenantAId, tenantBId];
    await db.query('delete from activity_log where tenant_id = any($1)', [ids]);
    await db.query('delete from value_events where tenant_id = any($1)', [ids]);
    await db.query('delete from notifications where tenant_id = any($1)', [
      ids,
    ]);
    await db.query(
      'delete from review_generation.review_responses where tenant_id = any($1)',
      [ids],
    );
    await db.query(
      'delete from review_generation.review_requests where tenant_id = any($1)',
      [ids],
    );
    await db.query(
      'delete from review_generation.contacts where tenant_id = any($1)',
      [ids],
    );
    await db.query('delete from module_manifest where tenant_id = any($1)', [
      ids,
    ]);
    await db.query('delete from tenants where id = any($1)', [ids]);
    await db.end();
    await service.onModuleDestroy();
  });

  it('returns a generic "not valid" response for unknown/guessed/malformed tokens, leaking no detail and writing nothing', async () => {
    // Unknown-but-well-formed token.
    const unknown = await service.getReviewState('c'.repeat(64));
    expect(unknown).toEqual({ valid: false });
    // The response object carries ONLY `valid` -- no tenant id, business name,
    // status, or any other internal field that could distinguish "never
    // existed" from "already used" or identify a tenant.
    expect(Object.keys(unknown)).toEqual(['valid']);

    // Malformed / hostile tokens must behave identically and never throw.
    const hostileTokens = [
      '',
      'not-a-real-token',
      TOKEN_A.toUpperCase(), // right value, wrong case -> must not match
      "'; drop table review_generation.review_requests; --",
      '../../secret',
      'x'.repeat(500),
    ];
    for (const bad of hostileTokens) {
      await expect(service.getReviewState(bad)).resolves.toEqual({
        valid: false,
      });
    }

    // Submitting against a bogus token returns the same generic shape (no
    // routedToGoogle / googleReviewUrl leaked) and must not write any row.
    const before = { a: await counts(tenantAId), b: await counts(tenantBId) };
    const submitted = await service.submitReview('c'.repeat(64), 5);
    expect(submitted).toEqual({ ok: false });
    const after = { a: await counts(tenantAId), b: await counts(tenantBId) };
    expect(after).toEqual(before);
  });

  it('only ever touches the review_requests row matching its own token, never another tenant, even under guessed/malformed tokens', async () => {
    // Drive a full high-rating completion through tenant A's token.
    const res = await service.submitReview(TOKEN_A, 5);
    expect(res).toEqual({
      ok: true,
      routedToGoogle: true,
      googleReviewUrl: 'https://g.page/r/tenant-a/review',
    });

    // Tenant A's own row is completed; tenant B's row is completely untouched.
    const aReq = await db.query<{ status: string }>(
      'select status from review_generation.review_requests where token = $1',
      [TOKEN_A],
    );
    const bReq = await db.query<{ status: string }>(
      'select status from review_generation.review_requests where token = $1',
      [TOKEN_B],
    );
    expect(aReq.rows[0].status).toBe('completed');
    expect(bReq.rows[0].status).toBe('sent');

    // Exactly one response row exists, and it is tenant A's. Tenant B has none.
    const aResp = await db.query<{ routed_to_google: boolean }>(
      'select routed_to_google from review_generation.review_responses where tenant_id = $1',
      [tenantAId],
    );
    const bResp = await db.query(
      'select 1 from review_generation.review_responses where tenant_id = $1',
      [tenantBId],
    );
    expect(aResp.rows).toHaveLength(1);
    expect(aResp.rows[0].routed_to_google).toBe(true);
    expect(bResp.rows).toHaveLength(0);

    // Now hammer guessed / malformed / cross-tenant-guess tokens and prove
    // NOTHING changes for either tenant -- not A (already completed), not B.
    const before = { a: await counts(tenantAId), b: await counts(tenantBId) };
    const guesses = [
      'deadbeef'.repeat(8), // 64 chars, not a real token
      TOKEN_B.toUpperCase(), // B's token, wrong case
      TOKEN_A, // A's token again -- already completed, must be rejected
      "' or '1'='1", // injection attempt
      randomUUID(),
    ];
    for (const g of guesses) {
      await expect(service.submitReview(g, 1)).resolves.toEqual({ ok: false });
    }
    const after = { a: await counts(tenantAId), b: await counts(tenantBId) };
    expect(after).toEqual(before);

    // Tenant B, whose token was never legitimately submitted, still has zero
    // responses, zero notifications, zero activity, and a 'sent' request.
    expect(before.b.responses).toBe(0);
    expect(before.b.notifications).toBe(0);
    expect(before.b.activity).toBe(0);
    expect(before.b.statuses).toEqual(['sent']);
  });

  it('routes a low rating to the private feedback path: no Google redirect, feedback + notification stored for the right tenant', async () => {
    const res = await service.submitReview(
      TOKEN_B,
      2,
      'The wait was too long.',
    );
    // Check the over-the-wire shape (JSON drops undefined keys): a low rating
    // must never carry the tenant's Google URL back to the customer.
    expect(JSON.parse(JSON.stringify(res))).toEqual({
      ok: true,
      routedToGoogle: false,
    });

    const resp = await db.query<{
      rating: number;
      feedback_text: string;
      routed_to_google: boolean;
    }>(
      'select rating, feedback_text, routed_to_google from review_generation.review_responses where tenant_id = $1',
      [tenantBId],
    );
    expect(resp.rows).toHaveLength(1);
    expect(resp.rows[0].rating).toBe(2);
    expect(resp.rows[0].feedback_text).toBe('The wait was too long.');
    expect(resp.rows[0].routed_to_google).toBe(false);

    const notif = await db.query(
      'select 1 from notifications where tenant_id = $1',
      [tenantBId],
    );
    expect(notif.rows).toHaveLength(1);

    // Step 7 vocabulary: a low rating writes BOTH "review_completed" AND
    // "negative_feedback_captured", same value shape, same transaction.
    const activity = await db.query<{
      event_type: string;
      value: { rating: number; routedToGoogle: boolean };
    }>(
      `select event_type, value from activity_log where tenant_id = $1 and event_type in ('review_completed', 'negative_feedback_captured') order by event_type`,
      [tenantBId],
    );
    expect(activity.rows.map((r) => r.event_type)).toEqual([
      'negative_feedback_captured',
      'review_completed',
    ]);
    for (const row of activity.rows) {
      expect(row.value.rating).toBe(2);
      expect(row.value.routedToGoogle).toBe(false);
    }
  });

  it('does not write "negative_feedback_captured" for a high rating', async () => {
    const activity = await db.query(
      `select 1 from activity_log where tenant_id = $1 and event_type = 'negative_feedback_captured'`,
      [tenantAId],
    );
    expect(activity.rows).toHaveLength(0);
  });
});
