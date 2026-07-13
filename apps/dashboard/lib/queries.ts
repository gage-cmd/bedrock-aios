"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  listEnabledModules,
  type EnabledModule,
  type ModuleStatus,
} from "@/lib/module-registry-client";

// Shared query hooks for the reads several components make. Query keys are
// what deduplicate them: the status strip and every page that lists modules
// share one ["module-manifest"] and one ["module-statuses"] cache entry
// instead of each firing its own requests per navigation.

export function useEnabledModules() {
  return useQuery<EnabledModule[]>({
    queryKey: ["module-manifest"],
    queryFn: listEnabledModules,
  });
}

// One batched request for every enabled module's status verdict. `status:
// null` means unknown (no live instance) -- rendered as a neutral dot.
export interface ModuleStatusEntry {
  moduleKey: string;
  status: ModuleStatus | null;
}

export function useModuleStatuses() {
  const { data } = useQuery<ModuleStatusEntry[]>({
    queryKey: ["module-statuses"],
    queryFn: () => apiFetch<ModuleStatusEntry[]>("/module-manifest/status"),
  });

  // Keyed lookup so components render each module's dot without caring about
  // response order. Missing key = still loading or unknown, both neutral.
  const byKey = new Map<string, ModuleStatus | null>();
  for (const entry of data ?? []) byKey.set(entry.moduleKey, entry.status);
  return byKey;
}

// Snapshot Contract v2 -- mirrors the backend's SnapshotV2 in
// core/module-registry/module-contract.ts.
export interface SnapshotDelta {
  direction: "up" | "down" | "flat";
  text: string;
  good: boolean;
}

export interface SnapshotMetric {
  key: string;
  label: string;
  value: string;
  delta?: SnapshotDelta;
}

export interface SnapshotAttentionItem {
  key: string;
  text: string;
  href?: string;
}

export interface Snapshot {
  headline: { label: string; value: string; dollarValue?: number };
  metrics: SnapshotMetric[];
  series?: { label: string; points: Array<{ date: string; value: number }> };
  attention: SnapshotAttentionItem[];
  recentEvents: Array<{ at: string; text: string }>;
}

export function useModuleSnapshot(moduleKey: string) {
  return useQuery<Snapshot>({
    queryKey: ["module-snapshot", moduleKey],
    queryFn: () => apiFetch<Snapshot>(`/modules/${moduleKey}/snapshot`),
  });
}
