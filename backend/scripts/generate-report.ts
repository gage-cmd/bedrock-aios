// Dev-only manual tool for the Step 8 human quality read on a generated
// weekly report. NOT client-facing and NOT wired into any schedule -- it
// bootstraps the real Nest providers (so every module self-registers exactly
// as it does in production) and calls ExecutiveOversightService directly for
// one tenant, using whatever AiClient is currently configured (the real
// AnthropicAiClient reading REPORT_MODEL, since nothing in the DI graph ever
// supplies a stub outside of tests).
//
// Usage: pnpm ts-node scripts/generate-report.ts <tenantId>

// Must be set before AppModule is imported: ReportSchedulerService checks
// this in onModuleInit, and a one-off manual run must never stand up a live
// pg-boss worker + weekly cron schedule as a side effect.
process.env.REPORT_SCHEDULER_DISABLED = 'true';

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExecutiveOversightService } from '../src/core/executive-oversight/executive-oversight.service';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Usage: pnpm ts-node scripts/generate-report.ts <tenantId>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const reports = app.get(ExecutiveOversightService);

    console.log(`Generating weekly report for tenant ${tenantId}...`);
    const result = await reports.generateReport(tenantId);
    console.log(
      `Generation finished: status=${result.status} reportId=${result.reportId}`,
    );

    // Read it back through the same tenant-scoped path the dashboard uses --
    // confirms the row actually landed in weekly_reports, not just that
    // generateReport returned without throwing.
    const stored = await reports.getReport(tenantId, result.reportId);
    if (!stored) {
      console.error(
        `FAILED confirmation: no row found in weekly_reports for id ${result.reportId}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Confirmed: weekly_reports row ${stored.id} (week of ${stored.week_of}, status ${stored.status}).`,
    );

    const sections = stored.report_data.sections;
    if (sections) {
      console.log('\n--- Performance summary ---');
      console.log(sections.performance_summary || '(empty)');
      console.log('\n--- Wins ---');
      console.log(sections.wins || '(empty)');
      console.log('\n--- Issues ---');
      console.log(sections.issues || '(empty)');
      console.log('\n--- Opportunities ---');
      console.log(sections.opportunities || '(empty)');
      console.log('\n--- Recommendations ---');
      console.log(sections.recommendations || '(empty)');
    }

    console.log('\n--- Full report_data ---');
    console.log(JSON.stringify(stored.report_data, null, 2));

    process.exitCode = result.status === 'generated' ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('generate-report script failed:', err);
  process.exit(1);
});
