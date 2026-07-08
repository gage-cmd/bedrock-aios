import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// Type-only import: erased at compile time so pg-boss (a pure-ESM package) is
// never pulled into the CJS/ts-jest module graph. The runtime value is loaded
// lazily via dynamic import() inside onModuleInit, after the test guard.
import type { PgBoss, ConstructorOptions } from 'pg-boss';
import { ExecutiveOversightService } from './executive-oversight.service';

const QUEUE = 'executive-oversight-weekly-reports';

// pg-boss (the project's chosen job queue) needs SESSION-level Postgres
// features -- advisory locks for its maintenance singleton, and a stable
// connection for its supervisor clock -- which Supabase's TRANSACTION pooler
// (the port the app's query pools use) does not support. So the queue gets
// its own connection on the SESSION-mode pooler: same host/creds, port from
// REPORT_QUEUE_DB_PORT (default 5432), overridable wholesale with
// REPORT_QUEUE_DATABASE_URL.
function queueConnection(): ConstructorOptions {
  if (process.env.REPORT_QUEUE_DATABASE_URL) {
    return {
      connectionString: process.env.REPORT_QUEUE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      schema: 'pgboss',
    };
  }
  return {
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.REPORT_QUEUE_DB_PORT ?? 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
  };
}

// Weekly scheduler for the Executive Oversight report engine. On boot it
// starts pg-boss, ensures the queue exists, registers a worker that generates
// a report for EVERY active tenant, and installs a weekly cron schedule that
// drops one job onto that queue. Boot cost is one job per week; the fan-out
// over tenants happens inside the worker.
@Injectable()
export class ReportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private boss?: PgBoss;

  constructor(private readonly reports: ExecutiveOversightService) {}

  async onModuleInit(): Promise<void> {
    // Never start the queue under tests -- specs exercise generation directly
    // and must not open a background worker/scheduler against the DB.
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.REPORT_SCHEDULER_DISABLED === 'true') return;

    // Lazy ESM load -- only reached in a real (non-test) boot.
    const { PgBoss } = await import('pg-boss');
    const boss = new PgBoss(queueConnection());
    boss.on('error', (err) =>
      console.error('[report-scheduler] pg-boss error:', err),
    );
    await boss.start();
    await boss.createQueue(QUEUE);

    await boss.work(QUEUE, async () => {
      await this.runWeeklyBatch();
    });

    // Default: Mondays 08:00. Cron and timezone are configurable, never
    // hardcoded at the schedule call.
    const cron = process.env.REPORT_SCHEDULE_CRON ?? '0 8 * * 1';
    const tz = process.env.REPORT_SCHEDULE_TZ ?? 'UTC';
    await boss.schedule(QUEUE, cron, {}, { tz });

    this.boss = boss;
    console.log(
      `[report-scheduler] weekly report schedule active (cron "${cron}" ${tz})`,
    );
  }

  // Generate this week's report for every active tenant. One tenant's failure
  // is logged and skipped so it never halts the batch -- and generateReport
  // already stores its own 'failed' row for AI/synthesis failures.
  async runWeeklyBatch(): Promise<void> {
    const tenantIds = await this.reports.getActiveTenantIds();
    console.log(
      `[report-scheduler] generating weekly reports for ${tenantIds.length} active tenant(s)`,
    );
    for (const tenantId of tenantIds) {
      try {
        await this.reports.generateReport(tenantId);
      } catch (err) {
        console.error(
          `[report-scheduler] report generation threw for tenant ${tenantId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) {
      await this.boss.stop();
    }
  }
}
