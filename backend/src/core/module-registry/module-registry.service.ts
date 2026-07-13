import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';
import {
  ModuleContract,
  ModuleStatus,
  SnapshotV2,
  TenantCapability,
} from './module-contract';
import {
  SettingsSchemaShape,
  validateAndSanitizeConfig,
} from './module-settings';

export interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

// Everything a settings surface needs to render one module's form: the schema
// to build it from, the tenant's current values, whether it's enabled, and the
// module's own health verdict for the status indicator. Any field is null when
// unavailable (no schema shipped, module not enabled for the tenant, or no live
// instance in this deployment) -- the surface degrades rather than errors.
export interface ModuleSettings {
  schema: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  status: ModuleStatus | null;
  enabled: boolean;
}

export interface ModuleMetadata {
  name: string;
  description: string;
}

// One entry per enabled module in the batched status read. `status: null`
// means unknown -- the module is in the tenant's manifest but has no live
// instance in this deployment, same semantics as the per-module route
// 404-ing (the dashboard shows a neutral dot).
export interface ModuleStatusEntry {
  moduleKey: string;
  status: ModuleStatus | null;
}

// One entry per enabled module in the batched snapshot read, same
// degradation semantics as ModuleStatusEntry: `snapshot: null` means this
// module could not produce one right now (no live instance, error, or
// timeout) -- the card renders its unavailable state while the rest of the
// dashboard stays intact.
export interface ModuleSnapshotEntry {
  moduleKey: string;
  name: string;
  snapshot: SnapshotV2 | null;
}

// A hung getStatus in one module must degrade that one entry, never stall
// the whole batch. Read at call time (not module load) so tests can tighten
// it per-case -- same pattern as the orchestrator's module timeout.
function statusTimeoutMs(): number {
  return Number(process.env.MODULE_STATUS_TIMEOUT_MS ?? 10_000);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`status check timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// Where module packages live on disk. Two candidates, first readable file
// wins: (1) relative to this file -- src/core/module-registry/../../modules
// under ts-jest, and the compiled tree's modules dir in a build (nest-cli
// assets copy each module's *.json next to the compiled output); (2) the
// source tree relative to the working directory, since every entrypoint (npm
// start, jest, start:prod) runs from backend/. Keeps the module list
// resilient to the compiled layout shifting (dist/ vs dist/src/).
const MODULES_DIR_CANDIDATES = [
  join(__dirname, '..', '..', 'modules'),
  join(process.cwd(), 'src', 'modules'),
];

interface ModuleManifestRow {
  module_key: string;
  config: Record<string, unknown>;
}

// Knows two things and nothing else: what module_manifest says is enabled per
// tenant, and which live ModuleContract instances registered themselves at
// boot. It has no knowledge of what any module_key means or does -- that
// belongs to the modules themselves, which is why instances arrive via
// registerModule (a module -> core dependency) rather than the registry
// importing module code (core -> module, forbidden by the boundaries rule).
@Injectable()
export class ModuleRegistryService implements OnModuleDestroy {
  private readonly instances = new Map<string, ModuleContract>();

  private readonly pool = getSharedPool();

  registerModule(moduleKey: string, instance: ModuleContract): void {
    this.instances.set(moduleKey, instance);
  }

  getModuleInstance(moduleKey: string): ModuleContract | undefined {
    return this.instances.get(moduleKey);
  }

  // Every module key that registered itself at boot -- i.e. what this
  // deployment actually ships, independent of any tenant's manifest. The
  // onboarding console builds its "enable modules" list from this, so a new
  // module appears there by virtue of registering, with no console change.
  getRegisteredModuleKeys(): string[] {
    return [...this.instances.keys()];
  }

  // Reads a module's own JSON package file (config.json, settings.schema.json)
  // by moduleKey convention. Returns null if the module ships no such file --
  // that's listable, just without the metadata/schema it would have provided.
  // Shared by the onboarding console (settings schema + metadata) and any
  // dashboard surface that needs a module's display name/description without
  // hardcoding it.
  async readModuleFile<T>(moduleKey: string, file: string): Promise<T | null> {
    for (const dir of MODULES_DIR_CANDIDATES) {
      try {
        const raw = await readFile(join(dir, moduleKey, file), 'utf8');
        return JSON.parse(raw) as T;
      } catch {
        // Try the next candidate location.
      }
    }
    return null;
  }

  async getModuleMetadata(moduleKey: string): Promise<ModuleMetadata | null> {
    const meta = await this.readModuleFile<{
      name?: string;
      description?: string;
    }>(moduleKey, 'config.json');
    if (!meta) return null;
    return {
      name: meta.name ?? moduleKey,
      description: meta.description ?? '',
    };
  }

  async getEnabledModules(tenantId: string): Promise<EnabledModule[]> {
    const result = await this.pool.query<ModuleManifestRow>(
      'select module_key, config from module_manifest where tenant_id = $1 and enabled = true',
      [tenantId],
    );

    return result.rows.map((row) => ({
      moduleKey: row.module_key,
      config: row.config,
    }));
  }

  // The one place module config is persisted, shared by the admin Onboarding
  // Console and the tenant dashboard's settings form -- so both validate the
  // exact same way and neither can write around the schema. Callers are
  // responsible for their own authorization (the console mounts AdminGuard; the
  // tenant route enforces owner-only) before reaching here.
  //
  //  1. The module must actually be registered in this deployment -- rejects a
  //     write to an unknown/typo'd moduleKey outright.
  //  2. The config is validated against the module's own settings.schema.json
  //     (required fields present, known fields the right type/format/pattern);
  //     unknown keys are dropped. A module shipping no schema saves as-is.
  //  3. Only an already-enabled row is updated -- enabling a module is an
  //     onboarding concern, so a save for a not-yet-enabled module is refused
  //     rather than silently creating a row.
  async saveModuleConfig(
    tenantId: string,
    moduleKey: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    if (!this.instances.has(moduleKey)) {
      throw new Error(`Unknown module: ${moduleKey}`);
    }

    const schema = await this.readModuleFile<SettingsSchemaShape>(
      moduleKey,
      'settings.schema.json',
    );
    const toSave = schema
      ? validateAndSanitizeConfig(moduleKey, schema, config)
      : config;

    const result = await this.pool.query(
      `update module_manifest set config = $3 where tenant_id = $1 and module_key = $2`,
      [tenantId, moduleKey, JSON.stringify(toSave)],
    );
    if (result.rowCount === 0) {
      throw new Error(
        `Module ${moduleKey} is not enabled for this tenant -- enable it before configuring`,
      );
    }
  }

  // Everything a settings form needs for one module, in a single round trip:
  // its schema, the tenant's current config, its enabled flag, and its live
  // getStatus() verdict for the status indicator. tenantId is always the
  // caller's own (from the request context), never client-supplied.
  async getModuleSettings(
    tenantId: string,
    moduleKey: string,
  ): Promise<ModuleSettings> {
    const schema = await this.readModuleFile<Record<string, unknown>>(
      moduleKey,
      'settings.schema.json',
    );

    const row = await this.pool.query<{ config: Record<string, unknown> }>(
      `select config from module_manifest
       where tenant_id = $1 and module_key = $2 and enabled = true`,
      [tenantId, moduleKey],
    );
    const enabled = (row.rowCount ?? 0) > 0;

    const instance = this.instances.get(moduleKey);
    const status = instance ? await instance.getStatus(tenantId) : null;

    return {
      schema,
      config: enabled ? row.rows[0].config : null,
      status,
      enabled,
    };
  }

  // Every enabled module's live getStatus() verdict in one call -- the
  // batched read behind GET /module-manifest/status, replacing the
  // one-request-per-module pattern the dashboard status strip used to fire
  // on every page. One module throwing or hanging degrades to a
  // needs-attention entry for that module only; the batch itself never
  // fails.
  async getStatusesForTenant(tenantId: string): Promise<ModuleStatusEntry[]> {
    const enabled = await this.getEnabledModules(tenantId);

    return Promise.all(
      enabled.map(async ({ moduleKey }) => {
        const instance = this.instances.get(moduleKey);
        if (!instance) return { moduleKey, status: null };

        try {
          const status = await withTimeout(
            instance.getStatus(tenantId),
            statusTimeoutMs(),
          );
          return { moduleKey, status };
        } catch (err) {
          console.error(
            `[module-registry] getStatus failed for "${moduleKey}", tenant ${tenantId}:`,
            err instanceof Error ? err.message : err,
          );
          return {
            moduleKey,
            status: {
              status: 'needs attention' as const,
              reason: 'Could not check just now',
            },
          };
        }
      }),
    );
  }

  // Every enabled module's SnapshotV2 in one request -- the home page's one
  // data fetch. Same per-module degradation as getStatusesForTenant: a
  // broken or missing module yields `snapshot: null`, never a failed batch.
  async getSnapshotsForTenant(
    tenantId: string,
  ): Promise<ModuleSnapshotEntry[]> {
    const enabled = await this.getEnabledModules(tenantId);

    return Promise.all(
      enabled.map(async ({ moduleKey }) => {
        const meta = await this.getModuleMetadata(moduleKey);
        const name = meta?.name ?? moduleKey;
        const instance = this.instances.get(moduleKey);
        if (!instance) return { moduleKey, name, snapshot: null };

        try {
          const snapshot = await withTimeout(
            instance.getSnapshot(tenantId),
            statusTimeoutMs(),
          );
          return { moduleKey, name, snapshot };
        } catch (err) {
          console.error(
            `[module-registry] getSnapshot failed for "${moduleKey}", tenant ${tenantId}:`,
            err instanceof Error ? err.message : err,
          );
          return { moduleKey, name, snapshot: null };
        }
      }),
    );
  }

  // Combined, module-tagged capability list across every module that is both
  // enabled for the tenant (module_manifest) and actually running in this
  // process (registered instance). Manifest rows without a live instance are
  // skipped rather than an error -- a tenant can have a module enabled that
  // this deployment doesn't ship yet.
  async getCapabilitiesForTenant(
    tenantId: string,
  ): Promise<TenantCapability[]> {
    const enabled = await this.getEnabledModules(tenantId);

    const capabilities: TenantCapability[] = [];
    for (const { moduleKey } of enabled) {
      const instance = this.instances.get(moduleKey);
      if (!instance) continue;
      for (const capability of instance.getCapabilities()) {
        capabilities.push({ moduleKey, capability });
      }
    }
    return capabilities;
  }

  async onModuleDestroy(): Promise<void> {
    await closeSharedPool();
  }
}
