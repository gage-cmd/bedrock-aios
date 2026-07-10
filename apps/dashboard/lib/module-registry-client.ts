import { supabase } from "@/lib/supabase/client";
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

async function authHeader(): Promise<{ Authorization: string } | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

// Throws on failure (no session / non-OK response) rather than returning an
// empty list, so callers can tell "genuinely no modules" apart from "the
// request failed" -- the empty return used to render as a misleading
// "nothing installed" state. getModuleStatus below intentionally keeps
// degrading to null instead of throwing: it runs once per module inside a
// Promise.all, and one module's status hiccup should show an unknown dot,
// not take down the whole list.
export async function listEnabledModules(): Promise<EnabledModule[]> {
  const headers = await authHeader();
  if (!headers) throw new Error("Not signed in");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/module-manifest`,
    { headers },
  );
  if (!res.ok) throw new Error(`Request failed (${res.status})`);

  return res.json() as Promise<EnabledModule[]>;
}

export async function getModuleStatus(
  moduleKey: string,
): Promise<ModuleStatus | null> {
  const headers = await authHeader();
  if (!headers) return null;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/modules/${moduleKey}/status`,
    { headers },
  );
  if (!res.ok) return null;

  return res.json() as Promise<ModuleStatus>;
}

// One module's settings payload for the tenant Settings tab. Throws on failure
// (no session / non-OK) so the tab can tell "load failed" apart from an empty
// config, same contract as listEnabledModules above.
export async function getModuleSettings(
  moduleKey: string,
): Promise<ModuleSettings> {
  const headers = await authHeader();
  if (!headers) throw new Error("Not signed in");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/module-manifest/${moduleKey}/settings`,
    { headers },
  );
  if (!res.ok) throw new Error(`Request failed (${res.status})`);

  return res.json() as Promise<ModuleSettings>;
}

// Persists one module's config through the owner-guarded, schema-validating
// backend route -- the ONLY path a tenant writes module_manifest now that
// direct client writes are revoked at the DB level (migration 0018). On a
// rejection (non-owner, unknown module, schema-validation failure) the backend
// returns the reason as the response `message`; surface it so the form shows
// the specific problem rather than an opaque failure.
export async function saveModuleConfig(
  moduleKey: string,
  config: Record<string, unknown>,
): Promise<void> {
  const headers = await authHeader();
  if (!headers) throw new Error("Not signed in");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/module-manifest/${moduleKey}/config`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
}
