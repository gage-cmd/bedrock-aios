"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type ModuleStatus =
  | { status: "connected" }
  | { status: "needs attention"; reason: string };

interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

// Display labels for the modules this dashboard ships a status indicator
// for. A module must already appear in lib/module-loader.tsx's
// WIDGET_REGISTRY to have a dashboard presence at all -- this strip surfaces
// the same set, not a separate list.
const MODULE_LABELS: Record<string, string> = {
  "review-generation": "Review Generation",
  "missed-call-textback": "Missed-Call Text-Back",
};

interface ModuleStatusEntry {
  moduleKey: string;
  label: string;
  status: ModuleStatus | null;
}

export function SystemStatusStrip() {
  const [entries, setEntries] = useState<ModuleStatusEntry[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const authHeader = { Authorization: `Bearer ${session.access_token}` };
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

      const manifestRes = await fetch(`${backendUrl}/module-manifest`, {
        headers: authHeader,
      });

      if (!active || !manifestRes.ok) return;

      const modules = (await manifestRes.json()) as EnabledModule[];
      const known = modules.filter((m) => m.moduleKey in MODULE_LABELS);

      if (known.length === 0) {
        setEntries([]);
        return;
      }

      const results = await Promise.all(
        known.map(async (m) => {
          const res = await fetch(
            `${backendUrl}/modules/${m.moduleKey}/status`,
            { headers: authHeader },
          );
          const status: ModuleStatus | null = res.ok ? await res.json() : null;
          return { moduleKey: m.moduleKey, label: MODULE_LABELS[m.moduleKey], status };
        }),
      );

      if (active) setEntries(results);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] px-8 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        System Status
      </span>
      {entries.map((e) => {
        const good = e.status?.status === "connected";
        const attention = e.status?.status === "needs attention";
        return (
          <div key={e.moduleKey} className="flex items-center gap-2">
            <span
              className={
                good
                  ? "status-dot-good h-2 w-2 rounded-full bg-[var(--color-status-good)]"
                  : attention
                    ? "h-2 w-2 rounded-full bg-[var(--color-status-attention)]"
                    : "h-2 w-2 rounded-full bg-[var(--color-ink-muted)]"
              }
            />
            <span className="text-sm text-[var(--color-ink)]">{e.label}</span>
            {attention && e.status && "reason" in e.status && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                &mdash; {e.status.reason}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
