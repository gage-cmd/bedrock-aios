"use client";

import { useEffect, useState } from "react";
import {
  getModuleStatus,
  listEnabledModules,
  type ModuleStatus,
} from "@/lib/module-registry-client";

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
      const modules = await listEnabledModules();
      if (!active || modules.length === 0) {
        if (active) setEntries([]);
        return;
      }

      const results = await Promise.all(
        modules.map(async (m) => ({
          moduleKey: m.moduleKey,
          label: m.name,
          status: await getModuleStatus(m.moduleKey),
        })),
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
