import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';
import type {
  ModuleContract,
  ModuleStatus,
  SnapshotV2,
} from '../../core/module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { ValueLedgerService } from '../../shared/value-ledger/value-ledger.service';
import {
  fillDailySeries,
  weekDelta,
} from '../../shared/snapshots/snapshot-helpers';

export interface MissedCallRow {
  id: string;
  tenant_id: string;
  contact_phone: string;
  missed_at: string;
  textback_sent: boolean;
  textback_body: string | null;
  created_at: string;
}

const DEFAULT_TEXTBACK_TEMPLATE =
  "Hi! You just called {business_name} and we couldn't pick up. Reply here and we'll get right back to you.";

export const DEFAULT_RING_TIMEOUT_SECONDS = 20;

// Estimation inputs for the value ledger, overridable per tenant in module
// settings. A recovered missed call is worth (average job value x booking
// rate) -- the math every recorded event shows in its basis_note.
export const DEFAULT_AVG_JOB_VALUE_DOLLARS = 180;
export const DEFAULT_BOOKING_RATE_PERCENT = 35;

export interface DialSettings {
  destinationNumber: string | null;
  ringTimeoutSeconds: number;
}

function renderTemplate(template: string, businessName: string): string {
  return template.replace(/{business_name}/g, businessName);
}

@Injectable()
export class MissedCallTextbackService
  implements ModuleContract, OnModuleDestroy
{
  private readonly pool = getSharedPool();

  constructor(
    private readonly messaging: MessagingService,
    private readonly valueLedger: ValueLedgerService,
  ) {}

  async handleRequest(
    tenantId: string,
    intent: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    switch (intent) {
      case 'log-missed-call':
        return this.logMissedCall(tenantId, payload as { phone: string });
      case 'get-recent-missed-calls':
        return this.getRecentMissedCalls(tenantId, payload);
      default:
        throw new Error(`Unknown missed-call-textback intent: ${intent}`);
    }
  }

  private async logMissedCall(
    tenantId: string,
    { phone }: { phone: string },
  ): Promise<MissedCallRow> {
    if (!phone) {
      throw new Error('Caller phone number is required');
    }

    const config = await this.getConfig(tenantId);
    const template =
      typeof config.textBackTemplate === 'string'
        ? config.textBackTemplate
        : DEFAULT_TEXTBACK_TEMPLATE;
    const businessName =
      typeof config.businessName === 'string' ? config.businessName : 'us';

    // Insert first with textback_sent defaulting to false. Unlike
    // review_requests (whose status column claims the send already
    // happened, so a failed send deletes the row), a missed call genuinely
    // occurred whether or not the text-back goes out -- on send failure the
    // row is kept, accurately recording an unrecovered missed call.
    const inserted = await this.pool.query<MissedCallRow>(
      `insert into missed_call_textback.missed_calls (tenant_id, contact_phone) values ($1, $2) returning *`,
      [tenantId, phone],
    );
    const missedCall = inserted.rows[0];

    const body = renderTemplate(template, businessName);
    await this.messaging.sendSms(tenantId, phone, body, {
      moduleKey: 'missed-call-textback',
    });

    const updated = await this.pool.query<MissedCallRow>(
      `update missed_call_textback.missed_calls set textback_sent = true, textback_body = $1 where id = $2 returning *`,
      [body, missedCall.id],
    );

    await this.pool.query(
      `insert into activity_log (tenant_id, module_key, event_type, value) values ($1, 'missed-call-textback', 'missed_call_textback_sent', $2)`,
      [
        tenantId,
        JSON.stringify({ missedCallId: missedCall.id, contactPhone: phone }),
      ],
    );

    await this.recordRecoveryValue(tenantId, missedCall.id, config);

    return updated.rows[0];
  }

  // A sent text-back is the recovery signal this schema can see (there is no
  // reply tracking yet), so the ledger event is honest about being an
  // estimate: tenant-configured average job value x booking rate.
  private async recordRecoveryValue(
    tenantId: string,
    missedCallId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const avgJobValue =
      typeof config.avgJobValue === 'number' && config.avgJobValue > 0
        ? config.avgJobValue
        : DEFAULT_AVG_JOB_VALUE_DOLLARS;
    const bookingRatePercent =
      typeof config.bookingRatePercent === 'number' &&
      config.bookingRatePercent > 0 &&
      config.bookingRatePercent <= 100
        ? config.bookingRatePercent
        : DEFAULT_BOOKING_RATE_PERCENT;

    const amountCents = Math.round(
      avgJobValue * 100 * (bookingRatePercent / 100),
    );
    await this.valueLedger.record({
      tenantId,
      moduleKey: 'missed-call-textback',
      eventType: 'missed_call_recovered',
      amountCents,
      basis: 'estimated',
      basisNote: `avg job value $${avgJobValue} x ${bookingRatePercent}% booking rate`,
      sourceRef: missedCallId,
    });
  }

  private async getRecentMissedCalls(
    tenantId: string,
    { limit = 20 }: { limit?: number } = {},
  ): Promise<MissedCallRow[]> {
    const result = await this.pool.query<MissedCallRow>(
      'select * from missed_call_textback.missed_calls where tenant_id = $1 order by missed_at desc limit $2',
      [tenantId, limit],
    );
    return result.rows;
  }

  async getSnapshot(tenantId: string): Promise<SnapshotV2> {
    const [counts, seriesRows, unrecovered, recent, weekValueCents] =
      await Promise.all([
        this.pool.query<{
          recovered_week: number;
          recovered_prior_week: number;
          unrecovered_week: number;
          recovered_all_time: number;
        }>(
          `select
           count(*) filter (where textback_sent and missed_at >= now() - interval '7 days')::int as recovered_week,
           count(*) filter (where textback_sent and missed_at >= now() - interval '14 days'
                            and missed_at < now() - interval '7 days')::int as recovered_prior_week,
           count(*) filter (where not textback_sent and missed_at >= now() - interval '7 days')::int as unrecovered_week,
           count(*) filter (where textback_sent)::int as recovered_all_time
         from missed_call_textback.missed_calls
         where tenant_id = $1`,
          [tenantId],
        ),
        this.pool.query<{ date: string; value: number }>(
          `select to_char(date_trunc('day', missed_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
                count(*)::int as value
         from missed_call_textback.missed_calls
         where tenant_id = $1 and textback_sent
           and missed_at >= now() - interval '14 days'
         group by 1`,
          [tenantId],
        ),
        this.pool.query<{ id: string; contact_phone: string }>(
          `select id, contact_phone from missed_call_textback.missed_calls
         where tenant_id = $1 and not textback_sent
           and missed_at >= now() - interval '7 days'
         order by missed_at desc limit 5`,
          [tenantId],
        ),
        this.pool.query<{
          contact_phone: string;
          missed_at: string;
          textback_sent: boolean;
        }>(
          `select contact_phone, missed_at, textback_sent
         from missed_call_textback.missed_calls
         where tenant_id = $1
         order by missed_at desc limit 5`,
          [tenantId],
        ),
        this.valueLedger.weeklyTotalCents(tenantId, 'missed-call-textback'),
      ]);

    const c = counts.rows[0];
    return {
      headline: {
        label: 'Missed calls recovered this week',
        value: `${c.recovered_week} text-back${c.recovered_week === 1 ? '' : 's'} sent`,
        ...(weekValueCents > 0 ? { dollarValue: weekValueCents / 100 } : {}),
      },
      metrics: [
        {
          key: 'recovered-week',
          label: 'Recovered this week',
          value: String(c.recovered_week),
          delta: weekDelta(c.recovered_week, c.recovered_prior_week),
        },
        {
          key: 'awaiting-week',
          label: 'Not yet texted back',
          value: String(c.unrecovered_week),
        },
        {
          key: 'recovered-all-time',
          label: 'Recovered all time',
          value: String(c.recovered_all_time),
        },
      ],
      series: {
        label: 'Text-backs sent per day',
        points: fillDailySeries(seriesRows.rows, 14),
      },
      attention: unrecovered.rows.map((row) => ({
        key: row.id,
        text: `${row.contact_phone} called and has not been texted back`,
        href: '/installed-systems/missed-call-textback?tab=activity',
      })),
      recentEvents: recent.rows.map((row) => ({
        at: new Date(row.missed_at).toISOString(),
        text: row.textback_sent
          ? `Missed call from ${row.contact_phone} — text-back sent`
          : `Missed call from ${row.contact_phone} — not yet texted back`,
      })),
    };
  }

  async getStatus(tenantId: string): Promise<ModuleStatus> {
    const result = await this.pool.query(
      `select 1 from shared_messaging.tenant_phone_numbers where tenant_id = $1 and status = 'active' limit 1`,
      [tenantId],
    );

    if (result.rows.length > 0) {
      return { status: 'connected' };
    }
    return { status: 'needs attention', reason: 'no SMS number provisioned' };
  }

  getCapabilities(): string[] {
    return [
      'How many missed calls did we recover this week',
      'Show me recent missed-call text-backs',
    ];
  }

  // Read-only intents the orchestrator may route to. log-missed-call is
  // deliberately absent -- the orchestrator answers questions, it must never
  // send a text-back on its own.
  getQueryableIntents(): { intent: string; description: string }[] {
    return [
      {
        intent: 'get-recent-missed-calls',
        description:
          'List recent missed calls for this business, including whether an automatic text-back was sent and what it said.',
      },
    ];
  }

  // Dial settings the Twilio voice webhook needs to forward an incoming call:
  // where to ring (destinationNumber) and for how long before it counts as
  // missed (ringTimeoutSeconds, defaulting to 20). destinationNumber is null
  // when the tenant hasn't configured one yet, so the webhook can decline to
  // dial rather than forward to nowhere.
  async getDialSettings(tenantId: string): Promise<DialSettings> {
    const config = await this.getConfig(tenantId);
    const destinationNumber =
      typeof config.destinationNumber === 'string' &&
      config.destinationNumber.length > 0
        ? config.destinationNumber
        : null;
    const ringTimeoutSeconds =
      typeof config.ringTimeoutSeconds === 'number' &&
      config.ringTimeoutSeconds > 0
        ? config.ringTimeoutSeconds
        : DEFAULT_RING_TIMEOUT_SECONDS;
    return { destinationNumber, ringTimeoutSeconds };
  }

  private async getConfig(tenantId: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{ config: Record<string, unknown> }>(
      `select config from module_manifest where tenant_id = $1 and module_key = 'missed-call-textback'`,
      [tenantId],
    );
    return result.rows[0]?.config ?? {};
  }

  async onModuleDestroy(): Promise<void> {
    await closeSharedPool();
  }
}
