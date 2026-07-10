/**
 * Batch 3 (server-side config validation + tenant rename): saveModuleConfig
 * enforces each module's settings.schema.json rather than trusting the form,
 * and a tenant can be renamed while still onboarding (edit-from-summary).
 *
 *   - required fields, types, URL/email formats and the E.164 destination
 *     pattern are all rejected server-side; keys not in the schema are dropped;
 *   - updateTenantName renames an onboarding tenant and refuses once activated.
 *
 * Real Postgres, stub SMS/invite. Schemas load from disk by module key, so the
 * stub-registered modules still validate against the real settings schemas.
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

const REVIEW = 'review-generation';
const MISSED_CALL = 'missed-call-textback';

describe('onboarding config validation + tenant rename', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let messaging: MessagingService;
  let onboarding: OnboardingService;

  let tenantId: string;
  const suffix = randomUUID().slice(0, 8);
  const createdTenantIds: string[] = [];

  // A schema-valid config for each module, spread and overridden per test.
  const validReview = {
    businessName: `Validation ${suffix}`,
    googleReviewUrl: 'https://g.page/r/validation/review',
    smsTemplate: 'Thanks from {business_name}!',
  };
  const validMissedCall = {
    businessName: `Validation ${suffix}`,
    destinationNumber: '+14155551234',
    textBackTemplate: 'Sorry we missed you.',
    ringTimeoutSeconds: 20,
  };

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
    registry.registerModule(REVIEW, stubContract);
    registry.registerModule(MISSED_CALL, stubContract);
    messaging = new MessagingService(new StubSmsClient());
    onboarding = new OnboardingService(
      registry,
      messaging,
      new StubInviteClient(),
    );

    const created = await onboarding.createTenant({
      name: `Validation ${suffix}`,
      contactEmail: `validation-${suffix}@example.com`,
      plan: 'core',
    });
    tenantId = created.tenantId;
    createdTenantIds.push(tenantId);
    await onboarding.enableModules(tenantId, [REVIEW, MISSED_CALL]);
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await client.query(`delete from notifications where tenant_id = $1`, [
        id,
      ]);
      await client.query(`delete from module_manifest where tenant_id = $1`, [
        id,
      ]);
      await client.query(`delete from subscriptions where tenant_id = $1`, [
        id,
      ]);
      await client.query(`delete from tenants where id = $1`, [id]);
    }
    await onboarding.onModuleDestroy();
    await messaging.onModuleDestroy();
    await registry.onModuleDestroy();
    await client.end();
  });

  it('rejects a missing required field', async () => {
    const withoutUrl = {
      businessName: validReview.businessName,
      smsTemplate: validReview.smsTemplate,
    };
    await expect(
      onboarding.saveModuleConfig(tenantId, REVIEW, withoutUrl),
    ).rejects.toThrow('"googleReviewUrl" is required');
  });

  it('rejects a malformed URL and email', async () => {
    await expect(
      onboarding.saveModuleConfig(tenantId, REVIEW, {
        ...validReview,
        googleReviewUrl: 'not-a-url',
      }),
    ).rejects.toThrow('must be a valid URL');

    await expect(
      onboarding.saveModuleConfig(tenantId, REVIEW, {
        ...validReview,
        negativeFeedbackEmail: 'nope',
      }),
    ).rejects.toThrow('must be a valid email');
  });

  it('rejects a destination number that is not E.164 US', async () => {
    await expect(
      onboarding.saveModuleConfig(tenantId, MISSED_CALL, {
        ...validMissedCall,
        destinationNumber: '415-555-1234',
      }),
    ).rejects.toThrow('not in the required format');
  });

  it('rejects an out-of-range integer', async () => {
    await expect(
      onboarding.saveModuleConfig(tenantId, MISSED_CALL, {
        ...validMissedCall,
        ringTimeoutSeconds: 120,
      }),
    ).rejects.toThrow('must be at most 60');
  });

  it('accepts a valid config and drops keys not in the schema', async () => {
    await onboarding.saveModuleConfig(tenantId, REVIEW, {
      ...validReview,
      sneakyExtra: 'should not persist',
    });

    const { rows } = await client.query<{ config: Record<string, unknown> }>(
      `select config from module_manifest where tenant_id = $1 and module_key = $2`,
      [tenantId, REVIEW],
    );
    expect(rows[0].config.businessName).toBe(validReview.businessName);
    expect(rows[0].config.googleReviewUrl).toBe(validReview.googleReviewUrl);
    expect(rows[0].config).not.toHaveProperty('sneakyExtra');
  });

  it('renames an onboarding tenant, and refuses empty names', async () => {
    const renamed = await onboarding.updateTenantName(
      tenantId,
      `Validation Renamed ${suffix}`,
    );
    expect(renamed.name).toBe(`Validation Renamed ${suffix}`);

    const { rows } = await client.query<{ name: string }>(
      `select name from tenants where id = $1`,
      [tenantId],
    );
    expect(rows[0].name).toBe(`Validation Renamed ${suffix}`);

    await expect(onboarding.updateTenantName(tenantId, '   ')).rejects.toThrow(
      'Business name is required',
    );
  });

  it('refuses to rename a tenant that is already activated', async () => {
    const created = await onboarding.createTenant({
      name: `Validation Activated ${suffix}`,
      contactEmail: `validation-activated-${suffix}@example.com`,
      plan: 'core',
    });
    createdTenantIds.push(created.tenantId);
    await onboarding.activate(created.tenantId);

    await expect(
      onboarding.updateTenantName(created.tenantId, 'Too Late'),
    ).rejects.toThrow('no longer in onboarding');
  });
});
