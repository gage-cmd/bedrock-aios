import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ModuleContract, TenantCapability } from './module-contract';

export interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

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
