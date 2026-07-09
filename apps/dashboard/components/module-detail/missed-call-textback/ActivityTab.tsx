"use client";

import { useEffect, useState } from "react";
import { callMissedCallTextbackAction } from "@/lib/missed-call-textback-client";

interface MissedCallRow {
  id: string;
  contact_phone: string;
  missed_at: string;
  textback_sent: boolean;
  textback_body: string | null;
}

export function ActivityTab() {
  const [rows, setRows] = useState<MissedCallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data =
          await callMissedCallTextbackAction<MissedCallRow[]>("get-recent-missed-calls");
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
          No missed calls yet.
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
                <p className="font-medium text-[var(--color-ink)]">{r.contact_phone}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Missed {new Date(r.missed_at).toLocaleString()}
                </p>
              </div>
              <span
                className={`whitespace-nowrap text-sm ${
                  r.textback_sent
                    ? "text-[var(--color-status-good)]"
                    : "text-[var(--color-status-attention)]"
                }`}
              >
                {r.textback_sent ? "Text-back sent" : "No text-back"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
