import { apiFetch, ApiError } from "@/lib/api";

// Typed client for the Onboarding Console's backend (admin/onboarding/*).
// Same transport as every other client (lib/api.ts): the signed-in session's
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

// ApiError already carries the backend's status and error code, so callers
// can tell apart an expected, actionable failure (a same-name tenant -> 409
// 'duplicate_name') from a generic one, without string-matching messages.
// Kept under the old name for existing instanceof checks.
export { ApiError as OnboardingRequestError };

function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  return apiFetch<T>(`/admin/onboarding${path}`, init);
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
