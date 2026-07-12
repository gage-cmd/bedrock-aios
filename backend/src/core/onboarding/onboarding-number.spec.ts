/**
 * Batch 2 (area-code search + select-before-purchase): the admin searches
 * numbers by area code and buys the one they picked -- a local number for a
 * local business, chosen deliberately rather than whatever the provider hands
 * out.
 *
 *   - searchNumbers validates the area code (3 digits) before hitting the
 *     provider, and returns numbers in that area code -- read-only, no buy;
 *   - provisionNumber refuses a malformed selection and, given a valid one,
 *     purchases exactly that number as the tenant's default.
 *
 * Real Postgres, StubSmsClient (synthesizes area-code numbers, no Twilio buy).
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import type { ModuleContract } from '../module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../shared/messaging/stub-sms-client';
import { OnboardingService } from './onboarding.service';
import { StubInviteClient } from './stub-invite-client';

const stubContract: ModuleContract = {
  handleRequest: () => Promise.resolve({}),
  getSnapshot: () => Promise.resolve({ metric: 'x', value: 'y' }),
  getStatus: () => Promise.resolve({ status: 'connected' }),
  getCapabilities: () => [],
};

describe('onboarding area-code search + select-before-purchase', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let messaging: MessagingService;
  let onboarding: OnboardingService;

  let tenantId: string;
  const suffix = randomUUID().slice(0, 8);
  // Stand-in for the client's own Twilio Messaging Service SID (ISV model).
  const messagingServiceSid = 'MG00000000000000000000000000000001';

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

    registry = new ModuleRegistryService();
    registry.registerModule('review-generation', stubContract);
    messaging = new MessagingService(new StubSmsClient());
    onboarding = new OnboardingService(
      registry,
      messaging,
      new StubInviteClient(),
    );

    const created = await onboarding.createTenant({
      name: `Number Select ${suffix}`,
      contactEmail: `number-${suffix}@example.com`,
      plan: 'core',
    });
    tenantId = created.tenantId;
  });

  afterAll(async () => {
    await client.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id = $1`,
      [tenantId],
    );
    await client.query(`delete from subscriptions where tenant_id = $1`, [
      tenantId,
    ]);
    await client.query(`delete from tenants where id = $1`, [tenantId]);
    await onboarding.onModuleDestroy();
    await messaging.onModuleDestroy();
    await registry.onModuleDestroy();
    await client.end();
  });

  it('rejects an area code that is not 3 digits, before touching the provider', async () => {
    await expect(onboarding.searchNumbers('41')).rejects.toThrow(
      'Area code must be exactly 3 digits',
    );
    await expect(onboarding.searchNumbers('abc')).rejects.toThrow(
      'Area code must be exactly 3 digits',
    );
  });

  it('returns available numbers in the requested area code', async () => {
    const results = await onboarding.searchNumbers('415');

    expect(results.length).toBeGreaterThan(0);
    for (const n of results) {
      expect(n.phoneNumber).toMatch(/^\+1415\d{7}$/);
    }
  });

  it('refuses a malformed selection', async () => {
    await expect(
      onboarding.provisionNumber(tenantId, '415-555-1234', messagingServiceSid),
    ).rejects.toThrow('E.164 US format');
  });

  it('refuses to purchase without a messaging service SID', async () => {
    const [choice] = await onboarding.searchNumbers('415');
    await expect(
      onboarding.provisionNumber(tenantId, choice.phoneNumber),
    ).rejects.toThrow('Messaging Service SID is required');
  });

  it('refuses a malformed messaging service SID', async () => {
    const [choice] = await onboarding.searchNumbers('415');
    await expect(
      onboarding.provisionNumber(tenantId, choice.phoneNumber, 'not-a-sid'),
    ).rejects.toThrow('must be a Twilio Messaging Service SID');
  });

  it('purchases exactly the selected number as the tenant default', async () => {
    const [choice] = await onboarding.searchNumbers('415');

    const row = await onboarding.provisionNumber(
      tenantId,
      choice.phoneNumber,
      messagingServiceSid,
    );
    expect(row.phone_number).toBe(choice.phoneNumber);
    expect(row.is_default).toBe(true);
    expect(row.messaging_service_sid).toBe(messagingServiceSid);

    // And it is the number durably stored as the tenant's active default.
    const stored = await client.query<{ phone_number: string }>(
      `select phone_number from shared_messaging.tenant_phone_numbers
       where tenant_id = $1 and status = 'active' and is_default = true`,
      [tenantId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].phone_number).toBe(choice.phoneNumber);
  });
});
