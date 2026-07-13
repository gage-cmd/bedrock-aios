"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  getModuleStatus,
  listEnabledModules,
  type EnabledModule,
} from "@/lib/module-registry-client";

// Shared query hooks for the reads several components make. Query keys are
// what deduplicate them: the status strip and every page that lists modules
// share one ["module-manifest"] cache entry instead of each firing its own
// request per navigation.

export function useEnabledModules() {
  return useQuery<EnabledModule[]>({
    queryKey: ["module-manifest"],
    queryFn: listEnabledModules,
  });
}

// One status query per module, cached individually so a page showing a single
// module reuses the entry the strip already fetched. getModuleStatus degrades
// to null on failure by design (unknown dot, not an error state).
export function useModuleStatuses(moduleKeys: string[]) {
  return useQueries({
    queries: moduleKeys.map((moduleKey) => ({
      queryKey: ["module-status", moduleKey],
      queryFn: () => getModuleStatus(moduleKey),
    })),
  });
}

export interface Snapshot {
  metric: string;
  value: string;
}

export function useModuleSnapshot(moduleKey: string) {
  return useQuery<Snapshot>({
    queryKey: ["module-snapshot", moduleKey],
    queryFn: () => apiFetch<Snapshot>(`/modules/${moduleKey}/snapshot`),
  });
}
