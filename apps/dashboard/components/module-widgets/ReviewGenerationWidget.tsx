"use client";

import { isSignedOutError } from "@/lib/api";
import { useModuleSnapshot } from "@/lib/queries";
import { Card } from "@/components/ui/Card";
import { StatBlock } from "@/components/ui/StatBlock";
import { Skeleton } from "@/components/ui/Skeleton";

export function ReviewGenerationWidget() {
  const { data: snapshot, isError, error } = useModuleSnapshot("review-generation");
  const failed = isError && !isSignedOutError(error);

  return (
    <Card>
      <p className="text-sm font-medium text-[var(--color-ink)]">Review Generation</p>

      {failed && (
        <p className="mt-2 text-sm text-[var(--color-status-attention)]">
          Could not load this snapshot. Please refresh to try again.
        </p>
      )}

      {!failed && !snapshot && (
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
      )}

      {snapshot && (
        <div className="mt-3">
          <StatBlock label={snapshot.headline.label} value={snapshot.headline.value} />
        </div>
      )}
    </Card>
  );
}
