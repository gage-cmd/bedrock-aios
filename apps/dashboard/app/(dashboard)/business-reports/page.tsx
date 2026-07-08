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
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Business Reports
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Your weekly summary of how the business is doing.
      </p>

      {error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {reports === null && !error && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {reports?.length === 0 && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No reports yet. Your first weekly report will appear here once it is
          ready.
        </p>
      )}

      {reports && reports.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2">
          {reports.map((r) => {
            const failed = r.status === "failed";
            return (
              <li key={r.id}>
                <Link
                  href={`/business-reports/${r.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] p-4 hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.08]"
                >
                  <div>
                    <p className="font-medium text-black dark:text-zinc-50">
                      Week of {formatWeek(r.week_of)}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {r.generated_at
                        ? `Ready ${new Date(r.generated_at).toLocaleDateString()}`
                        : "Not yet generated"}
                    </p>
                  </div>
                  {failed ? (
                    <span className="whitespace-nowrap rounded-full border border-amber-500/40 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
                      Unavailable
                    </span>
                  ) : (
                    <span className="whitespace-nowrap text-sm text-zinc-400 dark:text-zinc-500">
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
