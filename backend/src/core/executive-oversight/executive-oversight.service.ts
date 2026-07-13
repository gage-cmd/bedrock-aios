import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { AnthropicAiClient } from '../../shared/ai/anthropic-ai-client';
import { isTextBlock } from '../../shared/ai/ai-client.interface';
import type { AiClient } from '../../shared/ai/ai-client.interface';

// A single slow or broken module must degrade into a "data unavailable this
// week" note for that section, never hang or fail the whole report. Read at
// call time (not module load) so tests can tighten it per-case.
function moduleCallTimeoutMs(): number {
  return Number(process.env.REPORT_MODULE_TIMEOUT_MS ?? 10_000);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`module data pull timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// Monday (UTC) of the week containing `d`, as a YYYY-MM-DD date string. One
// report per tenant per calendar week keys off this; using Monday keeps a
// report labelled by the business week it summarises.
function weekOf(d = new Date()): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

interface ActivityEntry {
  event_type: string;
  value: unknown;
  created_at: string;
}

// One module's slice of the raw data the report is grounded in. `available:
// false` means its data pull timed out or threw -- the model is told to mark
// that section unavailable rather than guess.
interface ModuleReportData {
  moduleKey: string;
  available: boolean;
  capabilities?: string[];
  metric?: string;
  value?: string;
  activity?: ActivityEntry[];
  note?: string;
}

// The five narrative sections the model must return, grounded strictly in the
// data above. Plain text; the list-like sections may use newline-separated
// bullet lines.
interface ReportSections {
  performance_summary: string;
  wins: string;
  issues: string;
  opportunities: string;
  recommendations: string;
}

const EMPTY_SECTIONS: ReportSections = {
  performance_summary: '',
  wins: '',
  issues: '',
  opportunities: '',
  recommendations: '',
};

export interface ReportListItem {
  id: string;
  week_of: string;
  generated_at: string | null;
  status: string;
}

export interface WeeklyReportRow {
  id: string;
  week_of: string;
  generated_at: string | null;
  status: string;
  report_data: {
    weekOf?: string;
    sections?: ReportSections;
    modules?: ModuleReportData[];
    model?: string;
    error?: string;
  };
}

export interface GenerateReportResult {
  reportId: string;
  status: 'generated' | 'failed';
}

// The Executive Oversight weekly report engine. For one tenant it gathers the
// past week of real activity from every enabled module (each module's own
// snapshot metric plus its activity_log entries), then asks the model -- in
// the fixed role of an operations analyst / COO -- to turn ONLY that data
// into a five-part written report. It never invents numbers: raw tenant data
// reaches the model exclusively as the data payload it is told to ground in.
// Entirely internal: no public endpoint, read paths are tenant-JWT-scoped.
@Injectable()
export class ExecutiveOversightService implements OnModuleDestroy {
  private readonly pool = getSharedPool();

  private readonly ai: AiClient;

  // Model is read here (REPORT_MODEL) and handed to the shared AiClient --
  // never hardcoded at the call site. Same @Optional() pattern as the
  // orchestrator: the param is an interface, only ever passed explicitly
  // (StubAiClient in tests); without the decorator Nest tries to resolve a
  // provider for it and crashes at boot.
  constructor(
    private readonly registry: ModuleRegistryService,
    @Optional() aiClient?: AiClient,
  ) {
    this.ai =
      aiClient ??
      new AnthropicAiClient(process.env.REPORT_MODEL ?? 'claude-sonnet-5');
  }

  // Generate and store this week's report for one tenant. A per-module data
  // failure degrades that section only; a failure in the AI call or the
  // final write stores a 'failed' row and sends no notification.
  async generateReport(tenantId: string): Promise<GenerateReportResult> {
    const week = weekOf();
    const tenantName = await this.getTenantName(tenantId);
    const modules = await this.gatherModuleData(tenantId);

    try {
      const sections = await this.writeReport(
        tenantId,
        tenantName,
        week,
        modules,
      );
      const model = process.env.REPORT_MODEL ?? 'claude-sonnet-5';
      const reportData = {
        weekOf: week,
        generatedAt: new Date().toISOString(),
        model,
        sections,
        modules,
      };

      const reportId = await this.storeReport(
        tenantId,
        week,
        'generated',
        reportData,
      );
      await this.notifyReportReady(tenantId, week);
      return { reportId, status: 'generated' };
    } catch (err) {
      // The whole generation failed (AI call or synthesis). Record a 'failed'
      // row with the raw data we did gather so the failure is visible and
      // debuggable, and send no "report ready" notification.
      console.error(
        `[executive-oversight] report generation failed for tenant ${tenantId}:`,
        err instanceof Error ? err.message : err,
      );
      const reportId = await this.storeReport(tenantId, week, 'failed', {
        weekOf: week,
        generatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Unknown error',
        sections: EMPTY_SECTIONS,
        modules,
      });
      return { reportId, status: 'failed' };
    }
  }

  // Pull every enabled module's week of data. Each module is isolated behind
  // its own timeout + try/catch so one failure becomes an unavailable section
  // note, not a failed report.
  private async gatherModuleData(
    tenantId: string,
  ): Promise<ModuleReportData[]> {
    const capabilities = await this.registry.getCapabilitiesForTenant(tenantId);

    const byModule = new Map<string, string[]>();
    for (const { moduleKey, capability } of capabilities) {
      const list = byModule.get(moduleKey) ?? [];
      list.push(capability);
      byModule.set(moduleKey, list);
    }

    return Promise.all(
      [...byModule.entries()].map(([moduleKey, moduleCapabilities]) =>
        this.gatherOneModule(tenantId, moduleKey, moduleCapabilities),
      ),
    );
  }

  private async gatherOneModule(
    tenantId: string,
    moduleKey: string,
    capabilities: string[],
  ): Promise<ModuleReportData> {
    try {
      const instance = this.registry.getModuleInstance(moduleKey);
      if (!instance) {
        throw new Error(`Module ${moduleKey} is not registered`);
      }

      const [snapshot, activity] = await withTimeout(
        Promise.all([
          instance.getSnapshot(tenantId),
          this.getRecentActivity(tenantId, moduleKey),
        ]),
        moduleCallTimeoutMs(),
      );

      return {
        moduleKey,
        available: true,
        capabilities,
        metric: snapshot.metric,
        value: snapshot.value,
        activity,
      };
    } catch (err) {
      console.error(
        `[executive-oversight] data pull for module "${moduleKey}" failed for tenant ${tenantId}:`,
        err instanceof Error ? err.message : err,
      );
      return {
        moduleKey,
        available: false,
        capabilities,
        note: 'data unavailable this week',
      };
    }
  }

  private async getRecentActivity(
    tenantId: string,
    moduleKey: string,
  ): Promise<ActivityEntry[]> {
    const result = await this.pool.query<ActivityEntry>(
      `select event_type, value, created_at
         from activity_log
         where tenant_id = $1
           and module_key = $2
           and created_at >= now() - interval '7 days'
         order by created_at desc
         limit 200`,
      [tenantId, moduleKey],
    );
    return result.rows;
  }

  // Fixed role and output contract. The role is locked to an operations
  // analyst / COO reviewing the business; the model is told, repeatedly and
  // explicitly, to use ONLY the supplied data and never invent numbers or
  // claims. Business context and capability names are fine to state; raw
  // metrics live only in the user-message data payload.
  private buildSystemPrompt(): string {
    return [
      `You are a seasoned operations analyst and fractional COO reviewing one local business's performance for the past week.`,
      `You are writing the owner's weekly business report. Produce exactly five sections, in this order: performance summary, wins, issues, opportunities, and recommendations.`,
      `Ground every statement STRICTLY in the data provided in the user's message. Never invent, estimate, extrapolate, or round numbers, names, or events that are not explicitly present in that data. If the data does not support a claim, do not make it.`,
      `If a data source is marked unavailable this week, say plainly in the relevant section that this area could not be reviewed this week. Do not guess at what its numbers might have been.`,
      `Write for a busy business owner: concrete, direct, and about their money and customers (calls, reviews, revenue, follow-through). Never mention tools, systems, modules, agents, models, or AI.`,
      `Respond with ONLY a JSON object, no markdown fences, with exactly these five string keys: "performance_summary", "wins", "issues", "opportunities", "recommendations". Each value is plain text; wins, issues, opportunities, and recommendations may use newline-separated bullet lines. Do not add any other keys or prose outside the JSON.`,
    ].join('\n\n');
  }

  private async writeReport(
    tenantId: string,
    tenantName: string,
    week: string,
    modules: ModuleReportData[],
  ): Promise<ReportSections> {
    const userPayload = {
      business: tenantName,
      weekOf: week,
      instructions:
        'This is the only data available about this business this week. Base the entire report on it.',
      dataSources: modules,
    };

    const response = await this.ai.createMessage({
      system: this.buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: `Here is the business's data for the week beginning ${week}:\n\n${JSON.stringify(
            userPayload,
            null,
            2,
          )}`,
        },
      ],
      tools: [],
      usage: { tenantId, moduleKey: 'executive-oversight' },
    });

    const text = response.content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join('\n')
      .trim();

    return this.parseSections(text);
  }

  // Defensive parse: the model is asked for bare JSON, but strip code fences
  // and clip to the outermost braces in case it adds any wrapper. On a parse
  // failure keep the raw text as the summary rather than losing the report.
  private parseSections(text: string): ReportSections {
    const cleaned = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const candidate =
      start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    try {
      const parsed = JSON.parse(candidate) as Partial<ReportSections>;
      return {
        performance_summary: parsed.performance_summary ?? '',
        wins: parsed.wins ?? '',
        issues: parsed.issues ?? '',
        opportunities: parsed.opportunities ?? '',
        recommendations: parsed.recommendations ?? '',
      };
    } catch {
      return { ...EMPTY_SECTIONS, performance_summary: text };
    }
  }

  private async storeReport(
    tenantId: string,
    week: string,
    status: 'generated' | 'failed',
    reportData: Record<string, unknown>,
  ): Promise<string> {
    // Re-running a week overwrites that week's row (unique on tenant + week),
    // so a retry after a failure replaces the failed row cleanly.
    const result = await this.pool.query<{ id: string }>(
      `insert into executive_oversight.weekly_reports
         (tenant_id, week_of, generated_at, report_data, status)
       values ($1, $2, now(), $3, $4)
       on conflict (tenant_id, week_of) do update
         set generated_at = excluded.generated_at,
             report_data = excluded.report_data,
             status = excluded.status
       returning id`,
      [tenantId, week, JSON.stringify(reportData), status],
    );
    return result.rows[0].id;
  }

  // Step 5: a plain, benefit-first notification. Deliberately says nothing
  // about how the report is produced -- no AI, agents, systems, or modules.
  // One notification per tenant per report week, aligned with the reports
  // table's one-row-per-(tenant, week) key: regenerating a week's report
  // (dev runs, manual generate-report.ts) must not stack duplicate
  // "report ready" notifications. The guard scopes by created_at >= the
  // week's Monday, which is exact because a week's report is only ever
  // generated during that week.
  private async notifyReportReady(
    tenantId: string,
    week: string,
  ): Promise<void> {
    try {
      await this.pool.query(
        `insert into notifications (tenant_id, title, body)
         select $1, $2, $3
         where not exists (
           select 1 from notifications
           where tenant_id = $1 and title = $2 and created_at >= $4::date
         )`,
        [
          tenantId,
          'Your weekly business report is ready.',
          'A fresh summary of your business this past week is ready to view.',
          week,
        ],
      );
    } catch (err) {
      // The report is already stored; a notification failure must not undo a
      // good generation. Surface it loudly instead.
      console.error(
        '[executive-oversight] failed to write report-ready notification:',
        err,
      );
    }
  }

  private async getTenantName(tenantId: string): Promise<string> {
    const result = await this.pool.query<{ name: string }>(
      'select name from tenants where id = $1',
      [tenantId],
    );
    const name = result.rows[0]?.name;
    if (!name) {
      throw new Error('Unknown tenant');
    }
    return name;
  }

  // --- Read paths for the dashboard (tenant-JWT-scoped in the controller) ---

  async listReports(tenantId: string): Promise<ReportListItem[]> {
    // week_of::text -- node-postgres deserializes `date` columns into JS
    // Date objects by default, which JSON.stringify turns into full
    // timestamps ("2026-06-29T00:00:00.000Z"). The dashboard expects the
    // plain "YYYY-MM-DD" string these types promise, so cast explicitly
    // rather than relying on driver defaults.
    const result = await this.pool.query<ReportListItem>(
      `select id, week_of::text as week_of, generated_at, status
         from executive_oversight.weekly_reports
         where tenant_id = $1
         order by week_of desc`,
      [tenantId],
    );
    return result.rows;
  }

  async getReport(
    tenantId: string,
    reportId: string,
  ): Promise<WeeklyReportRow | null> {
    const result = await this.pool.query<WeeklyReportRow>(
      `select id, week_of::text as week_of, generated_at, status, report_data
         from executive_oversight.weekly_reports
         where tenant_id = $1 and id = $2`,
      [tenantId, reportId],
    );
    return result.rows[0] ?? null;
  }

  // Active tenants the weekly scheduler should generate reports for.
  async getActiveTenantIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `select id from tenants where status = 'active'`,
    );
    return result.rows.map((r) => r.id);
  }

  async onModuleDestroy(): Promise<void> {
    await closeSharedPool();
  }
}
