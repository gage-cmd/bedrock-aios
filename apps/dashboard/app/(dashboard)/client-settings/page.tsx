"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentTenant } from "@/lib/use-current-tenant";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ClientSettingsPage() {
  const { tenant, loading } = useCurrentTenant();
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant || !nameRef.current) return;

    setSaving(true);
    setSaved(false);
    setError(null);
    const { error } = await supabase
      .from("tenants")
      .update({ name: nameRef.current.value })
      .eq("id", tenant.tenantId);
    setSaving(false);
    if (error) {
      setError("We couldn't save your changes. Please try again.");
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-6 flex max-w-sm flex-col gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    );
  }

  const isOwner = tenant?.role === "owner";

  return (
    <div className="flex-1 p-8">
      <PageHeader title="Client Settings" />

      <form onSubmit={handleSave} className="mt-6 flex max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
          Business name
          {/* key forces a remount (and fresh defaultValue) once the tenant
              finishes loading -- avoids syncing external state into local
              state via an effect. */}
          <input
            key={tenant?.tenantId}
            ref={nameRef}
            defaultValue={tenant?.tenantName ?? ""}
            disabled={!isOwner}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] disabled:opacity-50"
          />
        </label>

        <p className="text-sm text-[var(--color-text-secondary)]">
          Status: {tenant?.tenantStatus}
        </p>

        {!isOwner && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Only account owners can edit these settings.
          </p>
        )}

        {isOwner && (
          <button
            type="submit"
            disabled={saving}
            className="mt-2 self-start rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}

        {error && (
          <p className="text-sm text-[var(--color-status-attention)]">{error}</p>
        )}

        {saved && (
          <p className="text-sm text-[var(--color-status-good)]">Saved.</p>
        )}
      </form>
    </div>
  );
}
