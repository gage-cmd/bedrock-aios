import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { MissedCallTextbackService } from './missed-call-textback.service';
import type { MissedCallRow } from './missed-call-textback.service';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../shared/messaging/stub-sms-client';
import { SendMessageParams } from '../../shared/messaging/sms-client.interface';

describe('MissedCallTextbackService', () => {
  let service: MissedCallTextbackService;
  let messaging: MessagingService;
  let setupClient: Client;
  let sendMessageSpy: jest.SpyInstance;

  const connectedTenantId = randomUUID();
  const needsAttentionTenantId = randomUUID();
  const tenantPhoneNumber = '+15550004321';
  const callerPhone = '+15558881111';

  beforeAll(async () => {
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
      `insert into tenants (id, name, status) values ($1, 'MCT Test Tenant Connected', 'active'), ($2, 'MCT Test Tenant Needs Attention', 'active')`,
      [connectedTenantId, needsAttentionTenantId],
    );

    // connectedTenantId has settings + an active number -- getStatus should
    // report "connected". needsAttentionTenantId has neither on purpose.
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'missed-call-textback', true, $2)`,
      [
        connectedTenantId,
        JSON.stringify({ businessName: 'Bright Smiles Dental' }),
      ],
    );
    await setupClient.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, $2, 'PN_mct_test', true)`,
      [connectedTenantId, tenantPhoneNumber],
    );

    // Real MessagingService running against the existing stub SMS client --
    // exercises number lookup in shared_messaging for real; only the actual
    // Twilio call is stubbed.
    const stubClient = new StubSmsClient();
    sendMessageSpy = jest.spyOn(stubClient, 'sendMessage');
    messaging = new MessagingService(stubClient);

    service = new MissedCallTextbackService(messaging);
  });

  afterAll(async () => {
    const tenantIds = [connectedTenantId, needsAttentionTenantId];
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
    await service.onModuleDestroy();
    await messaging.onModuleDestroy();
  });

  describe('handleRequest("log-missed-call")', () => {
    it('records the missed call, texts the caller back through the stub, and logs activity', async () => {
      const result = (await service.handleRequest(
        connectedTenantId,
        'log-missed-call',
        { phone: callerPhone },
      )) as MissedCallRow;

      expect(result.tenant_id).toBe(connectedTenantId);
      expect(result.contact_phone).toBe(callerPhone);
      expect(result.textback_sent).toBe(true);
      expect(result.textback_body).toContain('Bright Smiles Dental');

      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      const [params] = sendMessageSpy.mock.calls[0] as [SendMessageParams];
      expect(params.from).toBe(tenantPhoneNumber);
      expect(params.to).toBe(callerPhone);
      expect(params.body).toBe(result.textback_body);

      const { rows } = await setupClient.query<{
        value: { missedCallId: string; contactPhone: string };
      }>(
        `select * from activity_log where tenant_id = $1 and event_type = 'missed_call_textback_sent'`,
        [connectedTenantId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].value.missedCallId).toBe(result.id);
      expect(rows[0].value.contactPhone).toBe(callerPhone);
    });

    it('keeps the missed-call row (marked not sent) when the tenant has no number to text back from', async () => {
      await expect(
        service.handleRequest(needsAttentionTenantId, 'log-missed-call', {
          phone: callerPhone,
        }),
      ).rejects.toThrow('no active phone number');

      const { rows } = await setupClient.query<MissedCallRow>(
        `select * from missed_call_textback.missed_calls where tenant_id = $1`,
        [needsAttentionTenantId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].textback_sent).toBe(false);
      expect(rows[0].textback_body).toBeNull();
    });

    it('throws when no phone number is given', async () => {
      await expect(
        service.handleRequest(connectedTenantId, 'log-missed-call', {}),
      ).rejects.toThrow('Caller phone number is required');
    });
  });

  describe('handleRequest("get-recent-missed-calls")', () => {
    it('returns recent missed calls scoped to the tenant', async () => {
      const calls = (await service.handleRequest(
        connectedTenantId,
        'get-recent-missed-calls',
      )) as MissedCallRow[];

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.every((c) => c.tenant_id === connectedTenantId)).toBe(true);
    });
  });

  describe('handleRequest with an unknown intent', () => {
    it('throws', async () => {
      await expect(
        service.handleRequest(connectedTenantId, 'send-review-request', {}),
      ).rejects.toThrow('Unknown missed-call-textback intent');
    });
  });

  describe('getSnapshot', () => {
    it("counts this week's successful text-backs in the headline", async () => {
      const snapshot = await service.getSnapshot(connectedTenantId);

      expect(snapshot.headline.label).toBe('Missed calls recovered this week');
      expect(snapshot.headline.value).toBe('1 text-back sent');
    });

    it('returns the full v2 shape: metrics, dense series, events', async () => {
      const snapshot = await service.getSnapshot(connectedTenantId);

      expect(snapshot.metrics.map((m) => m.key)).toEqual([
        'recovered-week',
        'awaiting-week',
        'recovered-all-time',
      ]);
      expect(snapshot.metrics[0].value).toBe('1');
      // Dense 14-day series regardless of how sparse the data is.
      expect(snapshot.series?.points).toHaveLength(14);
      expect(
        snapshot.series?.points.reduce((sum, p) => sum + p.value, 0),
      ).toBeGreaterThanOrEqual(1);
      expect(snapshot.recentEvents.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.recentEvents[0].text).toContain('Missed call from');
    });

    it('surfaces un-texted missed calls as attention items, not recoveries', async () => {
      // This tenant has exactly one missed_calls row, from the failed-send
      // test above -- textback_sent = false, so it must not be "recovered".
      const snapshot = await service.getSnapshot(needsAttentionTenantId);

      expect(snapshot.headline.value).toBe('0 text-backs sent');
      expect(snapshot.attention).toHaveLength(1);
      expect(snapshot.attention[0].text).toContain('has not been texted back');
      expect(snapshot.attention[0].href).toBe(
        '/installed-systems/missed-call-textback?tab=activity',
      );
    });
  });

  describe('getStatus', () => {
    it('is "connected" when the tenant has an active phone number', async () => {
      const status = await service.getStatus(connectedTenantId);

      expect(status).toEqual({ status: 'connected' });
    });

    it('is "needs attention" when no number is provisioned', async () => {
      const status = await service.getStatus(needsAttentionTenantId);

      expect(status).toEqual({
        status: 'needs attention',
        reason: 'no SMS number provisioned',
      });
    });
  });

  describe('getCapabilities', () => {
    it('returns the static capability list', () => {
      expect(service.getCapabilities()).toEqual([
        'How many missed calls did we recover this week',
        'Show me recent missed-call text-backs',
      ]);
    });
  });
});
