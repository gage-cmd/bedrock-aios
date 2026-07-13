import { Injectable } from '@nestjs/common';
import { getSharedPool } from '../db/pg-pool';

// The recovered-revenue ledger (value_events). Modules record an event when
// they create value for the tenant; the dashboard hero, module snapshots,
// and weekly reports read sums from here. Never show a dollar figure that
// does not come out of this table, and never drop the basis: 'estimated'
// rows derive from the tenant's own configured averages (math in
// basis_note), 'verified' rows are reserved for real payment records.

export interface ValueEvent {
  tenantId: string;
  moduleKey: string;
  eventType: string;
  amountCents: number;
  basis: 'estimated' | 'verified';
  basisNote: string;
  sourceRef?: string; // row id in the module's own table; enables idempotency
  occurredAt?: Date; // defaults to now() in the DB
}

export interface ValueSummary {
  weekTotalCents: number;
  allTimeCents: number;
  weeklySeries: Array<{ date: string; value: number }>; // daily cents, ascending
  basis: 'estimated' | 'verified' | 'mixed' | null; // null = no events yet
}

@Injectable()
export class ValueLedgerService {
  private readonly pool = getSharedPool();

  // Idempotent on (tenant, module, event type, source_ref): recording the
  // same source row twice is a no-op, so webhook retries and backfill
  // re-runs cannot double-count.
  async record(event: ValueEvent): Promise<'recorded' | 'duplicate'> {
    const result = await this.pool.query(
      `insert into value_events
         (tenant_id, module_key, event_type, amount_cents, basis, basis_note, source_ref, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, now()))
       on conflict (tenant_id, module_key, event_type, source_ref)
         where source_ref is not null
         do nothing
       returning id`,
      [
        event.tenantId,
        event.moduleKey,
        event.eventType,
        event.amountCents,
        event.basis,
        event.basisNote,
        event.sourceRef ?? null,
        event.occurredAt ?? null,
      ],
    );
    return result.rows.length > 0 ? 'recorded' : 'duplicate';
  }

  async weeklyTotalCents(
    tenantId: string,
    moduleKey?: string,
  ): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `select coalesce(sum(amount_cents), 0)::bigint as total
       from value_events
       where tenant_id = $1
         and occurred_at >= now() - interval '7 days'
         and ($2::text is null or module_key = $2)`,
      [tenantId, moduleKey ?? null],
    );
    return Number(result.rows[0].total);
  }

  async summary(tenantId: string): Promise<ValueSummary> {
    const [totals, series] = await Promise.all([
      this.pool.query<{
        week_total: string;
        all_time: string;
        bases: string[] | null;
      }>(
        `select
           coalesce(sum(amount_cents) filter (where occurred_at >= now() - interval '7 days'), 0)::bigint as week_total,
           coalesce(sum(amount_cents), 0)::bigint as all_time,
           array_agg(distinct basis) as bases
         from value_events
         where tenant_id = $1`,
        [tenantId],
      ),
      this.pool.query<{ date: string; value: number }>(
        `select to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
                sum(amount_cents)::int as value
         from value_events
         where tenant_id = $1 and occurred_at >= now() - interval '7 days'
         group by 1 order by 1`,
        [tenantId],
      ),
    ]);

    const t = totals.rows[0];
    const bases = t.bases ?? [];
    return {
      weekTotalCents: Number(t.week_total),
      allTimeCents: Number(t.all_time),
      weeklySeries: series.rows,
      basis:
        bases.length === 0
          ? null
          : bases.length > 1
            ? 'mixed'
            : (bases[0] as 'estimated' | 'verified'),
    };
  }
}
