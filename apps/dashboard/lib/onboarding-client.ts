import { supabase } from "@/lib/supabase/client";

// Typed client for the Onboarding Console's backend (admin/onboarding/*).
// Same transport pattern as command-center-client: the signed-in session's
// access token as a bearer. For a platform admin that token carries no
// tenant_id claim -- AdminGuard on the backend is what authorizes these
// calls, and it rejects tenant-scoped tokens outright.

export interface AvailableModule {
  moduleKey: string;
  name: string;
  description: string;
  settingsSchema: SettingsSchema | null;
}

export interface SettingsSchema {
  title?: string;
  type: "object";
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface SchemaProperty {
  type: "string" | "integer" | "number" | "boolean";
  title?: string;
  description?: string;
  default?: string | number | boolean;
  format?: string;
  minimum?: number;
  maximum?: number;
}

export interface CreatedTenant {
  tenantId: string;
  name: string;
  status: string;
  plan: string;
  contactEmail: string;
}

export interface OnboardingState {
  tenantId: string;
  name: string;
  status: string;
  plan: string | null;
  modules: { moduleKey: string; enabled: boolean; config: Record<string, unknown> }[];
  defaultNumber: string | null;
  invitedUsers: { email: string; role: string }[];
}

export interface ProvisionedNumber {
  phone_number: string;
  is_default: boolean;
}

export interface InvitedUser {
  userId: string;
  email: string;
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not signed in");
  }

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/onboarding${path}`,
    {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }

  return (await res.json()) as T;
}

export function createTenant(input: {
  name: string;
  contactEmail: string;
  plan: string;
}): Promise<CreatedTenant> {
  return request("/tenants", { method: "POST", body: input });
}

export function listModules(): Promise<AvailableModule[]> {
  return request("/modules");
}

export function enableModules(
  tenantId: string,
  moduleKeys: string[],
): Promise<{ enabled: string[] }> {
  return request(`/tenants/${tenantId}/modules`, {
    method: "POST",
    body: { moduleKeys },
  });
}

export function saveModuleConfig(
  tenantId: string,
  moduleKey: string,
  config: Record<string, unknown>,
): Promise<{ saved: true }> {
  return request(`/tenants/${tenantId}/modules/${moduleKey}/config`, {
    method: "PUT",
    body: { config },
  });
}

export function provisionNumber(tenantId: string): Promise<ProvisionedNumber> {
  return request(`/tenants/${tenantId}/number`, { method: "POST" });
}

export function inviteOwner(
  tenantId: string,
  email: string,
): Promise<InvitedUser> {
  return request(`/tenants/${tenantId}/invite`, {
    method: "POST",
    body: { email },
  });
}

export function getOnboardingState(tenantId: string): Promise<OnboardingState> {
  return request(`/tenants/${tenantId}/state`);
}

export function activateTenant(tenantId: string): Promise<{ status: string }> {
  return request(`/tenants/${tenantId}/activate`, { method: "POST" });
}
