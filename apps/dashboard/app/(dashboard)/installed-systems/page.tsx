"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getModuleStatus,
  listEnabledModules,
  type EnabledModule,
  type ModuleStatus,
} from "@/lib/module-registry-client";

interface ModuleCardData extends EnabledModule {
  status: ModuleStatus | null;
}

export default function InstalledSystemsPage() {
  const [modules, setModules] = useState<ModuleCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const enabled = await listEnabledModules();
      if (!active) return;

      if (enabled.length === 0) {
        setModules([]);
        return;
      }

      const withStatus = await Promise.all(
        enabled.map(async (m) => ({ ...m, status: await getModuleStatus(m.moduleKey) })),
      );
      if (active) setModules(withStatus);
    }

    load().catch(() => {
      if (active) setError("Could not load installed systems.");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 p-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        Installed Systems
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Everything currently running for your business.
      </p>

      {error && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">{error}</p>
      )}

      {!error && modules === null && (
        <p className="mt-4 text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {modules?.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          No systems installed yet.
        </div>
      )}

      {modules && modules.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const good = m.status?.status === "connected";
            const attention = m.status?.status === "needs attention";
            return (
              <Link
                key={m.moduleKey}
                href={`/installed-systems/${m.moduleKey}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5 hover:border-[var(--color-accent-primary)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-ink)]">{m.name}</p>
                  <span
                    className={
                      good
                        ? "status-dot-good mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-good)]"
                        : attention
                          ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-attention)]"
                          : "mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-ink-muted)]"
                    }
                  />
                </div>
                {m.description && (
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {m.description}
                  </p>
                )}
                {attention && m.status && "reason" in m.status && (
                  <p className="mt-3 text-xs text-[var(--color-status-attention)]">
                    {m.status.reason}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
