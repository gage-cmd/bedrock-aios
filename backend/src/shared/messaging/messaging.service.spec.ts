import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { MessagingService, TenantPhoneNumberRow } from './messaging.service';

describe('MessagingService (against StubSmsClient)', () => {
  let service: MessagingService;
  let setupClient: Client;
  let logSpy: jest.SpyInstance;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const tenantWithNoNumberId = randomUUID();

  // Stand-in for a tenant's own Twilio Messaging Service SID (ISV model). The
  // StubSmsClient doesn't validate it; it just has to be present so a purchase
  // is allowed to proceed.
  const messagingServiceSid = 'MG00000000000000000000000000000001';

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
      `insert into tenants (id, name, status) values ($1, 'Messaging Test Tenant A', 'active'), ($2, 'Messaging Test Tenant B', 'active'), ($3, 'Messaging Test Tenant No Number', 'active')`,
      [tenantAId, tenantBId, tenantWithNoNumberId],
    );

    // No SMS_PROVIDER override in the test environment, so this picks up the
    // default StubSmsClient.
    service = new MessagingService();
  });

  afterAll(async () => {
    await setupClient.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id in ($1, $2, $3)`,
      [tenantAId, tenantBId, tenantWithNoNumberId],
    );
    await setupClient.query('delete from tenants where id in ($1, $2, $3)', [
      tenantAId,
      tenantBId,
      tenantWithNoNumberId,
    ]);
    await setupClient.end();
    await service.onModuleDestroy();
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('provisionNumberForTenant', () => {
    let firstNumber: TenantPhoneNumberRow;

    it('purchases and stores a new default number for a tenant with none', async () => {
      firstNumber = await service.provisionNumberForTenant(tenantAId, {
        messagingServiceSid,
      });

      expect(firstNumber.tenant_id).toBe(tenantAId);
      expect(firstNumber.is_default).toBe(true);
      expect(firstNumber.phone_number).toMatch(/^\+1555\d{7}$/);
      expect(firstNumber.twilio_sid).toMatch(/^PN[0-9a-f]{32}$/);
      // The tenant's messaging service is stored on the number, and the
      // provider column defaults to twilio.
      expect(firstNumber.messaging_service_sid).toBe(messagingServiceSid);
      expect(firstNumber.provider).toBe('twilio');
    });

    it('refuses to purchase a number when no messagingServiceSid is given', async () => {
      await expect(
        service.provisionNumberForTenant(tenantWithNoNumberId),
      ).rejects.toThrow('messagingServiceSid is required');

      // Nothing was stored -- the guard fires before any purchase or insert.
      const { rows } = await setupClient.query(
        'select 1 from shared_messaging.tenant_phone_numbers where tenant_id = $1',
        [tenantWithNoNumberId],
      );
      expect(rows).toHaveLength(0);
    });

    it("does not double-purchase when the tenant already has a number and makeDefault isn't explicitly requested", async () => {
      const result = await service.provisionNumberForTenant(tenantAId);

      expect(result.id).toBe(firstNumber.id);

      const { rows } = await setupClient.query(
        'select * from shared_messaging.tenant_phone_numbers where tenant_id = $1',
        [tenantAId],
      );
      expect(rows).toHaveLength(1);
    });

    it('purchases and makes a new number the default when makeDefault is explicitly true, and un-defaults the old one', async () => {
      const secondNumber = await service.provisionNumberForTenant(tenantAId, {
        makeDefault: true,
        label: 'Second location',
        messagingServiceSid,
      });

      expect(secondNumber.id).not.toBe(firstNumber.id);
      expect(secondNumber.is_default).toBe(true);
      expect(secondNumber.label).toBe('Second location');

      const { rows } = await setupClient.query<TenantPhoneNumberRow>(
        'select * from shared_messaging.tenant_phone_numbers where id = $1',
        [firstNumber.id],
      );
      expect(rows[0].is_default).toBe(false);
    });
  });

  describe('sendSms', () => {
    it("sends via the tenant's default number when no numberId is given", async () => {
      const defaultNumber = await service.provisionNumberForTenant(tenantBId, {
        messagingServiceSid,
      });

      const result = await service.sendSms(
        tenantBId,
        '+15559998888',
        'hello there',
        {
          moduleKey: 'test-module',
        },
      );

      expect(result.sid).toMatch(/^SM[0-9a-f]{32}$/);
      expect(result.status).toBe('delivered');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `from ${defaultNumber.phone_number} to +15559998888`,
        ),
      );
    });

    it('throws when the tenant has no active phone number', async () => {
      await expect(
        service.sendSms(tenantWithNoNumberId, '+15559998888', 'hello', {
          moduleKey: 'test-module',
        }),
      ).rejects.toThrow('has no active phone number');
    });

    it('sends via a specific numberId when provided, overriding the default', async () => {
      const { rows } = await setupClient.query<TenantPhoneNumberRow>(
        `select * from shared_messaging.tenant_phone_numbers where tenant_id = $1 and is_default = false`,
        [tenantAId],
      );
      const nonDefaultNumber = rows[0];

      await service.sendSms(tenantAId, '+15559998888', 'hi', {
        moduleKey: 'test-module',
        numberId: nonDefaultNumber.id,
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`from ${nonDefaultNumber.phone_number} to`),
      );
    });
  });
});
