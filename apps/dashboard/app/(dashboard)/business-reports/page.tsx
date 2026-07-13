"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listReports, type ReportListItem } from "@/lib/executive-oversight-client";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

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
  const { data, error: queryError } = useQuery<ReportListItem[]>({
    queryKey: ["reports"],
    queryFn: listReports,
  });
  const reports = data ?? null;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Could not load reports."
    : null;

  return (
    <div className="flex-1 p-8">
      <PageHeader
        title="Business Reports"
        subtitle="Your weekly summary of how the business is doing."
      />

      {error && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">{error}</p>
      )}

      {reports === null && !error && (
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      )}

      {reports?.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="Your first weekly report is on its way."
            body="Every week you'll get a plain-language review of your results -- what went well, what needs attention, and what to do next."
          />
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
