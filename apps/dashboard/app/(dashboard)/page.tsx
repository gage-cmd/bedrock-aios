"use client";

import { useCurrentTenant } from "@/lib/use-current-tenant";
import { useModuleWidgets } from "@/lib/module-loader";

export default function BusinessSnapshotPage() {
  const { tenant, loading } = useCurrentTenant();
  const widgets = useModuleWidgets();

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        {loading
          ? "Loading..."
          : `Welcome, ${tenant?.tenantName || "your business"}`}
      </h1>

      {widgets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-black/[.15] p-12 text-center text-zinc-500 dark:border-white/[.15] dark:text-zinc-400">
          Module snapshot cards will appear here as systems are installed.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {widgets}
        </div>
      )}
    </div>
  );
}
