// The standard contract every feature module's service implements. Kept in
// core so the registry and orchestrator can hold module instances without
// importing any module's own code (boundaries: core must never import from
// src/modules/*). Modules register themselves at boot via
// ModuleRegistryService.registerModule -- a module -> core dependency, which
// is the allowed direction.

export type ModuleStatus =
  { status: 'connected' } | { status: 'needs attention'; reason: string };

// Snapshot Contract v2 (Phase 7). One typed shape rich enough that a single
// generic dashboard card and analytics view serve every module -- modules do
// not ship their own widgets for standard data. Every string here is
// client-facing: business language only (branding rule applies).
export interface SnapshotDelta {
  direction: 'up' | 'down' | 'flat';
  text: string; // e.g. "up 2 from last week"
  good: boolean; // whether this direction is good news (down can be good)
}

export interface SnapshotMetric {
  key: string;
  label: string;
  value: string;
  delta?: SnapshotDelta;
}

export interface SnapshotSeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface SnapshotAttentionItem {
  key: string;
  text: string;
  href?: string; // dashboard-relative deep link
}

export interface SnapshotEvent {
  at: string; // ISO timestamp
  text: string;
}

export interface SnapshotV2 {
  headline: { label: string; value: string; dollarValue?: number };
  metrics: SnapshotMetric[];
  series?: { label: string; points: SnapshotSeriesPoint[] }; // last 14 days
  attention: SnapshotAttentionItem[];
  recentEvents: SnapshotEvent[]; // newest first, max 5
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
  getSnapshot(tenantId: string): Promise<SnapshotV2>;
  getStatus(tenantId: string): Promise<ModuleStatus>;
  getCapabilities(): string[];
  getQueryableIntents?(): QueryableIntent[];
}

export interface TenantCapability {
  moduleKey: string;
  capability: string;
}
