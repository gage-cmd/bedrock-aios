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
    <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="font-medium text-black dark:text-zinc-50">Review Generation</p>

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          Could not load snapshot.
        </p>
      )}

      {!error && !snapshot && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {snapshot && (
        <>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {snapshot.metric}
          </p>
          <p className="text-lg font-semibold text-black dark:text-zinc-50">
            {snapshot.value}
          </p>
        </>
      )}
    </div>
  );
}
