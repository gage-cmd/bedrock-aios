import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleRegistryService } from '../src/core/module-registry/module-registry.service';
import { OnboardingService } from '../src/core/onboarding/onboarding.service';
import { StubInviteClient } from '../src/core/onboarding/stub-invite-client';
import { MessagingService } from '../src/shared/messaging/messaging.service';
import { StubSmsClient } from '../src/shared/messaging/stub-sms-client';
import { MissedCallTextbackService } from '../src/modules/missed-call-textback/missed-call-textback.service';
import { ReviewGenerationService } from '../src/modules/review-generation/review-generation.service';
import type { SettingsSchema } from './settings-schema';

// Step 9 test (2): the COMPLETE onboarding flow -- create tenant, enable both
// real modules (listed dynamically from the registry, never hardcoded from a
// fixture), configure each through values derived from its settings.schema.json
// exactly as the generic form renderer derives them, provision a default
// number, invite an owner, and activate. Then the payoff assertion: from the
// dashboard's perspective (tenant status, enabled-module manifest, per-module
// getStatus/getSnapshot, owner user, default number) the onboarded tenant is
// indistinguishable from the hand-built Command Center demo tenant.
//
// Real Postgres, real module services, real registry. Only the two
// world-touching clients are stubs -- SMS (no Twilio purchase) and invite (no
// email) -- mirroring how the executive-oversight e2e stubs only the AI call.

const DEMO_TENANT_NAME = 'Golden Gate Dental (Command Center Demo)';

// What the generic SchemaForm submits: every schema default, plus supplied
// values for required fields that have no default. Derived purely from the
// schema -- if a module's schema changes, this changes with it.
function valuesFromSchema(
  schema: SettingsSchema,
  required: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) out[name] = prop.default;
  }
  for (const [name, value] of Object.entries(required)) {
    out[name] = value;
  }
  return out;
}

describe('Onboarding Console full flow (e2e)', () => {
  let client: Client;
  let registry: ModuleRegistryService;
  let messaging: MessagingService;
  let onboarding: OnboardingService;
  let reviewGeneration: ReviewGenerationService;
  let missedCallTextback: MissedCallTextbackService;
  let inviteClient: StubInviteClient;

  let tenantId: string;
  let demoTenantId: string;
  const ownerEmail = `onboarded-owner-${randomUUID().slice(0, 8)}@example.com`;

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

    const demo = await client.query<{ id: string }>(
      `select id from tenants where name = $1`,
      [DEMO_TENANT_NAME],
    );
    if (demo.rows.length === 0) {
      throw new Error(
        `Demo tenant "${DEMO_TENANT_NAME}" not found -- the indistinguishability benchmark needs it`,
      );
    }
    demoTenantId = demo.rows[0].id;

    // The same wiring main.ts produces, with the two world-touching clients
    // stubbed.
    registry = new ModuleRegistryService();
    messaging = new MessagingService(new StubSmsClient());
    reviewGeneration = new ReviewGenerationService(messaging);
    missedCallTextback = new MissedCallTextbackService(messaging);
    registry.registerModule('review-generation', reviewGeneration);
    registry.registerModule('missed-call-textback', missedCallTextback);
    inviteClient = new StubInviteClient();
    onboarding = new OnboardingService(registry, messaging, inviteClient);
  });

  afterAll(async () => {
    if (tenantId) {
      await client.query(`delete from notifications where tenant_id = $1`, [
        tenantId,
      ]);
      await client.query(`delete from users where tenant_id = $1`, [tenantId]);
      await client.query(
        `delete from shared_messaging.tenant_phone_numbers where tenant_id = $1`,
        [tenantId],
      );
      await client.query(`delete from module_manifest where tenant_id = $1`, [
        tenantId,
      ]);
      await client.query(`delete from subscriptions where tenant_id = $1`, [
        tenantId,
      ]);
      await client.query(`delete from tenants where id = $1`, [tenantId]);
    }
    await onboarding.onModuleDestroy();
    await reviewGeneration.onModuleDestroy();
    await missedCallTextback.onModuleDestroy();
    await messaging.onModuleDestroy();
    await registry.onModuleDestroy();
    await client.end();
  });

  it('creates the tenant in onboarding status with its plan recorded', async () => {
    const created = await onboarding.createTenant({
      name: 'Flowtest Dental',
      contactEmail: ownerEmail,
      plan: 'core',
    });
    tenantId = created.tenantId;

    expect(created.status).toBe('onboarding');
    const sub = await client.query<{ plan: string }>(
      `select plan from subscriptions where tenant_id = $1`,
      [tenantId],
    );
    expect(sub.rows[0].plan).toBe('core');
  });

  it('lists available modules dynamically from the registry, schemas included', async () => {
    const available = await onboarding.listAvailableModules();
    const keys = available.map((m) => m.moduleKey).sort();

    // Exactly what registered -- the console list is the registry, not a
    // hardcoded pair.
    expect(keys).toEqual(registry.getRegisteredModuleKeys().sort());
    for (const mod of available) {
      expect(mod.name.length).toBeGreaterThan(0);
      expect(mod.settingsSchema).not.toBeNull();
      expect(mod.settingsSchema!.properties).toBeDefined();
    }
  });

  it('enables every available module and configures each through its own schema', async () => {
    const available = await onboarding.listAvailableModules();
    await onboarding.enableModules(
      tenantId,
      available.map((m) => m.moduleKey),
    );

    // Schema-derived required values -- the flow-level equivalent of an admin
    // filling the generic form's required fields.
    const requiredValues: Record<string, Record<string, unknown>> = {
      'review-generation': {
        businessName: 'Flowtest Dental',
        googleReviewUrl: 'https://g.page/r/flowtest-dental/review',
      },
      'missed-call-textback': {
        businessName: 'Flowtest Dental',
        destinationNumber: '+15551234567',
      },
    };

    for (const mod of available) {
      const schema = mod.settingsSchema as unknown as SettingsSchema;
      const values = valuesFromSchema(
        schema,
        requiredValues[mod.moduleKey] ?? {},
      );
      // Every schema-required field must be present in what we save, exactly
      // as the renderer enforces.
      for (const requiredField of schema.required ?? []) {
        expect(values[requiredField]).toBeDefined();
      }
      await onboarding.saveModuleConfig(tenantId, mod.moduleKey, values);
    }

    // Saved where the modules read config from: module_manifest.config.
    const manifest = await client.query<{
      module_key: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }>(
      `select module_key, enabled, config from module_manifest where tenant_id = $1 order by module_key`,
      [tenantId],
    );
    expect(manifest.rows.map((r) => r.module_key)).toEqual(
      available.map((m) => m.moduleKey).sort(),
    );
    for (const row of manifest.rows) {
      expect(row.enabled).toBe(true);
      expect(Object.keys(row.config).length).toBeGreaterThan(0);
    }
  });

  it('provisions a default number and invites the owner', async () => {
    const number = await onboarding.provisionNumber(
      tenantId,
      undefined,
      'MG00000000000000000000000000000001',
    );
    expect(number.phone_number).toMatch(/^\+1/);
    expect(number.is_default).toBe(true);

    const invited = await onboarding.inviteOwner(tenantId, ownerEmail);
    expect(invited.email).toBe(ownerEmail);
    expect(inviteClient.invited).toHaveLength(1);

    const users = await client.query<{ email: string; role: string }>(
      `select email, role from users where tenant_id = $1`,
      [tenantId],
    );
    expect(users.rows).toEqual([{ email: ownerEmail, role: 'owner' }]);
  });

  it('surfaces the full summary (Step 8) before activation', async () => {
    const state = await onboarding.getState(tenantId);

    expect(state.name).toBe('Flowtest Dental');
    expect(state.status).toBe('onboarding');
    expect(state.plan).toBe('core');
    expect(state.modules.map((m) => m.moduleKey).sort()).toEqual(
      registry.getRegisteredModuleKeys().sort(),
    );
    expect(state.defaultNumber).toMatch(/^\+1/);
    expect(state.invitedUsers).toEqual([{ email: ownerEmail, role: 'owner' }]);
  });

  it('activates: status flips, a branding-clean welcome notification lands, re-activation is refused', async () => {
    const result = await onboarding.activate(tenantId);
    expect(result.status).toBe('active');

    const notifications = await client.query<{ title: string; body: string }>(
      `select title, body from notifications where tenant_id = $1`,
      [tenantId],
    );
    expect(notifications.rows).toHaveLength(1);
    const copy = `${notifications.rows[0].title} ${notifications.rows[0].body}`;
    expect(copy).not.toMatch(/\b(AI|agent|module|system|bot)\b/i);

    // The status guard makes activation single-shot -- a replay cannot
    // duplicate the welcome notification.
    await expect(onboarding.activate(tenantId)).rejects.toThrow(
      'not in onboarding status',
    );
  });

  it('produces a tenant indistinguishable from the hand-built demo tenant, from the dashboard perspective', async () => {
    // 1. Same tenant status.
    const statuses = await client.query<{ id: string; status: string }>(
      `select id, status from tenants where id in ($1, $2)`,
      [tenantId, demoTenantId],
    );
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
    expect(byId[tenantId]).toBe(byId[demoTenantId]);

    // 2. Same enabled-module manifest, through the same registry read the
    // dashboard's module-manifest endpoint uses.
    const newModules = (await registry.getEnabledModules(tenantId))
      .map((m) => m.moduleKey)
      .sort();
    const demoModules = (await registry.getEnabledModules(demoTenantId))
      .map((m) => m.moduleKey)
      .sort();
    expect(newModules).toEqual(demoModules);

    // 3. Same per-module status, from the same service methods the module
    // widgets hit. Both tenants have full config + a number, so if the demo
    // shows 'connected' anywhere the onboarded tenant must too.
    for (const moduleKey of newModules) {
      const instance = registry.getModuleInstance(moduleKey)!;
      const [newStatus, demoStatus] = await Promise.all([
        instance.getStatus(tenantId),
        instance.getStatus(demoTenantId),
      ]);
      expect(newStatus).toEqual(demoStatus);

      // Snapshots differ in values (the demo has activity history) but must
      // match in shape -- the widget contract.
      const snapshot = await instance.getSnapshot(tenantId);
      expect(typeof snapshot.metric).toBe('string');
      expect(typeof snapshot.value).toBe('string');
    }

    // 4. Same ownership shape: exactly one owner user.
    for (const id of [tenantId, demoTenantId]) {
      const owners = await client.query(
        `select 1 from users where tenant_id = $1 and role = 'owner'`,
        [id],
      );
      expect(owners.rows).toHaveLength(1);
    }

    // 5. Same messaging posture: exactly one active default number.
    for (const id of [tenantId, demoTenantId]) {
      const numbers = await client.query(
        `select 1 from shared_messaging.tenant_phone_numbers where tenant_id = $1 and status = 'active' and is_default = true`,
        [id],
      );
      expect(numbers.rows).toHaveLength(1);
    }
  });
});
