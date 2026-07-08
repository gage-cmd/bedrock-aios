import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { ModuleContract } from './module-contract';
import { ModuleRegistryService } from './module-registry.service';

function fakeModule(capabilities: string[]): ModuleContract {
  return {
    handleRequest: jest.fn(),
    getSnapshot: jest.fn(),
    getStatus: jest.fn(),
    getCapabilities: () => capabilities,
  };
}

describe('ModuleRegistryService', () => {
  let service: ModuleRegistryService;
  let setupClient: Client;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const capabilitiesTenantId = randomUUID();

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
      `insert into tenants (id, name, status) values ($1, 'Module Registry Test Tenant', 'active'), ($2, 'Module Registry Other Tenant', 'active'), ($3, 'Module Registry Capabilities Tenant', 'active')`,
      [tenantId, otherTenantId, capabilitiesTenantId],
    );
    // Only the first tenant gets a module_manifest row -- the second exists
    // purely to prove the service returns nothing when there's nothing to find.
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'fake-module', true, $2)`,
      [tenantId, JSON.stringify({ foo: 'bar' })],
    );
    // The third tenant exercises getCapabilitiesForTenant: two enabled modules
    // with registered instances, one enabled module with no instance (must be
    // skipped), and one disabled module (must be excluded by the manifest).
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values
         ($1, 'alpha-module', true, '{}'),
         ($1, 'beta-module', true, '{}'),
         ($1, 'ghost-module', true, '{}'),
         ($1, 'disabled-module', false, '{}')`,
      [capabilitiesTenantId],
    );

    service = new ModuleRegistryService();
    service.registerModule(
      'alpha-module',
      fakeModule(['Alpha question one', 'Alpha question two']),
    );
    service.registerModule('beta-module', fakeModule(['Beta question']));
    service.registerModule(
      'disabled-module',
      fakeModule(['Should never appear']),
    );
  });

  afterAll(async () => {
    await setupClient.query(
      'delete from module_manifest where tenant_id in ($1, $2, $3)',
      [tenantId, otherTenantId, capabilitiesTenantId],
    );
    await setupClient.query('delete from tenants where id in ($1, $2, $3)', [
      tenantId,
      otherTenantId,
      capabilitiesTenantId,
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

  describe('getCapabilitiesForTenant', () => {
    it('combines capabilities from every enabled, registered module, tagged by module', async () => {
      const capabilities =
        await service.getCapabilitiesForTenant(capabilitiesTenantId);

      expect(capabilities).toEqual(
        expect.arrayContaining([
          { moduleKey: 'alpha-module', capability: 'Alpha question one' },
          { moduleKey: 'alpha-module', capability: 'Alpha question two' },
          { moduleKey: 'beta-module', capability: 'Beta question' },
        ]),
      );
      expect(capabilities).toHaveLength(3);
    });

    it('skips enabled modules with no registered instance and excludes disabled modules', async () => {
      const capabilities =
        await service.getCapabilitiesForTenant(capabilitiesTenantId);

      const keys = capabilities.map((c) => c.moduleKey);
      expect(keys).not.toContain('ghost-module');
      expect(keys).not.toContain('disabled-module');
    });

    it('returns an empty list for a tenant with no enabled modules', async () => {
      const capabilities =
        await service.getCapabilitiesForTenant(otherTenantId);

      expect(capabilities).toEqual([]);
    });
  });
});
