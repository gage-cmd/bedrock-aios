import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ReviewGenerationService } from './review-generation.service';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { ValueLedgerService } from '../../shared/value-ledger/value-ledger.service';

describe('ReviewGenerationService', () => {
  let service: ReviewGenerationService;
  let setupClient: Client;
  let sendSmsMock: jest.Mock;
  let contactId: string;

  const connectedTenantId = randomUUID();
  const needsAttentionTenantId = randomUUID();

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
      `insert into tenants (id, name, status) values ($1, 'RG Test Tenant Connected', 'active'), ($2, 'RG Test Tenant Needs Attention', 'active')`,
      [connectedTenantId, needsAttentionTenantId],
    );

    // connectedTenantId has settings + an active number -- getStatus should
    // report "connected". needsAttentionTenantId has neither on purpose.
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'review-generation', true, $2)`,
      [
        connectedTenantId,
        JSON.stringify({
          businessName: 'Bright Smiles Dental',
          googleReviewUrl: 'https://g.page/r/test/review',
          smsTemplate:
            'Hi {customer_name}, thanks for visiting {business_name}!',
        }),
      ],
    );
    await setupClient.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, '+15550001234', 'PN_rg_test', true)`,
      [connectedTenantId],
    );

    const contactResult = await setupClient.query<{ id: string }>(
      `insert into review_generation.contacts (tenant_id, name, phone) values ($1, 'Jane Doe', '+15559990000') returning id`,
      [connectedTenantId],
    );
    contactId = contactResult.rows[0].id;

    sendSmsMock = jest
      .fn()
      .mockResolvedValue({ sid: 'SMfake', status: 'delivered' });
    const messagingMock = {
      sendSms: sendSmsMock,
    } as unknown as MessagingService;

    service = new ReviewGenerationService(
      messagingMock,
      new ValueLedgerService(),
    );
  });

  afterAll(async () => {
    const tenantIds = [connectedTenantId, needsAttentionTenantId];
    await setupClient.query(
      `delete from activity_log where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from value_events where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from review_generation.review_responses where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from review_generation.review_requests where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from review_generation.contacts where tenant_id = any($1)`,
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
  });

  describe('handleRequest("send-review-request")', () => {
    it('creates a review request, sends the templated SMS via the shared messaging service, and logs activity', async () => {
      const result = (await service.handleRequest(
        connectedTenantId,
        'send-review-request',
        {
          contactId,
        },
      )) as { requestId: string; token: string; status: string };

      expect(result.status).toBe('sent');
      expect(result.token).toMatch(/^[0-9a-f]{64}$/);

      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      const [tenantArg, toArg, bodyArg, optionsArg] = sendSmsMock.mock
        .calls[0] as [string, string, string, { moduleKey: string }];
      expect(tenantArg).toBe(connectedTenantId);
      expect(toArg).toBe('+15559990000');
      expect(bodyArg).toContain('Jane Doe');
      expect(bodyArg).toContain('Bright Smiles Dental');
      expect(bodyArg).toContain(result.token);
      expect(optionsArg).toEqual({ moduleKey: 'review-generation' });

      const { rows } = await setupClient.query<{
        value: { requestId: string };
      }>(
        `select * from activity_log where tenant_id = $1 and event_type = 'review_request_sent'`,
        [connectedTenantId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].value.requestId).toBe(result.requestId);
    });

    it('throws for a contact that does not belong to the tenant', async () => {
      await expect(
        service.handleRequest(connectedTenantId, 'send-review-request', {
          contactId: randomUUID(),
        }),
      ).rejects.toThrow('Contact not found');
    });

    it('does not leave a phantom "sent" row behind when the send itself fails', async () => {
      const before = await setupClient.query<{ count: string }>(
        `select count(*) from review_generation.review_requests where tenant_id = $1`,
        [connectedTenantId],
      );

      sendSmsMock.mockRejectedValueOnce(new Error('no active phone number'));

      await expect(
        service.handleRequest(connectedTenantId, 'send-review-request', {
          contactId,
        }),
      ).rejects.toThrow('no active phone number');

      const after = await setupClient.query<{ count: string }>(
        `select count(*) from review_generation.review_requests where tenant_id = $1`,
        [connectedTenantId],
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });
  });

  describe('handleRequest("get-recent-responses")', () => {
    it('returns recent responses scoped to the tenant', async () => {
      const requestResult = await setupClient.query<{ id: string }>(
        `insert into review_generation.review_requests (tenant_id, contact_id, channel) values ($1, $2, 'sms') returning id`,
        [connectedTenantId, contactId],
      );
      await setupClient.query(
        `insert into review_generation.review_responses (tenant_id, request_id, rating) values ($1, $2, 5)`,
        [connectedTenantId, requestResult.rows[0].id],
      );

      const responses = (await service.handleRequest(
        connectedTenantId,
        'get-recent-responses',
      )) as Array<{ tenant_id: string; rating: number }>;

      expect(responses.length).toBeGreaterThanOrEqual(1);
      expect(responses.every((r) => r.tenant_id === connectedTenantId)).toBe(
        true,
      );
    });
  });

  describe('getSnapshot', () => {
    it("summarizes this week's completed reviews in the headline", async () => {
      const snapshot = await service.getSnapshot(connectedTenantId);

      expect(snapshot.headline.label).toBe('Reviews completed this week');
      expect(snapshot.headline.value).toMatch(/^\d+ completed, \d\.\d★ avg$/);
    });

    it('returns the full v2 shape: metrics, dense series, events', async () => {
      const snapshot = await service.getSnapshot(connectedTenantId);

      expect(snapshot.metrics.map((m) => m.key)).toEqual([
        'requests-week',
        'completion-rate',
        'avg-rating',
      ]);
      expect(snapshot.series?.points).toHaveLength(14);
      expect(snapshot.recentEvents.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.recentEvents[0].text).toMatch(
        /^New \d★ review completed$/,
      );
    });

    it('reports zero completed and placeholder metrics when the window is empty', async () => {
      const snapshot = await service.getSnapshot(needsAttentionTenantId);

      expect(snapshot.headline.value).toBe('0 completed');
      const avgMetric = snapshot.metrics.find((m) => m.key === 'avg-rating');
      expect(avgMetric?.value).toBe('—');
      expect(avgMetric?.delta).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('is "connected" when an active phone number and a Google review link both exist', async () => {
      const status = await service.getStatus(connectedTenantId);

      expect(status).toEqual({ status: 'connected' });
    });

    it('is "needs attention" with a human-readable reason when nothing is configured', async () => {
      const status = await service.getStatus(needsAttentionTenantId);

      expect(status.status).toBe('needs attention');
      expect(status).toMatchObject({
        reason:
          'no SMS number provisioned and no Google review link configured',
      });
    });
  });

  describe('getCapabilities', () => {
    it('returns the static capability list', () => {
      expect(service.getCapabilities()).toEqual([
        'How many reviews were requested this week',
        "What's our average rating",
        'Show me recent feedback',
      ]);
    });
  });
});
