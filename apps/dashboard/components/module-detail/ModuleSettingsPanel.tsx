"use client";

import { useEffect, useState } from "react";
import { useCurrentTenant } from "@/lib/use-current-tenant";
import {
  getModuleSettings,
  saveModuleConfig,
  type ModuleSettings,
} from "@/lib/module-registry-client";
import { SchemaForm, type SchemaFormTheme } from "@/components/admin/SchemaForm";

// The generic, schema-driven Settings tab for ANY module. It fetches the
// module's schema + this tenant's config + live status from the backend
// (GET /module-manifest/:moduleKey/settings), renders the form from that
// schema via SchemaForm, and saves through the owner-guarded backend route
// (PUT /module-manifest/:moduleKey/config) -- never a direct table write.
//
// A module gets a working Settings tab purely by shipping a
// settings.schema.json; there is no per-module code here. This replaces the
// hand-rolled SettingsTab.tsx that each module used to carry, which duplicated
// its field list and default values and wrote to module_manifest directly.

// The tenant dashboard's palette, in its CSS-variable tokens -- handed to the
// otherwise admin-styled SchemaForm so the form matches the surrounding shell.
const TENANT_THEME: SchemaFormTheme = {
  input:
    "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] disabled:opacity-50",
  label: "flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]",
  description: "text-xs text-[var(--color-text-secondary)]",
  submit:
    "mt-2 self-start rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50",
  error: "text-sm text-[var(--color-status-attention)]",
};

// Turns the module's own getStatus() verdict (plus the enabled flag) into a
// single clear line for the tenant. A module with no live instance in this
// deployment (status null but enabled) shows nothing rather than a misleading
// dot -- we genuinely don't know its health here.
function StatusIndicator({ settings }: { settings: ModuleSettings }) {
  if (!settings.enabled) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Not yet enabled -- this system is turned on during setup before it can
        be configured.
      </p>
    );
  }
  if (!settings.status) return null;

  if (settings.status.status === "connected") {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-status-good)]">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full bg-[var(--color-status-good)]"
        />
        Fully set up
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-sm text-[var(--color-status-attention)]">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full bg-[var(--color-status-attention)]"
      />
      Needs attention: {settings.status.reason}
    </p>
  );
}

export function ModuleSettingsPanel({ moduleKey }: { moduleKey: string }) {
  const { tenant, loading } = useCurrentTenant();
  const [settings, setSettings] = useState<ModuleSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getModuleSettings(moduleKey)
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [moduleKey]);

  if (loadFailed) {
    return (
      <p className="text-sm text-[var(--color-status-attention)]">
        We couldn&apos;t load these settings. Please refresh to try again.
      </p>
    );
  }

  if (loading || !settings) {
    return <p className="text-[var(--color-text-secondary)]">Loading...</p>;
  }

  if (!settings.schema) {
    return (
      <div className="flex flex-col gap-4">
        <StatusIndicator settings={settings} />
        <p className="text-sm text-[var(--color-text-secondary)]">
          This system has no settings to configure here.
        </p>
      </div>
    );
  }

  // Backend enforces owner-only on save; this only mirrors it in the UI so
  // non-owners (and members of a not-yet-enabled module) see a read-only form
  // instead of a Save button that would be rejected.
  const isOwner = tenant?.role === "owner";
  const readOnly = !isOwner || !settings.enabled;

  return (
    <div className="flex flex-col gap-4">
      <StatusIndicator settings={settings} />

      <SchemaForm
        // Remount on tenant/module change so the form re-seeds from the new
        // config rather than keeping stale field state.
        key={`${tenant?.tenantId}-${moduleKey}`}
        schema={settings.schema}
        initialValues={settings.config ?? undefined}
        submitLabel="Save"
        readOnly={readOnly}
        theme={TENANT_THEME}
        onSubmit={async (values) => {
          setSaved(false);
          await saveModuleConfig(moduleKey, values);
          setSaved(true);
          // Re-fetch so the status indicator reflects the just-saved config.
          setSettings(await getModuleSettings(moduleKey));
        }}
      />

      {!isOwner && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Only account owners can edit these settings.
        </p>
      )}

      {saved && <p className="text-sm text-[var(--color-status-good)]">Saved.</p>}
    </div>
  );
}
