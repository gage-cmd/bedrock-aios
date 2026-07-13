"use client";

import Link from "next/link";
import { useEnabledModules, useModuleStatuses } from "@/lib/queries";

export default function InstalledSystemsPage() {
  const { data: modules, isError, isPending } = useEnabledModules();
  const statuses = useModuleStatuses((modules ?? []).map((m) => m.moduleKey));

  return (
    <div className="flex-1 p-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        Installed Systems
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Everything currently running for your business.
      </p>

      {isError && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">
          Could not load installed systems.
        </p>
      )}

      {!isError && isPending && (
        <p className="mt-4 text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {modules?.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          No systems installed yet.
        </div>
      )}

      {modules && modules.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => {
            const status = statuses[i]?.data ?? null;
            const good = status?.status === "connected";
            const attention = status?.status === "needs attention";
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
                {attention && status && "reason" in status && (
                  <p className="mt-3 text-xs text-[var(--color-status-attention)]">
                    {status.reason}
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
