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
  "rounded-md border border-black/[.08] px-3 py-2 text-black disabled:opacity-50 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

export default function ReviewGenerationSettingsPage() {
  const { tenant, loading } = useCurrentTenant();
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [config, setConfig] = useState<ReviewGenerationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessNameRef = useRef<HTMLInputElement>(null);
  const googleUrlRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const negativeEmailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenant) return;
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("module_manifest")
        .select("id, config")
        .eq("tenant_id", tenant!.tenantId)
        .eq("module_key", "review-generation")
        .maybeSingle();

      if (!active) return;
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

  if (loading || (tenant && config === null)) {
    return (
      <div className="flex-1 p-8 text-zinc-500 dark:text-zinc-400">Loading...</div>
    );
  }

  const isOwner = tenant?.role === "owner";

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Review Generation Settings
      </h1>

      <form onSubmit={handleSave} className="mt-6 flex max-w-lg flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Business name
          <input
            key={`name-${tenant?.tenantId}`}
            ref={businessNameRef}
            defaultValue={config?.businessName ?? ""}
            disabled={!isOwner}
            className={inputClasses}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
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
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          SMS message template
          <textarea
            key={`template-${tenant?.tenantId}`}
            ref={templateRef}
            defaultValue={config?.smsTemplate ?? DEFAULT_SMS_TEMPLATE}
            rows={4}
            disabled={!isOwner}
            className={inputClasses}
          />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Supports {"{customer_name}"} and {"{business_name}"}. The review link is
            added automatically.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Only account owners can edit these settings.
          </p>
        )}

        {isOwner && (
          <button
            type="submit"
            disabled={saving}
            className="mt-2 self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}
      </form>
    </div>
  );
}
