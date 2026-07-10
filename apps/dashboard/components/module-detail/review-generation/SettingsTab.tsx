"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentTenant } from "@/lib/use-current-tenant";

interface ReviewGenerationConfig {
  businessName?: string;
  googleReviewUrl?: string;
  smsTemplate?: string;
  negativeFeedbackEmail?: string;
}

const DEFAULT_SMS_TEMPLATE =
  "Hi {customer_name}! Thanks so much for choosing {business_name}. We'd really appreciate a quick review -- it means a lot to a small business like ours.";

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] disabled:opacity-50";

export function SettingsTab() {
  const { tenant, loading } = useCurrentTenant();
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [config, setConfig] = useState<ReviewGenerationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const businessNameRef = useRef<HTMLInputElement>(null);
  const googleUrlRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const negativeEmailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenant) return;
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from("module_manifest")
        .select("id, config")
        .eq("tenant_id", tenant!.tenantId)
        .eq("module_key", "review-generation")
        .maybeSingle();

      if (!active) return;
      if (error) {
        setLoadFailed(true);
        return;
      }
      setManifestId((data?.id as string | undefined) ?? null);
      setConfig((data?.config as ReviewGenerationConfig | undefined) ?? {});
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

    const newConfig: ReviewGenerationConfig = {
      businessName: businessNameRef.current?.value || undefined,
      googleReviewUrl: googleUrlRef.current?.value || undefined,
      smsTemplate: templateRef.current?.value || DEFAULT_SMS_TEMPLATE,
      negativeFeedbackEmail: negativeEmailRef.current?.value || undefined,
    };

    const result = manifestId
      ? await supabase
          .from("module_manifest")
          .update({ config: newConfig })
          .eq("id", manifestId)
      : await supabase.from("module_manifest").insert({
          tenant_id: tenant.tenantId,
          module_key: "review-generation",
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

  if (loadFailed) {
    return (
      <p className="text-sm text-[var(--color-status-attention)]">
        We couldn&apos;t load these settings. Please refresh to try again.
      </p>
    );
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
        Google review link
        <input
          key={`google-${tenant?.tenantId}`}
          ref={googleUrlRef}
          type="url"
          defaultValue={config?.googleReviewUrl ?? ""}
          placeholder="https://g.page/r/..."
          disabled={!isOwner}
          className={inputClasses}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        SMS message template
        <textarea
          key={`template-${tenant?.tenantId}`}
          ref={templateRef}
          defaultValue={config?.smsTemplate ?? DEFAULT_SMS_TEMPLATE}
          rows={4}
          disabled={!isOwner}
          className={inputClasses}
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          Supports {"{customer_name}"} and {"{business_name}"}. The review link is
          added automatically.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
        Negative feedback notification email
        <input
          key={`neg-email-${tenant?.tenantId}`}
          ref={negativeEmailRef}
          type="email"
          defaultValue={config?.negativeFeedbackEmail ?? ""}
          disabled={!isOwner}
          className={inputClasses}
        />
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
