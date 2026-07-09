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

export function ActivityTab() {
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
    <div>
      {error && <p className="text-sm text-[var(--color-status-attention)]">{error}</p>}

      {rows === null && !error && (
        <p className="text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {rows?.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          No review requests sent yet.
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-4"
            >
              <div>
                <p className="font-medium text-[var(--color-ink)]">{r.contact_name}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Sent {new Date(r.sent_at).toLocaleString()} via {r.channel} -- {r.status}
                </p>
              </div>
              {r.rating != null && (
                <span className="font-metric whitespace-nowrap text-sm text-[var(--color-accent-gold)]">
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
