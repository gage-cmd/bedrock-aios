"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentTenant } from "@/lib/use-current-tenant";

export default function ClientSettingsPage() {
  const { tenant, loading } = useCurrentTenant();
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant || !nameRef.current) return;

    setSaving(true);
    setSaved(false);
    await supabase
      .from("tenants")
      .update({ name: nameRef.current.value })
      .eq("id", tenant.tenantId);
    setSaving(false);
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex-1 p-8 text-[var(--color-text-secondary)] dark:text-zinc-400">
        Loading...
      </div>
    );
  }

  const isOwner = tenant?.role === "owner";

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-[var(--color-ink)] dark:text-zinc-50">
        Client Settings
      </h1>

      <form onSubmit={handleSave} className="mt-6 flex max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)] dark:text-zinc-300">
          Business name
          {/* key forces a remount (and fresh defaultValue) once the tenant
              finishes loading -- avoids syncing external state into local
              state via an effect. */}
          <input
            key={tenant?.tenantId}
            ref={nameRef}
            defaultValue={tenant?.tenantName ?? ""}
            disabled={!isOwner}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] disabled:opacity-50 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
        </label>

        <p className="text-sm text-[var(--color-text-secondary)] dark:text-zinc-400">
          Status: {tenant?.tenantStatus}
        </p>

        {!isOwner && (
          <p className="text-sm text-[var(--color-text-secondary)] dark:text-zinc-400">
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

        {saved && (
          <p className="text-sm text-[var(--color-status-good)] dark:text-green-400">Saved.</p>
        )}
      </form>
    </div>
  );
}
