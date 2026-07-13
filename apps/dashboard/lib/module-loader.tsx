"use client";

import type { ComponentType } from "react";
import { isSignedOutError } from "@/lib/api";
import { useEnabledModules } from "@/lib/queries";
import { ModuleErrorBoundary } from "@/components/module-widgets/ModuleErrorBoundary";
import { ReviewGenerationWidget } from "@/components/module-widgets/ReviewGenerationWidget";
import { MissedCallTextbackWidget } from "@/components/module-widgets/MissedCallTextbackWidget";

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

// Renders each enabled module's widget from the shared module-manifest query,
// wrapped in its own error boundary so a crash in one module's widget can't
// take down the rest of the dashboard.
export function useModuleWidgets() {
  const { data, isError, error: queryError } = useEnabledModules();

  // Signed out mid-load: the dashboard layout is already redirecting to
  // /login, so don't flash an error state.
  const error = isError && !isSignedOutError(queryError);

  const widgets = (data ?? [])
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
