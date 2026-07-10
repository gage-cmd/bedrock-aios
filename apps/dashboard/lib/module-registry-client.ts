import { supabase } from "@/lib/supabase/client";

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
