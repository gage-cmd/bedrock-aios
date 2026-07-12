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
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

// A tenant still mid-onboarding, for the resume list.
export interface OnboardingTenantSummary {
  tenantId: string;
  name: string;
  createdAt: string;
}

// A number offered for an area code, before purchase.
export interface AvailableNumber {
  phoneNumber: string;
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

// Carries the backend's status and error code so callers can tell apart an
// expected, actionable failure (a same-name tenant -> 409 'duplicate_name')
// from a generic one, without string-matching messages.
export class OnboardingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "OnboardingRequestError";
  }
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
      code?: string;
    } | null;
    throw new OnboardingRequestError(
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.code,
    );
  }

  return (await res.json()) as T;
}

export function listOnboardingTenants(): Promise<OnboardingTenantSummary[]> {
  return request("/tenants");
}

export function createTenant(input: {
  name: string;
  contactEmail: string;
  plan: string;
  // Set only after the admin has seen the same-name warning and chosen to
  // create a separate tenant anyway.
  confirmDuplicate?: boolean;
}): Promise<CreatedTenant> {
  return request("/tenants", { method: "POST", body: input });
}

export function updateTenantName(
  tenantId: string,
  name: string,
): Promise<{ name: string }> {
  return request(`/tenants/${tenantId}`, { method: "PATCH", body: { name } });
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

export function searchNumbers(
  tenantId: string,
  areaCode: string,
): Promise<AvailableNumber[]> {
  return request(
    `/tenants/${tenantId}/numbers?areaCode=${encodeURIComponent(areaCode)}`,
  );
}

export function provisionNumber(
  tenantId: string,
  phoneNumber: string,
  // The client's own Twilio Messaging Service SID (ISV model). Required by the
  // backend before a number is purchased -- the number is registered into this
  // service.
  messagingServiceSid: string,
): Promise<ProvisionedNumber> {
  return request(`/tenants/${tenantId}/number`, {
    method: "POST",
    body: { phoneNumber, messagingServiceSid },
  });
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
