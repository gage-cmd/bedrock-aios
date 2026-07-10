/**
 * Batch 1 (resumability + duplicate-name warning): an interrupted onboarding
 * must be resumable instead of restarted, and restarting the same business by
 * name must warn rather than silently create a second tenant.
 *
 *   - listOnboardingTenants surfaces tenants still in 'onboarding' status and
 *     drops ones already activated -- the resume list, not a full tenant dump;
 *   - createTenant refuses a same-name tenant with DuplicateTenantNameError,
 *     and honours confirmDuplicate to override it (two same-named businesses).
 *
 * Real Postgres, stub SMS/invite -- same seam as the other onboarding specs.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import type { ModuleContract } from '../module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../shared/messaging/stub-sms-client';
import {
  DuplicateTenantNameError,
  OnboardingService,
} from './onboarding.service';
import { StubInviteClient } from './stub-invite-client';

const stubContract: ModuleContract = {
  handleRequest: () => Promise.resolve({}),
  getSnapshot: () => Promise.resolve({ metric: 'x', value: 'y' }),
  getStatus: () => Promise.resolve({ status: 'connected' }),
  getCapabilities: () => [],
};

describe('onboarding resume + duplicate-name warning', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let messaging: MessagingService;
  let onboarding: OnboardingService;

  // Every tenant this spec creates, torn down in afterAll.
  const createdTenantIds: string[] = [];
  // Unique per run so the duplicate check is deterministic regardless of what
  // else is in the database.
  const suffix = randomUUID().slice(0, 8);

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
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await client.query(`delete from notifications where tenant_id = $1`, [
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

  it('lists tenants still in onboarding and excludes activated ones', async () => {
    const stillOnboarding = await onboarding.createTenant({
      name: `Resume Pending ${suffix}`,
      contactEmail: `pending-${suffix}@example.com`,
      plan: 'core',
    });
    createdTenantIds.push(stillOnboarding.tenantId);

    const activated = await onboarding.createTenant({
      name: `Resume Activated ${suffix}`,
      contactEmail: `activated-${suffix}@example.com`,
      plan: 'core',
    });
    createdTenantIds.push(activated.tenantId);
    await onboarding.activate(activated.tenantId);

    const list = await onboarding.listOnboardingTenants();
    const ids = list.map((t) => t.tenantId);

    expect(ids).toContain(stillOnboarding.tenantId);
    expect(ids).not.toContain(activated.tenantId);

    const entry = list.find((t) => t.tenantId === stillOnboarding.tenantId)!;
    expect(entry.name).toBe(`Resume Pending ${suffix}`);
    expect(entry.createdAt).toBeDefined();
  });

  it('refuses a duplicate name, then honours confirmDuplicate to override', async () => {
    const name = `Duplicate Guard ${suffix}`;
    const first = await onboarding.createTenant({
      name,
      contactEmail: `dup-first-${suffix}@example.com`,
      plan: 'core',
    });
    createdTenantIds.push(first.tenantId);

    // Same name (and case-insensitively so) is refused with the typed error.
    await expect(
      onboarding.createTenant({
        name: name.toUpperCase(),
        contactEmail: `dup-second-${suffix}@example.com`,
        plan: 'core',
      }),
    ).rejects.toThrow(DuplicateTenantNameError);

    // The override path creates a genuinely separate tenant.
    const second = await onboarding.createTenant({
      name,
      contactEmail: `dup-second-${suffix}@example.com`,
      plan: 'core',
      confirmDuplicate: true,
    });
    createdTenantIds.push(second.tenantId);

    expect(second.tenantId).not.toBe(first.tenantId);
  });
});
