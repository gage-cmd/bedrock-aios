"use client";

import { useEffect, useState } from "react";
import { apiFetch, isSignedOutError } from "@/lib/api";

interface Snapshot {
  metric: string;
  value: string;
}

export function MissedCallTextbackWidget() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const data = await apiFetch<Snapshot>(
        "/modules/missed-call-textback/snapshot",
      );
      if (active) setSnapshot(data);
    }

    load().catch((err) => {
      if (active && !isSignedOutError(err)) setError(true);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5">
      <p className="text-sm font-medium text-[var(--color-ink)]">Missed-Call Text-Back</p>

      {error && (
        <p className="mt-2 text-sm text-[var(--color-status-attention)]">
          Could not load snapshot.
        </p>
      )}

      {!error && !snapshot && (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {snapshot && (
        <>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {snapshot.metric}
          </p>
          <p className="font-metric text-2xl font-medium text-[var(--color-accent-gold)]">
            {snapshot.value}
          </p>
        </>
      )}
    </div>
  );
}
