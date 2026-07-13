"use client";

import { useEnabledModules, useModuleStatuses } from "@/lib/queries";

export function SystemStatusStrip() {
  const { data: modules, isError } = useEnabledModules();
  const statuses = useModuleStatuses();

  if (isError) {
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] px-8 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
          System Status
        </span>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-status-attention)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            Status unavailable &mdash; please refresh
          </span>
        </div>
      </div>
    );
  }

  if (!modules || modules.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] px-8 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        System Status
      </span>
      {modules.map((m) => {
        const status = statuses.get(m.moduleKey) ?? null;
        const good = status?.status === "connected";
        const attention = status?.status === "needs attention";
        return (
          <div key={m.moduleKey} className="flex items-center gap-2">
            <span
              className={
                good
                  ? "status-dot-good h-2 w-2 rounded-full bg-[var(--color-status-good)]"
                  : attention
                    ? "h-2 w-2 rounded-full bg-[var(--color-status-attention)]"
                    : "h-2 w-2 rounded-full bg-[var(--color-ink-muted)]"
              }
            />
            <span className="text-sm text-[var(--color-ink)]">{m.name}</span>
            {attention && status && "reason" in status && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                &mdash; {status.reason}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
