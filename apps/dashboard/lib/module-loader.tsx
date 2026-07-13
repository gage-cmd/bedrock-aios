"use client";

import { useEffect, useState, type ComponentType } from "react";
import { apiFetch, isSignedOutError } from "@/lib/api";
import { ModuleErrorBoundary } from "@/components/module-widgets/ModuleErrorBoundary";
import { ReviewGenerationWidget } from "@/components/module-widgets/ReviewGenerationWidget";
import { MissedCallTextbackWidget } from "@/components/module-widgets/MissedCallTextbackWidget";

interface EnabledModule {
  moduleKey: string;
  config: Record<string, unknown>;
}

// Maps a module_key to the widget component that renders it. The loader
// knows nothing else about any module -- add an entry here (and import the
// widget above) when a real module ships its own dashboard widget. See
// components/module-widgets/TestModuleWidget.tsx for the reference template.
const WIDGET_REGISTRY: Record<
  string,
  ComponentType<{ config: Record<string, unknown> }>
> = {
  // "test-module": TestModuleWidget,
  "review-generation": ReviewGenerationWidget,
  "missed-call-textback": MissedCallTextbackWidget,
};

// Fetches the enabled modules for the logged-in tenant and dynamically
// renders each one's widget, wrapped in its own error boundary so a crash
// in one module's widget can't take down the rest of the dashboard.
export function useModuleWidgets() {
  const [modules, setModules] = useState<EnabledModule[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const modules = await apiFetch<EnabledModule[]>("/module-manifest");
      if (active) setModules(modules);
    }

    load().catch((err) => {
      // Signed out mid-load: the dashboard layout is already redirecting to
      // /login, so don't flash an error state.
      if (active && !isSignedOutError(err)) setError(true);
    });

    return () => {
      active = false;
    };
  }, []);

  const widgets = modules
    .filter((m) => m.moduleKey in WIDGET_REGISTRY)
    .map((m) => {
      const Widget = WIDGET_REGISTRY[m.moduleKey];
      return (
        <ModuleErrorBoundary key={m.moduleKey} moduleKey={m.moduleKey}>
          <Widget config={m.config} />
        </ModuleErrorBoundary>
      );
    });

  return { widgets, error };
}
