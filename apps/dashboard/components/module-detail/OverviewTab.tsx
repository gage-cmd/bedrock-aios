"use client";

import { isSignedOutError } from "@/lib/api";
import { useModuleSnapshot } from "@/lib/queries";
import { Card } from "@/components/ui/Card";
import { StatBlock } from "@/components/ui/StatBlock";
import { Skeleton } from "@/components/ui/Skeleton";

// Generic across every module: hits that module's own /snapshot route by
// moduleKey, same data the Business Snapshot widgets show. Works for any
// module without per-module code, since the snapshot shape is part of the
// module contract.
export function OverviewTab({ moduleKey }: { moduleKey: string }) {
  const { data: snapshot, isError, error } = useModuleSnapshot(moduleKey);
  const failed = isError && !isSignedOutError(error);

  return (
    <Card className="max-w-sm">
      {failed && (
        <p className="text-sm text-[var(--color-status-attention)]">
          Could not load this snapshot. Please refresh to try again.
        </p>
      )}

      {!failed && !snapshot && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
      )}

      {snapshot && <StatBlock label={snapshot.headline.label} value={snapshot.headline.value} />}
    </Card>
  );
}
