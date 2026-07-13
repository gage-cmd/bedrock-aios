/**
 * End-to-end coverage of the Twilio Voice webhooks, exercised over the real
 * Nest HTTP stack (guard + controller + services) with supertest, a live
 * Postgres for seeding/asserting, and the StubSmsClient standing in for
 * Twilio -- so nothing here needs a live Twilio account.
 *
 * Valid X-Twilio-Signature headers are produced offline with Twilio's own
 * getExpectedTwilioSignature, keyed by a test auth token we set on the
 * environment, so the guard's real validateRequest accepts them.
 */
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { MissedCallTextbackService } from '../missed-call-textback.service';
import { MessagingService } from '../../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../../shared/messaging/stub-sms-client';
import { TwilioSignatureGuard } from '../../../shared/messaging/twilio-signature.guard';

const AUTH_TOKEN = 'test_auth_token_deadbeef';
const BASE_URL = 'https://voice.test';

describe('Twilio Voice webhooks', () => {
  let app: INestApplication;
  let setupClient: Client;
  let messaging: MessagingService;
  let sendSpy: jest.SpyInstance;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const tenantANumber = '+15550100001'; // the tenant's own Twilio number
  const tenantBNumber = '+15550100002';
  const destinationNumber = '+15559990001'; // front desk the call forwards to
  const ringTimeoutSeconds = 25;

  // Signs a request exactly the way the guard reconstructs it: the public
  // base URL joined to the exact path (with query string) that supertest will
  // send, plus the POST params. Using the same path string on both sides
  // removes any URL-encoding drift.
  function sign(path: string, params: Record<string, string>): string {
    return getExpectedTwilioSignature(AUTH_TOKEN, `${BASE_URL}${path}`, params);
  }

  function postSigned(
    path: string,
    params: Record<string, string>,
    signature?: string,
  ) {
    const req = request(app.getHttpServer() as Server).post(path);
    const sig = signature ?? sign(path, params);
    if (sig !== '') req.set('X-Twilio-Signature', sig);
    return req.type('form').send(params);
  }

  async function missedCallsFor(tenantId: string) {
    const { rows } = await setupClient.query(
      `select * from missed_call_textback.missed_calls where tenant_id = $1 order by missed_at`,
      [tenantId],
    );
    return rows as Array<{
      tenant_id: string;
      contact_phone: string;
      textback_sent: boolean;
      textback_body: string | null;
    }>;
  }

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.PUBLIC_BASE_URL = BASE_URL;

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
      `insert into tenants (id, name, status) values ($1, 'Voice Tenant A', 'active'), ($2, 'Voice Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );

    // Tenant A is fully configured: an active default number (used both as the
    // inbound "To" and as the SMS from-number) and a settings row with a
    // forwarding destination + custom ring timeout.
    await setupClient.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, $2, 'PN_voice_a', true)`,
      [tenantAId, tenantANumber],
    );
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'missed-call-textback', true, $2)`,
      [
        tenantAId,
        JSON.stringify({
          businessName: 'Acme Plumbing',
          destinationNumber,
          ringTimeoutSeconds,
        }),
      ],
    );

    // Tenant B just needs to exist with its own number so the cross-tenant
    // test can prove it is never touched.
    await setupClient.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, $2, 'PN_voice_b', true)`,
      [tenantBId, tenantBNumber],
    );

    const stubClient = new StubSmsClient();
    sendSpy = jest.spyOn(stubClient, 'sendMessage');
    messaging = new MessagingService(stubClient);

    const moduleRef = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        VoiceService,
        MissedCallTextbackService,
        TwilioSignatureGuard,
        { provide: MessagingService, useValue: messaging },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    const tenantIds = [tenantAId, tenantBId];
    await setupClient.query(
      `delete from activity_log where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from missed_call_textback.missed_calls where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from module_manifest where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(`delete from tenants where id = any($1)`, [
      tenantIds,
    ]);
    await setupClient.end();
    await app.close();
  });

  beforeEach(() => sendSpy.mockClear());

  describe('signature verification (fail closed)', () => {
    it('rejects an incoming-call webhook with no signature header', async () => {
      const res = await postSigned(
        '/public/voice/incoming',
        { To: tenantANumber, From: '+15557770000' },
        '', // no header sent
      );
      expect(res.status).toBe(403);
    });

    it('rejects an incoming-call webhook whose signature does not verify', async () => {
      const res = await postSigned(
        '/public/voice/incoming',
        { To: tenantANumber, From: '+15557770000' },
        'totally-bogus-signature',
      );
      expect(res.status).toBe(403);
    });

    it('rejects a status webhook with a bad signature and does NOTHING else', async () => {
      const caller = '+15557770099';
      const path = `/public/voice/status?tenantId=${tenantAId}&caller=${encodeURIComponent(caller)}`;

      const res = await postSigned(
        path,
        { CallStatus: 'no-answer', CallSid: 'CA_bad' },
        'wrong-signature',
      );

      expect(res.status).toBe(403);
      // No tenant lookup, no DB write, no text-back for a request we could
      // not verify.
      const rows = await missedCallsFor(tenantAId);
      expect(rows.some((r) => r.contact_phone === caller)).toBe(false);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('unrecognized "To" number', () => {
    it('declines safely with no error and no side effects', async () => {
      // 999 is not a real US area code, so no tenant row in the shared live
      // DB can ever own this number -- the old +1555... value collided with
      // the demo tenant's seeded number and made this test depend on that
      // tenant's config.
      const unknownNumber = '+19995550142';
      const res = await postSigned('/public/voice/incoming', {
        To: unknownNumber,
        From: '+15557771234',
      });

      expect(res.status).toBe(201);
      expect(res.text).toContain('<Reject');
      // Nothing dialed, nothing logged, nothing about us disclosed.
      expect(res.text).not.toContain('<Dial');
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('incoming call forwarding', () => {
    it('returns TwiML that dials the destination with the configured ring timeout and a tenant-scoped statusCallback', async () => {
      const caller = '+15557770001';
      const res = await postSigned('/public/voice/incoming', {
        To: tenantANumber,
        From: caller,
      });

      expect(res.status).toBe(201);
      expect(res.text).toContain(`<Dial timeout="${ringTimeoutSeconds}">`);
      expect(res.text).toContain(`>${destinationNumber}</Number>`);
      // The statusCallback carries the resolved tenant and original caller.
      expect(res.text).toContain(`tenantId=${tenantAId}`);
      expect(res.text).toContain('/public/voice/status');
    });
  });

  describe('full simulated missed-call flow', () => {
    it('incoming call -> no-answer status -> missed call logged and text-back sent', async () => {
      const caller = '+15557775555';

      // 1. Incoming call arrives at tenant A's number.
      const incoming = await postSigned('/public/voice/incoming', {
        To: tenantANumber,
        From: caller,
      });
      expect(incoming.status).toBe(201);

      // Pull the exact statusCallback Twilio would call back from the TwiML
      // (its attribute value is XML-escaped, so unescape &amp;).
      const match = /statusCallback="([^"]+)"/.exec(incoming.text);
      expect(match).not.toBeNull();
      const statusUrl = match![1].replace(/&amp;/g, '&');
      const parsed = new URL(statusUrl);
      const statusPath = `${parsed.pathname}${parsed.search}`;

      // 2. The forwarded leg goes unanswered -> Twilio posts a no-answer
      // status to that callback.
      const status = await postSigned(statusPath, {
        CallStatus: 'no-answer',
        CallSid: 'CA_child_flow',
      });
      expect(status.status).toBe(201);

      // 3. The missed call is recorded for tenant A and the text-back went out.
      const rows = await missedCallsFor(tenantAId);
      const row = rows.find((r) => r.contact_phone === caller);
      expect(row).toBeDefined();
      expect(row!.tenant_id).toBe(tenantAId);
      expect(row!.textback_sent).toBe(true);
      expect(row!.textback_body).toContain('Acme Plumbing');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [params] = sendSpy.mock.calls[0] as [
        { from: string; to: string; body: string },
      ];
      expect(params.to).toBe(caller);
      expect(params.from).toBe(tenantANumber);
      expect(params.body).toBe(row!.textback_body);

      // And the activity log recorded it.
      const { rows: activity } = await setupClient.query(
        `select 1 from activity_log where tenant_id = $1 and event_type = 'missed_call_textback_sent'`,
        [tenantAId],
      );
      expect(activity.length).toBeGreaterThanOrEqual(1);
    });

    it('does nothing when the forwarded call was answered (status "completed")', async () => {
      const caller = '+15557776666';
      const path = `/public/voice/status?tenantId=${tenantAId}&caller=${encodeURIComponent(caller)}`;

      const res = await postSigned(path, {
        CallStatus: 'completed',
        CallSid: 'CA_answered',
      });

      expect(res.status).toBe(201);
      const rows = await missedCallsFor(tenantAId);
      expect(rows.some((r) => r.contact_phone === caller)).toBe(false);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('cross-tenant isolation', () => {
    it('a manipulated POST body cannot retarget the missed call to another tenant', async () => {
      const caller = '+15557778888';
      // The signed query names tenant A. The attacker-controlled body claims
      // tenant B's number in every field it can. Only the signed query must
      // count.
      const path = `/public/voice/status?tenantId=${tenantAId}&caller=${encodeURIComponent(caller)}`;

      const res = await postSigned(path, {
        CallStatus: 'no-answer',
        CallSid: 'CA_cross',
        To: tenantBNumber,
        From: tenantBNumber,
        Called: tenantBNumber,
      });

      expect(res.status).toBe(201);

      // Logged for A (from the signed query)...
      const aRows = await missedCallsFor(tenantAId);
      expect(aRows.some((r) => r.contact_phone === caller)).toBe(true);

      // ...and tenant B was never touched, despite the body naming it.
      const bRows = await missedCallsFor(tenantBId);
      expect(bRows).toHaveLength(0);
    });

    it('cannot forge a different tenantId into the query -- changing it invalidates the signature', async () => {
      const caller = '+15557779999';
      // Sign for tenant A's URL, then send the request against a URL that
      // swaps in tenant B's id -- exactly what an attacker with a captured
      // signature would try.
      const signedPath = `/public/voice/status?tenantId=${tenantAId}&caller=${encodeURIComponent(caller)}`;
      const forgedPath = `/public/voice/status?tenantId=${tenantBId}&caller=${encodeURIComponent(caller)}`;
      const params = { CallStatus: 'no-answer', CallSid: 'CA_forge' };

      const res = await postSigned(
        forgedPath,
        params,
        sign(signedPath, params),
      );

      expect(res.status).toBe(403);
      const bRows = await missedCallsFor(tenantBId);
      expect(bRows).toHaveLength(0);
    });
  });
});
