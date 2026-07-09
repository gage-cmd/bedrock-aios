import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';
import { ModuleContract, TenantCapability } from './module-contract';

export interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

export interface ModuleMetadata {
  name: string;
  description: string;
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

  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

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
    const meta = await this.readModuleFile<{ name?: string; description?: string }>(
      moduleKey,
      'config.json',
    );
    if (!meta) return null;
    return { name: meta.name ?? moduleKey, description: meta.description ?? '' };
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
    await this.pool.end();
  }
}
