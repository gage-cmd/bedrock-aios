"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentTenant } from "@/lib/use-current-tenant";

interface MissedCallTextbackConfig {
  businessName?: string;
  destinationNumber?: string;
  ringTimeoutSeconds?: number;
  textBackTemplate?: string;
}

const DEFAULT_TEXTBACK_TEMPLATE =
  "Hi! You just called {business_name} and we couldn't pick up. Reply here and we'll get right back to you.";
const DEFAULT_RING_TIMEOUT_SECONDS = 20;

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] disabled:opacity-50";

export function SettingsTab() {
  const { tenant, loading } = useCurrentTenant();
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [config, setConfig] = useState<MissedCallTextbackConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessNameRef = useRef<HTMLInputElement>(null);
  const destinationNumberRef = useRef<HTMLInputElement>(null);
  const ringTimeoutRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!tenant) return;
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("module_manifest")
        .select("id, config")
        .eq("tenant_id", tenant!.tenantId)
        .eq("module_key", "missed-call-textback")
        .maybeSingle();

      if (!active) return;
      setManifestId((data?.id as string | undefined) ?? null);
      setConfig((data?.config as MissedCallTextbackConfig | undefined) ?? {});
    }

    void load();
    return () => {
      active = false;
    };
  }, [tenant]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    const ringTimeoutRaw = ringTimeoutRef.current?.value;
    const ringTimeoutParsed = ringTimeoutRaw ? Number(ringTimeoutRaw) : NaN;

    const newConfig: MissedCallTextbackConfig = {
      businessName: businessNameRef.current?.value || undefined,
      destinationNumber: destinationNumberRef.current?.value || undefined,
      ringTimeoutSeconds: Number.isFinite(ringTimeoutParsed)
        ? ringTimeoutParsed
        : DEFAULT_RING_TIMEOUT_SECONDS,
      textBackTemplate: templateRef.current?.value || DEFAULT_TEXTBACK_TEMPLATE,
    };

    const result = manifestId
      ? await supabase
          .from("module_manifest")
          .update({ config: newConfig })
          .eq("id", manifestId)
      : await supabase.from("module_manifest").insert({
          tenant_id: tenant.tenantId,
          module_key: "missed-call-textback",
          enabled: true,
          config: newConfig,
        });

    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setConfig(newConfig);
    setSaved(true);
  }

  if (loading || (tenant && config === null)) {
    return <p className="text-[var(--color-text-secondary)]">Loading...</p>;
  }

  const isOwner = tenant?.role === "owner";

  return (
    <form onSubmit={handleSave} className="flex max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        Business name
        <input
          key={`name-${tenant?.tenantId}`}
          ref={businessNameRef}
          defaultValue={config?.businessName ?? ""}
          disabled={!isOwner}
          className={inputClasses}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        Forwarding number
        <input
          key={`dest-${tenant?.tenantId}`}
          ref={destinationNumberRef}
          type="tel"
          defaultValue={config?.destinationNumber ?? ""}
          placeholder="+15551234567"
          disabled={!isOwner}
          className={inputClasses}
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          The line a call rings (e.g. the front desk) before it counts as missed.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        Ring timeout (seconds)
        <input
          key={`ring-${tenant?.tenantId}`}
          ref={ringTimeoutRef}
          type="number"
          min={5}
          max={60}
          defaultValue={config?.ringTimeoutSeconds ?? DEFAULT_RING_TIMEOUT_SECONDS}
          disabled={!isOwner}
          className={inputClasses}
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          How long the forwarding number rings before the text-back fires.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        Text-back message template
        <textarea
          key={`template-${tenant?.tenantId}`}
          ref={templateRef}
          defaultValue={config?.textBackTemplate ?? DEFAULT_TEXTBACK_TEMPLATE}
          rows={4}
          disabled={!isOwner}
          className={inputClasses}
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          Supports {"{business_name}"}. Sent automatically the moment a call goes
          unanswered.
        </span>
      </label>

      {!isOwner && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Only account owners can edit these settings.
        </p>
      )}

      {isOwner && (
        <button
          type="submit"
          disabled={saving}
          className="mt-2 self-start rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      )}

      {error && <p className="text-sm text-[var(--color-status-attention)]">{error}</p>}
      {saved && <p className="text-sm text-[var(--color-status-good)]">Saved.</p>}
    </form>
  );
}
