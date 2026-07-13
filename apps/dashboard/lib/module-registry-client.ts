import { apiFetch } from "@/lib/api";
import type { SettingsSchema } from "@/lib/onboarding-client";

// The tenant's enabled modules, enriched server-side with each module's
// display name/description (read from its config.json) -- this is the one
// source the Installed Systems hub, the module detail page, and the System
// Status strip all read from, so no page hardcodes a module's name.
export interface EnabledModule {
  moduleKey: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
}

export type ModuleStatus =
  | { status: "connected" }
  | { status: "needs attention"; reason: string };

// Everything one module's Settings tab needs in a single request: the schema
// to render the form from, this tenant's current values, the module's live
// getStatus() verdict for the indicator, and whether it's enabled. Mirrors the
// backend's ModuleSettings; any field is null when unavailable (module ships no
// schema, isn't enabled for the tenant, or has no live instance here).
export interface ModuleSettings {
  schema: SettingsSchema | null;
  config: Record<string, unknown> | null;
  status: ModuleStatus | null;
  enabled: boolean;
}

// Throws on failure (no session / non-OK response) rather than returning an
// empty list, so callers can tell "genuinely no modules" apart from "the
// request failed" -- the empty return used to render as a misleading
// "nothing installed" state. Status dots come from the batched
// GET /module-manifest/status read (useModuleStatuses in lib/queries.ts),
// which degrades per module server-side instead of per request here.
export function listEnabledModules(): Promise<EnabledModule[]> {
  return apiFetch<EnabledModule[]>("/module-manifest");
}

// One module's settings payload for the tenant Settings tab. Throws on failure
// (no session / non-OK) so the tab can tell "load failed" apart from an empty
// config, same contract as listEnabledModules above.
export function getModuleSettings(moduleKey: string): Promise<ModuleSettings> {
  return apiFetch<ModuleSettings>(`/module-manifest/${moduleKey}/settings`);
}

// Persists one module's config through the owner-guarded, schema-validating
// backend route -- the ONLY path a tenant writes module_manifest now that
// direct client writes are revoked at the DB level (migration 0018). On a
// rejection (non-owner, unknown module, schema-validation failure) the backend
// returns the reason as the response `message`; apiFetch surfaces it so the
// form shows the specific problem rather than an opaque failure.
export async function saveModuleConfig(
  moduleKey: string,
  config: Record<string, unknown>,
): Promise<void> {
  await apiFetch<{ saved: true }>(`/module-manifest/${moduleKey}/config`, {
    method: "PUT",
    body: { config },
  });
}
