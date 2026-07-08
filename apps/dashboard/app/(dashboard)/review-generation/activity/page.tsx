"use client";

import { useEffect, useState } from "react";
import { callReviewGenerationAction } from "@/lib/review-generation-client";

interface ActivityRow {
  id: string;
  contact_name: string;
  channel: string;
  sent_at: string;
  status: string;
  rating: number | null;
}

export default function ReviewActivityPage() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await callReviewGenerationAction<ActivityRow[]>("get-recent-requests");
        if (active) setRows(data);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load activity.");
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
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Recent Activity</h1>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {rows?.length === 0 && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No review requests sent yet.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]"
            >
              <div>
                <p className="font-medium text-black dark:text-zinc-50">{r.contact_name}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Sent {new Date(r.sent_at).toLocaleString()} via {r.channel} -- {r.status}
                </p>
              </div>
              {r.rating != null && (
                <span className="whitespace-nowrap text-sm text-black dark:text-zinc-50">
                  {r.rating}★
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
