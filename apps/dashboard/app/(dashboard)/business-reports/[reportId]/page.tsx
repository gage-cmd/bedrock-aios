"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  getReport,
  type WeeklyReport,
  type ReportSections,
} from "@/lib/executive-oversight-client";

function formatWeek(weekOf: string): string {
  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(
    undefined,
    { ...opts, year: "numeric" },
  )}`;
}

// The four list-style sections may arrive as newline-separated bullet lines;
// the summary is a prose paragraph. Render each accordingly.
const SECTION_ORDER: { key: keyof ReportSections; label: string; list: boolean }[] =
  [
    { key: "performance_summary", label: "Performance summary", list: false },
    { key: "wins", label: "Wins", list: true },
    { key: "issues", label: "Issues", list: true },
    { key: "opportunities", label: "Opportunities", list: true },
    { key: "recommendations", label: "Recommendations", list: true },
  ];

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function Section({
  label,
  value,
  list,
}: {
  label: string;
  value: string;
  list: boolean;
}) {
  const trimmed = (value ?? "").trim();
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </h2>
      {trimmed.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Nothing to report this week.
        </p>
      ) : list ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[var(--color-ink)]">
          {lines(trimmed).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 whitespace-pre-line text-[var(--color-ink)]">
          {trimmed}
        </p>
      )}
    </section>
  );
}

export default function BusinessReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = use(params);
  const { data, error: queryError } = useQuery<WeeklyReport>({
    queryKey: ["report", reportId],
    queryFn: () => getReport(reportId),
  });
  const report = data ?? null;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Could not load report."
    : null;

  const sections = report?.report_data?.sections;

  return (
    <div className="flex-1 p-8">
      <Link
        href="/business-reports"
        className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)]"
      >
        &larr; All reports
      </Link>

      {error && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">{error}</p>
      )}

      {report === null && !error && (
        <p className="mt-4 text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {report && (
        <>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
            Week of {formatWeek(report.week_of)}
          </h1>

          {report.status === "failed" && (
            <p className="mt-4 rounded-lg border border-[var(--color-status-attention)]/40 p-4 text-sm text-[var(--color-status-attention)]">
              This week&apos;s report could not be prepared. The next one will be
              ready on schedule.
            </p>
          )}

          {report.status !== "failed" && sections && (
            <div className="max-w-2xl">
              {SECTION_ORDER.map((s) => (
                <Section
                  key={s.key}
                  label={s.label}
                  value={sections[s.key]}
                  list={s.list}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
