"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listReports, type ReportListItem } from "@/lib/executive-oversight-client";

function formatWeek(weekOf: string): string {
  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(
    undefined,
    { ...opts, year: "numeric" },
  )}`;
}

export default function BusinessReportsPage() {
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await listReports();
        if (active) setReports(data);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load reports.");
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 p-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        Business Reports
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Your weekly summary of how the business is doing.
      </p>

      {error && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">{error}</p>
      )}

      {reports === null && !error && (
        <p className="mt-4 text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {reports?.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          No reports yet. Your first weekly report will appear here once it is
          ready.
        </div>
      )}

      {reports && reports.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {reports.map((r) => {
            const failed = r.status === "failed";
            return (
              <li key={r.id}>
                <Link
                  href={`/business-reports/${r.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5 hover:border-[var(--color-accent-primary)]"
                >
                  <div>
                    <p className="font-medium text-[var(--color-ink)]">
                      Week of {formatWeek(r.week_of)}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {r.generated_at
                        ? `Ready ${new Date(r.generated_at).toLocaleDateString()}`
                        : "Not yet generated"}
                    </p>
                  </div>
                  {failed ? (
                    <span className="whitespace-nowrap rounded-full border border-[var(--color-status-attention)]/40 px-3 py-1 text-xs text-[var(--color-status-attention)]">
                      Unavailable
                    </span>
                  ) : (
                    <span className="whitespace-nowrap text-sm text-[var(--color-accent-primary)]">
                      View &rarr;
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
