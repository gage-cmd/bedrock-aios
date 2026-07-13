"use client";

import { isSignedOutError } from "@/lib/api";
import { useModuleSnapshot } from "@/lib/queries";

// Generic across every module: hits that module's own /snapshot route by
// moduleKey, same data the Business Snapshot widgets show. Works for any
// module without per-module code, since the snapshot shape is part of the
// module contract.
export function OverviewTab({ moduleKey }: { moduleKey: string }) {
  const { data: snapshot, isError, error } = useModuleSnapshot(moduleKey);
  const failed = isError && !isSignedOutError(error);

  return (
    <div className="max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5">
      {failed && (
        <p className="text-sm text-[var(--color-status-attention)]">
          Could not load snapshot.
        </p>
      )}

      {!failed && !snapshot && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {snapshot && (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">{snapshot.metric}</p>
          <p className="font-metric text-2xl font-medium text-[var(--color-accent-gold)]">
            {snapshot.value}
          </p>
        </>
      )}
    </div>
  );
}
