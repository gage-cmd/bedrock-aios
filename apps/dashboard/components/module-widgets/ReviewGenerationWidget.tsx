"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface Snapshot {
  metric: string;
  value: string;
}

export function ReviewGenerationWidget() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/modules/review-generation/snapshot`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );

      if (!active) return;

      if (!res.ok) {
        setError(true);
        return;
      }

      setSnapshot((await res.json()) as Snapshot);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5">
      <p className="text-sm font-medium text-[var(--color-ink)]">Review Generation</p>

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
