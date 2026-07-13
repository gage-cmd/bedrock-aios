/**
 * Integration spec for the value_events ledger: RLS tenant isolation
 * (adapted from core/tenant-resolver/tenant-isolation.template.spec.ts),
 * idempotency on source_ref, and the summary sums the dashboard hero reads.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { ValueLedgerService } from './value-ledger.service';
import { closeSharedPool } from '../db/pg-pool';

describe('value_events ledger', () => {
  let client: Client;
  let service: ValueLedgerService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const sourceRef = randomUUID();

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

    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Ledger Test Tenant A', 'active'), ($2, 'Ledger Test Tenant B', 'active')`,
      [tenantAId, tenantBId],
    );

    service = new ValueLedgerService();
  });

  afterAll(async () => {
    await client.query(`delete from value_events where tenant_id in ($1, $2)`, [
      tenantAId,
      tenantBId,
    ]);
    await client.query(`delete from tenants where id in ($1, $2)`, [
      tenantAId,
      tenantBId,
    ]);
    await client.end();
    await closeSharedPool();
  });

  it('records an event and is idempotent on the same source_ref', async () => {
    const event = {
      tenantId: tenantAId,
      moduleKey: 'missed-call-textback',
      eventType: 'missed_call_recovered',
      amountCents: 6300,
      basis: 'estimated' as const,
      basisNote: 'avg job value $180 x 35% booking rate',
      sourceRef,
    };

    expect(await service.record(event)).toBe('recorded');
    expect(await service.record(event)).toBe('duplicate');

    const rows = await client.query<{
      amount_cents: number;
      basis: string;
      basis_note: string;
    }>(
      `select amount_cents, basis, basis_note from value_events where tenant_id = $1`,
      [tenantAId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].amount_cents).toBe(6300);
    expect(rows.rows[0].basis).toBe('estimated');
    expect(rows.rows[0].basis_note).toContain('$180');
  });

  it('sums per tenant and per module, never across tenants', async () => {
    await service.record({
      tenantId: tenantBId,
      moduleKey: 'review-generation',
      eventType: 'review_completed',
      amountCents: 2500,
      basis: 'estimated',
      basisNote: 'configured value of one new public review: $25',
      sourceRef: randomUUID(),
    });

    expect(await service.weeklyTotalCents(tenantAId)).toBe(6300);
    expect(
      await service.weeklyTotalCents(tenantAId, 'missed-call-textback'),
    ).toBe(6300);
    expect(await service.weeklyTotalCents(tenantAId, 'review-generation')).toBe(
      0,
    );
    expect(await service.weeklyTotalCents(tenantBId)).toBe(2500);
  });

  it('summary returns week/all-time totals, a daily series, and the basis', async () => {
    const summary = await service.summary(tenantAId);

    expect(summary.weekTotalCents).toBe(6300);
    expect(summary.allTimeCents).toBe(6300);
    expect(summary.basis).toBe('estimated');
    expect(summary.weeklySeries.length).toBeGreaterThanOrEqual(1);
    expect(summary.weeklySeries.reduce((sum, p) => sum + p.value, 0)).toBe(
      6300,
    );
  });

  it('summary is empty-safe for a tenant with no events', async () => {
    const emptyTenant = randomUUID();
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Ledger Empty Tenant', 'active')`,
      [emptyTenant],
    );
    try {
      const summary = await service.summary(emptyTenant);
      expect(summary).toEqual({
        weekTotalCents: 0,
        allTimeCents: 0,
        weeklySeries: [],
        basis: null,
      });
    } finally {
      await client.query(`delete from tenants where id = $1`, [emptyTenant]);
    }
  });

  // RLS proof, same shape as every other tenant-isolation spec: switch into
  // the authenticated role with tenant A's claims and try to read tenant B.
  it("blocks Tenant A from reading Tenant B's value events via RLS", async () => {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ tenant_id: tenantAId, role: 'authenticated' }),
    ]);

    const crossTenant = await client.query(
      'select * from value_events where tenant_id = $1',
      [tenantBId],
    );
    expect(crossTenant.rows).toHaveLength(0);

    const ownRows = await client.query<{ tenant_id: string }>(
      'select * from value_events',
    );
    expect(ownRows.rows).toHaveLength(1);
    expect(ownRows.rows[0].tenant_id).toBe(tenantAId);

    await client.query('rollback');
  });

  it('proves the block above is RLS, not a filter -- the row genuinely exists', async () => {
    const result = await client.query(
      'select * from value_events where tenant_id = $1',
      [tenantBId],
    );
    expect(result.rows).toHaveLength(1);
  });
});
