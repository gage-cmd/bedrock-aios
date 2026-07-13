"use client";

import { isSignedOutError } from "@/lib/api";
import { useModuleSnapshot } from "@/lib/queries";

export function ReviewGenerationWidget() {
  const { data: snapshot, isError, error } = useModuleSnapshot("review-generation");
  const failed = isError && !isSignedOutError(error);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5">
      <p className="text-sm font-medium text-[var(--color-ink)]">Review Generation</p>

      {failed && (
        <p className="mt-2 text-sm text-[var(--color-status-attention)]">
          Could not load snapshot.
        </p>
      )}

      {!failed && !snapshot && (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {snapshot && (
        <>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {snapshot.metric}
          </p>
          <p className="font-metric text-2xl font-medium text-[var(--color-accent-gold)]">
            {snapshot.value}
          </p>
        </>
      )}
    </div>
  );
}
