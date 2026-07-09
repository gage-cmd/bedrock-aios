/**
 * Complements tenant-isolation.spec.ts, which proves the RLS policy blocks
 * cross-tenant reads for a PostgREST-style `authenticated` session. That
 * matters, but it is not the path a real request takes: every app service
 * (this one included) connects with the pooler's default role, which
 * BYPASSES RLS entirely -- see the Pool config in executive-oversight.service.ts.
 * On that path, the WHERE clause in the service method is the only thing
 * standing between tenants.
 *
 * This spec calls ExecutiveOversightService.getReport(...) directly -- the
 * exact method the dashboard controller calls -- to prove that clause holds:
 * Tenant A's tenantId can never retrieve a report row that belongs to
 * Tenant B, even when Tenant A supplies Tenant B's real report id.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ExecutiveOversightService } from './executive-oversight.service';

describe('ExecutiveOversightService (app-layer cross-tenant access)', () => {
  let setupClient: Client;
  let registry: ModuleRegistryService;
  let service: ExecutiveOversightService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const weekOf = '2026-06-29';
  let reportAId: string;
  let reportBId: string;

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
      `insert into tenants (id, name, status) values ($1, 'Cross-Tenant Test A', 'active'), ($2, 'Cross-Tenant Test B', 'active')`,
      [tenantAId, tenantBId],
    );

    const inserted = await setupClient.query<{ id: string; tenant_id: string }>(
      `insert into executive_oversight.weekly_reports (tenant_id, week_of, generated_at, report_data, status)
         values ($1, $3, now(), '{"sections":{}}'::jsonb, 'generated'),
                ($2, $3, now(), '{"sections":{}}'::jsonb, 'generated')
         returning id, tenant_id`,
      [tenantAId, tenantBId, weekOf],
    );
    reportAId = inserted.rows.find((r) => r.tenant_id === tenantAId)!.id;
    reportBId = inserted.rows.find((r) => r.tenant_id === tenantBId)!.id;

    registry = new ModuleRegistryService();
    // getReport/listReports never touch this.registry -- report generation is
    // exercised separately in executive-oversight.service.spec.ts.
    service = new ExecutiveOversightService(registry);
  });

  afterAll(async () => {
    await setupClient.query(
      `delete from executive_oversight.weekly_reports where tenant_id in ($1, $2)`,
      [tenantAId, tenantBId],
    );
    await setupClient.query(`delete from tenants where id in ($1, $2)`, [
      tenantAId,
      tenantBId,
    ]);
    await setupClient.end();
    await service.onModuleDestroy();
    await registry.onModuleDestroy();
  });

  it("returns null when Tenant A requests Tenant B's report id (IDOR attempt)", async () => {
    const result = await service.getReport(tenantAId, reportBId);
    expect(result).toBeNull();
  });

  it("returns null when Tenant B requests Tenant A's report id (IDOR attempt, reverse direction)", async () => {
    const result = await service.getReport(tenantBId, reportAId);
    expect(result).toBeNull();
  });

  it('still lets Tenant A fetch their own report by id', async () => {
    const result = await service.getReport(tenantAId, reportAId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(reportAId);
  });

  it("never surfaces Tenant B's report in Tenant A's report list", async () => {
    const list = await service.listReports(tenantAId);
    expect(list.map((r) => r.id)).not.toContain(reportBId);
    expect(list.map((r) => r.id)).toContain(reportAId);
  });
});
