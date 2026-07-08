// The standard contract every feature module's service implements. Kept in
// core so the registry and orchestrator can hold module instances without
// importing any module's own code (boundaries: core must never import from
// src/modules/*). Modules register themselves at boot via
// ModuleRegistryService.registerModule -- a module -> core dependency, which
// is the allowed direction.

export type ModuleStatus =
  { status: 'connected' } | { status: 'needs attention'; reason: string };

export interface SnapshotResult {
  metric: string;
  value: string;
}

// A read-only handleRequest intent a module is willing to expose to the
// orchestrator. Write intents (sending SMS, creating records) are
// deliberately NOT advertised here -- the orchestrator answers questions, it
// does not take actions on the tenant's behalf.
export interface QueryableIntent {
  intent: string;
  description: string;
}

export interface ModuleContract {
  handleRequest(
    tenantId: string,
    intent: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown>;
  getSnapshot(tenantId: string): Promise<SnapshotResult>;
  getStatus(tenantId: string): Promise<ModuleStatus>;
  getCapabilities(): string[];
  getQueryableIntents?(): QueryableIntent[];
}

export interface TenantCapability {
  moduleKey: string;
  capability: string;
}
