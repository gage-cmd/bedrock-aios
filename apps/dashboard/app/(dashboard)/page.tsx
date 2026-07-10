"use client";

import { useCurrentTenant } from "@/lib/use-current-tenant";
import { useModuleWidgets } from "@/lib/module-loader";

export default function BusinessSnapshotPage() {
  const { tenant, loading, error: tenantError } = useCurrentTenant();
  const { widgets, error } = useModuleWidgets();

  return (
    <div className="flex-1 p-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        {loading
          ? "Loading..."
          : tenantError
            ? "Welcome"
            : `Welcome, ${tenant?.tenantName || "your business"}`}
      </h1>

      {tenantError && (
        <p className="mt-1 text-sm text-[var(--color-status-attention)]">
          We couldn&apos;t load your account details. Please refresh to try
          again.
        </p>
      )}

      {error ? (
        <div className="mt-8 rounded-lg border border-[var(--color-status-attention)]/40 p-12 text-center text-[var(--color-status-attention)]">
          We couldn&apos;t load your systems right now. Please refresh to try
          again.
        </div>
      ) : widgets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          Module snapshot cards will appear here as systems are installed.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {widgets}
        </div>
      )}
    </div>
  );
}
