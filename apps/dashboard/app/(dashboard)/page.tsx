"use client";

import { useCurrentTenant } from "@/lib/use-current-tenant";
import { useModuleWidgets } from "@/lib/module-loader";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

function WidgetSkeleton() {
  return (
    <Card>
      <Skeleton className="h-4 w-36" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-28" />
      </div>
    </Card>
  );
}

export default function BusinessSnapshotPage() {
  const { tenant, loading, error: tenantError } = useCurrentTenant();
  const { widgets, error, pending } = useModuleWidgets();

  return (
    <div className="flex-1 p-8">
      {loading ? (
        <Skeleton className="h-9 w-96 max-w-full" />
      ) : (
        <PageHeader
          title={
            tenantError
              ? "Welcome"
              : `Welcome, ${tenant?.tenantName || "your business"}`
          }
        />
      )}

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
      ) : pending ? (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <WidgetSkeleton />
          <WidgetSkeleton />
        </div>
      ) : widgets.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Your business snapshot is on its way."
            body="As your systems come online, this page will show what they recovered for you each week -- calls answered, reviews earned, customers followed up with."
          />
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {widgets}
        </div>
      )}
    </div>
  );
}
