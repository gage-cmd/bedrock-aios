"use client";

import { useEffect, useState } from "react";
import { apiFetch, isSignedOutError } from "@/lib/api";

interface Snapshot {
  metric: string;
  value: string;
}

// Generic across every module: hits that module's own /snapshot route by
// moduleKey, same data the Business Snapshot widgets show. Works for any
// module without per-module code, since the snapshot shape is part of the
// module contract.
export function OverviewTab({ moduleKey }: { moduleKey: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const data = await apiFetch<Snapshot>(`/modules/${moduleKey}/snapshot`);
      if (active) setSnapshot(data);
    }

    load().catch((err) => {
      if (active && !isSignedOutError(err)) setError(true);
    });

    return () => {
      active = false;
    };
  }, [moduleKey]);

  return (
    <div className="max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5">
      {error && (
        <p className="text-sm text-[var(--color-status-attention)]">
          Could not load snapshot.
        </p>
      )}

      {!error && !snapshot && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {snapshot && (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">{snapshot.metric}</p>
          <p className="font-metric text-2xl font-medium text-[var(--color-accent-gold)]">
            {snapshot.value}
          </p>
        </>
      )}
    </div>
  );
}
