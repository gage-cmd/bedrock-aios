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

export default function MissedCallActivityPage() {
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
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Recent Activity</h1>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {rows?.length === 0 && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">No missed calls yet.</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]"
            >
              <div>
                <p className="font-medium text-black dark:text-zinc-50">{r.contact_phone}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Missed {new Date(r.missed_at).toLocaleString()}
                </p>
              </div>
              <span
                className={`whitespace-nowrap text-sm ${
                  r.textback_sent
                    ? "text-green-600 dark:text-green-400"
                    : "text-amber-600 dark:text-amber-400"
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
