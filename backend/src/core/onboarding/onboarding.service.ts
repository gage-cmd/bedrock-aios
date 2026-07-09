import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';
import { MessagingService } from '../../shared/messaging/messaging.service';
import type { TenantPhoneNumberRow } from '../../shared/messaging/messaging.service';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import type { InviteClient, InvitedUser } from './invite-client.interface';
import { GoTrueInviteClient } from './gotrue-invite-client';
import { StubInviteClient } from './stub-invite-client';

// The only plan the console offers today. Stored on subscriptions (the
// existing home of plan state) -- tenants has no plan column and doesn't
// grow one for this.
export const ONBOARDING_PLAN = 'core';

export interface CreateTenantInput {
  name: string;
  contactEmail: string;
  plan: string;
}

export interface CreatedTenant {
  tenantId: string;
  name: string;
  status: string;
  plan: string;
  // Echoed back for the console to carry into the invite step -- there is no
  // contact-email column anywhere in the schema, and the invited owner's
  // email (users.email) becomes the durable record of the contact.
  contactEmail: string;
}

export interface AvailableModule {
  moduleKey: string;
  name: string;
  description: string;
  // The module's settings.schema.json, verbatim, for the console's generic
  // form renderer. Null for a module that ships no settings schema.
  settingsSchema: Record<string, unknown> | null;
}

export interface OnboardingModuleState {
  moduleKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// Everything the console needs to render any step for a tenant, and the
// entire content of the Step 8 confirmation screen.
export interface OnboardingState {
  tenantId: string;
  name: string;
  status: string;
  plan: string | null;
  modules: OnboardingModuleState[];
  defaultNumber: string | null;
  invitedUsers: { email: string; role: string }[];
}

// Welcome copy is client-facing and brand-safe: recovered revenue framing,
// no mention of AI, agents, modules, systems, or bots (same rule the weekly
// report notification enforces in its tests).
export const WELCOME_NOTIFICATION = {
  title: 'Welcome aboard -- your account is live.',
  body: 'Everything is set up and running in the background. Open your dashboard any time to see the work being done for you.',
};

function inviteClientFromEnv(): InviteClient {
  return process.env.INVITE_PROVIDER === 'supabase'
    ? new GoTrueInviteClient()
    : new StubInviteClient();
}

// Where module packages live on disk. Two candidates, first readable file
// wins: (1) relative to this file -- src/core/onboarding/../../modules under
// ts-jest, and the compiled tree's modules dir in a build (nest-cli assets
// copy each module's *.json next to the compiled output); (2) the source tree
// relative to the working directory, since every entrypoint (npm start, jest,
// start:prod) runs from backend/. Keeps the module list resilient to the
// compiled layout shifting (dist/ vs dist/src/).
const MODULES_DIR_CANDIDATES = [
  join(__dirname, '..', '..', 'modules'),
  join(process.cwd(), 'src', 'modules'),
];

@Injectable()
export class OnboardingService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  private readonly inviteClient: InviteClient;

  // Same @Optional() pattern as MessagingService: the interface param is only
  // ever passed explicitly in tests; production falls through to the env
  // switch.
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly messaging: MessagingService,
    @Optional() inviteClient?: InviteClient,
  ) {
    this.inviteClient = inviteClient ?? inviteClientFromEnv();
  }

  // STEP 2 -- a new tenant enters the pipeline in 'onboarding' status, with
  // its plan recorded on subscriptions from the start.
  async createTenant(input: CreateTenantInput): Promise<CreatedTenant> {
    const name = input.name?.trim();
    const contactEmail = input.contactEmail?.trim();
    if (!name) throw new Error('Business name is required');
    if (!contactEmail) throw new Error('Primary contact email is required');
    if (input.plan !== ONBOARDING_PLAN) {
      throw new Error(`Unknown plan: only '${ONBOARDING_PLAN}' is offered`);
    }

    const tenant = await this.pool.query<{ id: string; status: string }>(
      `insert into tenants (name, status) values ($1, 'onboarding') returning id, status`,
      [name],
    );
    const tenantId = tenant.rows[0].id;

    await this.pool.query(
      `insert into subscriptions (tenant_id, plan, status) values ($1, $2, 'active')`,
      [tenantId, input.plan],
    );

    return {
      tenantId,
      name,
      status: tenant.rows[0].status,
      plan: input.plan,
      contactEmail,
    };
  }

  // STEP 3 (read side) -- what this deployment can offer, straight from the
  // registry. Metadata and settings schema are read from each module's own
  // package files by moduleKey convention; a module that registers itself is
  // listed with zero console changes.
  async listAvailableModules(): Promise<AvailableModule[]> {
    const keys = this.registry.getRegisteredModuleKeys();

    return Promise.all(
      keys.map(async (moduleKey) => {
        const meta = await this.readModuleJson<{
          name?: string;
          description?: string;
        }>(moduleKey, 'config.json');
        const settingsSchema = await this.readModuleJson<
          Record<string, unknown>
        >(moduleKey, 'settings.schema.json');

        return {
          moduleKey,
          name: meta?.name ?? moduleKey,
          description: meta?.description ?? '',
          settingsSchema,
        };
      }),
    );
  }

  // STEP 3 (write side) -- manifest rows with enabled: true. Idempotent per
  // module so re-running the step never duplicates rows.
  async enableModules(tenantId: string, moduleKeys: string[]): Promise<void> {
    const registered = new Set(this.registry.getRegisteredModuleKeys());
    for (const key of moduleKeys) {
      if (!registered.has(key)) {
        throw new Error(`Unknown module: ${key}`);
      }
    }

    for (const key of moduleKeys) {
      await this.pool.query(
        `insert into module_manifest (tenant_id, module_key, enabled, config)
         select $1, $2, true, '{}'::jsonb
         where not exists (
           select 1 from module_manifest where tenant_id = $1 and module_key = $2
         )`,
        [tenantId, key],
      );
    }
  }

  // STEP 4 (save side) -- writes exactly where every module already reads its
  // settings: the config JSONB on that module's module_manifest row (the same
  // row the tenant dashboard's settings forms write). No new storage.
  async saveModuleConfig(
    tenantId: string,
    moduleKey: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.pool.query(
      `update module_manifest set config = $3 where tenant_id = $1 and module_key = $2`,
      [tenantId, moduleKey, JSON.stringify(config)],
    );
    if (result.rowCount === 0) {
      throw new Error(
        `Module ${moduleKey} is not enabled for this tenant -- enable it before configuring`,
      );
    }
  }

  // STEP 5 -- delegated wholesale to shared messaging, which owns numbers.
  provisionNumber(tenantId: string): Promise<TenantPhoneNumberRow> {
    return this.messaging.provisionNumberForTenant(tenantId, {
      makeDefault: true,
    });
  }

  // STEP 6 -- invite through Supabase Auth, then mirror into public.users
  // with role 'owner' so the custom access token hook stamps tenant_id and
  // app_role into their JWT at first login. The users insert is the tie to
  // the tenant; the hook does the rest at token time.
  async inviteOwner(tenantId: string, email: string): Promise<InvitedUser> {
    const trimmed = email?.trim();
    if (!trimmed) throw new Error('Email is required');

    const existing = await this.pool.query(
      `select 1 from users where tenant_id = $1 and email = $2`,
      [tenantId, trimmed],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new Error(`${trimmed} has already been invited to this tenant`);
    }

    const invited = await this.inviteClient.inviteUserByEmail(trimmed);

    await this.pool.query(
      `insert into users (id, tenant_id, email, role) values ($1, $2, $3, 'owner')`,
      [invited.userId, tenantId, trimmed],
    );

    return invited;
  }

  // STEP 8 -- one read powering every console screen, most importantly the
  // confirmation summary shown before Activate.
  async getState(tenantId: string): Promise<OnboardingState> {
    const tenant = await this.pool.query<{ name: string; status: string }>(
      `select name, status from tenants where id = $1`,
      [tenantId],
    );
    if (tenant.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    const subscription = await this.pool.query<{ plan: string }>(
      `select plan from subscriptions where tenant_id = $1 order by created_at desc limit 1`,
      [tenantId],
    );
    const modules = await this.pool.query<OnboardingModuleState>(
      `select module_key as "moduleKey", enabled, config from module_manifest where tenant_id = $1 order by module_key`,
      [tenantId],
    );
    const number = await this.pool.query<{ phone_number: string }>(
      `select phone_number from shared_messaging.tenant_phone_numbers
       where tenant_id = $1 and status = 'active' and is_default = true limit 1`,
      [tenantId],
    );
    const users = await this.pool.query<{ email: string; role: string }>(
      `select email, role from users where tenant_id = $1 order by created_at`,
      [tenantId],
    );

    return {
      tenantId,
      name: tenant.rows[0].name,
      status: tenant.rows[0].status,
      plan: subscription.rows[0]?.plan ?? null,
      modules: modules.rows,
      defaultNumber: number.rows[0]?.phone_number ?? null,
      invitedUsers: users.rows,
    };
  }

  // STEP 7 -- the deliberate, confirmed flip to live. Guarded to 'onboarding'
  // tenants so a double-click (or a replayed request) cannot re-activate and
  // duplicate the welcome notification.
  async activate(tenantId: string): Promise<{ status: string }> {
    const updated = await this.pool.query(
      `update tenants set status = 'active' where id = $1 and status = 'onboarding'`,
      [tenantId],
    );
    if (updated.rowCount === 0) {
      throw new Error('Tenant is not in onboarding status');
    }

    await this.pool.query(
      `insert into notifications (tenant_id, title, body) values ($1, $2, $3)`,
      [tenantId, WELCOME_NOTIFICATION.title, WELCOME_NOTIFICATION.body],
    );

    return { status: 'active' };
  }

  private async readModuleJson<T>(
    moduleKey: string,
    file: string,
  ): Promise<T | null> {
    for (const dir of MODULES_DIR_CANDIDATES) {
      try {
        const raw = await readFile(join(dir, moduleKey, file), 'utf8');
        return JSON.parse(raw) as T;
      } catch {
        // Try the next candidate location.
      }
    }
    // A module without this file is listable, just without metadata or a
    // settings form -- not an error.
    return null;
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}
