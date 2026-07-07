"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

export default function InstalledSystemsPage() {
  const [modules, setModules] = useState<EnabledModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/module-manifest`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );

      if (!active) return;

      if (!res.ok) {
        setError("Could not load installed systems.");
        return;
      }

      setModules((await res.json()) as EnabledModule[]);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Installed Systems
      </h1>

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {!error && modules === null && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {modules?.length === 0 && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No systems installed yet.
        </p>
      )}

      {modules && modules.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {modules.map((m) => (
            <li
              key={m.moduleKey}
              className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]"
            >
              <span className="font-medium text-black dark:text-zinc-50">
                {m.moduleKey}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
