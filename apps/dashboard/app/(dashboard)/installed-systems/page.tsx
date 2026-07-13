"use client";

import Link from "next/link";
import { useEnabledModules, useModuleStatuses } from "@/lib/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusDot, type StatusTone } from "@/components/ui/StatusDot";

function CardSkeleton() {
  return (
    <Card>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-1 h-4 w-3/4" />
    </Card>
  );
}

export default function InstalledSystemsPage() {
  const { data: modules, isError, isPending } = useEnabledModules();
  const statuses = useModuleStatuses();

  return (
    <div className="flex-1 p-8">
      <PageHeader
        title="Installed Systems"
        subtitle="Everything currently running for your business."
      />

      {isError && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">
          Could not load installed systems. Please refresh to try again.
        </p>
      )}

      {!isError && isPending && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {modules?.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title="Nothing is set up yet."
            body="Once your first system goes live it will appear here, with its status and results."
          />
        </div>
      )}

      {modules && modules.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const status = statuses.get(m.moduleKey) ?? null;
            const tone: StatusTone =
              status?.status === "connected"
                ? "good"
                : status?.status === "needs attention"
                  ? "attention"
                  : "unknown";
            return (
              <Link
                key={m.moduleKey}
                href={`/installed-systems/${m.moduleKey}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5 hover:border-[var(--color-accent-primary)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-ink)]">{m.name}</p>
                  <StatusDot tone={tone} className="mt-1 shrink-0" />
                </div>
                {m.description && (
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {m.description}
                  </p>
                )}
                {tone === "attention" && status && "reason" in status && (
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
