import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { ModuleRegistryService } from './module-registry.service';

describe('ModuleRegistryService', () => {
  let service: ModuleRegistryService;
  let setupClient: Client;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();

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
      `insert into tenants (id, name, status) values ($1, 'Module Registry Test Tenant', 'active'), ($2, 'Module Registry Other Tenant', 'active')`,
      [tenantId, otherTenantId],
    );
    // Only the first tenant gets a module_manifest row -- the second exists
    // purely to prove the service returns nothing when there's nothing to find.
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'fake-module', true, $2)`,
      [tenantId, JSON.stringify({ foo: 'bar' })],
    );

    service = new ModuleRegistryService();
  });

  afterAll(async () => {
    await setupClient.query(
      'delete from module_manifest where tenant_id in ($1, $2)',
      [tenantId, otherTenantId],
    );
    await setupClient.query('delete from tenants where id in ($1, $2)', [
      tenantId,
      otherTenantId,
    ]);
    await setupClient.end();
    await service.onModuleDestroy();
  });

  it('returns the enabled modules for the given tenant', async () => {
    const modules = await service.getEnabledModules(tenantId);

    expect(modules).toEqual([
      { moduleKey: 'fake-module', config: { foo: 'bar' } },
    ]);
  });

  it('returns nothing for a tenant with no module_manifest rows', async () => {
    const modules = await service.getEnabledModules(otherTenantId);

    expect(modules).toEqual([]);
  });
});
