// Dev-only, one-off, idempotent: maps a tenant's existing module rows into
// value_events so the value hero is not $0 the day the ledger ships. Uses
// the same estimation math as the live write paths (module config with the
// same defaults), and ValueLedgerService.record's source_ref idempotency
// makes re-runs no-ops.
//
// Usage: pnpm ts-node scripts/backfill-value-events.ts <tenantId>

process.env.REPORT_SCHEDULER_DISABLED = 'true';

import 'dotenv/config';
import { Pool } from 'pg';
import { ValueLedgerService } from '../src/shared/value-ledger/value-ledger.service';
import {
  DEFAULT_AVG_JOB_VALUE_DOLLARS,
  DEFAULT_BOOKING_RATE_PERCENT,
} from '../src/modules/missed-call-textback/missed-call-textback.service';
import { DEFAULT_REVIEW_VALUE_DOLLARS } from '../src/modules/review-generation/public-review.service';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error(
      'Usage: pnpm ts-node scripts/backfill-value-events.ts <tenantId>',
    );
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const ledger = new ValueLedgerService();

  const configs = await pool.query<{
    module_key: string;
    config: Record<string, unknown>;
  }>(
    `select module_key, config from module_manifest where tenant_id = $1 and enabled`,
    [tenantId],
  );
  const configByModule = new Map(
    configs.rows.map((r) => [r.module_key, r.config]),
  );

  // Missed calls: every sent text-back is one estimated recovery.
  const mctConfig = configByModule.get('missed-call-textback') ?? {};
  const avgJobValue =
    typeof mctConfig.avgJobValue === 'number' && mctConfig.avgJobValue > 0
      ? mctConfig.avgJobValue
      : DEFAULT_AVG_JOB_VALUE_DOLLARS;
  const bookingRatePercent =
    typeof mctConfig.bookingRatePercent === 'number' &&
    mctConfig.bookingRatePercent > 0
      ? mctConfig.bookingRatePercent
      : DEFAULT_BOOKING_RATE_PERCENT;
  const recoveredCents = Math.round(
    avgJobValue * 100 * (bookingRatePercent / 100),
  );

  const missedCalls = await pool.query<{ id: string; missed_at: Date }>(
    `select id, missed_at from missed_call_textback.missed_calls
     where tenant_id = $1 and textback_sent`,
    [tenantId],
  );
  let recorded = 0;
  let duplicates = 0;
  for (const row of missedCalls.rows) {
    const outcome = await ledger.record({
      tenantId,
      moduleKey: 'missed-call-textback',
      eventType: 'missed_call_recovered',
      amountCents: recoveredCents,
      basis: 'estimated',
      basisNote: `avg job value $${avgJobValue} x ${bookingRatePercent}% booking rate`,
      sourceRef: row.id,
      occurredAt: row.missed_at,
    });
    outcome === 'recorded' ? recorded++ : duplicates++;
  }

  // Reviews: every Google-routed response is one estimated review value.
  const rgConfig = configByModule.get('review-generation') ?? {};
  const reviewValue =
    typeof rgConfig.reviewValue === 'number' && rgConfig.reviewValue > 0
      ? rgConfig.reviewValue
      : DEFAULT_REVIEW_VALUE_DOLLARS;

  const responses = await pool.query<{ id: string; submitted_at: Date }>(
    `select id, submitted_at from review_generation.review_responses
     where tenant_id = $1 and routed_to_google`,
    [tenantId],
  );
  for (const row of responses.rows) {
    const outcome = await ledger.record({
      tenantId,
      moduleKey: 'review-generation',
      eventType: 'review_completed',
      amountCents: Math.round(reviewValue * 100),
      basis: 'estimated',
      basisNote: `configured value of one new public review: $${reviewValue}`,
      sourceRef: row.id,
      occurredAt: row.submitted_at,
    });
    outcome === 'recorded' ? recorded++ : duplicates++;
  }

  const summary = await ledger.summary(tenantId);
  console.log(
    `backfill done: ${recorded} recorded, ${duplicates} already present`,
  );
  console.log(
    `tenant summary: week $${(summary.weekTotalCents / 100).toFixed(2)}, all-time $${(summary.allTimeCents / 100).toFixed(2)}, basis ${summary.basis}`,
  );

  await pool.end();
  process.exit(0);
}

void main();
