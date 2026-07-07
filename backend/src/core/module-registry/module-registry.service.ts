import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

interface ModuleManifestRow {
  module_key: string;
  config: Record<string, unknown>;
}

// Deliberately dumb: reads module_manifest and nothing else. No knowledge of
// what any module_key means or does -- that belongs to the modules themselves.
@Injectable()
export class ModuleRegistryService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

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

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
