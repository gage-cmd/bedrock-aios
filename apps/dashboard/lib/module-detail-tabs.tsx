import type { ReactNode } from "react";
import { OverviewTab } from "@/components/module-detail/OverviewTab";
import { ContactsTab as ReviewContactsTab } from "@/components/module-detail/review-generation/ContactsTab";
import { ActivityTab as ReviewActivityTab } from "@/components/module-detail/review-generation/ActivityTab";
import { ActivityTab as MissedCallActivityTab } from "@/components/module-detail/missed-call-textback/ActivityTab";
import { ModuleSettingsPanel } from "@/components/module-detail/ModuleSettingsPanel";

export interface ModuleTab {
  key: string;
  label: string;
  render: () => ReactNode;
}

// Each module's set of sub-pages, consolidated into tabs on its detail page
// instead of separate top-level routes. A module without an entry here still
// gets a working detail page with just the generic Overview tab -- adding a
// module's own tabs is the one place that needs a code change, same as
// WIDGET_REGISTRY in module-loader.tsx.
export const MODULE_TABS: Record<string, ModuleTab[]> = {
  "review-generation": [
    { key: "overview", label: "Overview", render: () => <OverviewTab moduleKey="review-generation" /> },
    { key: "contacts", label: "Contacts", render: () => <ReviewContactsTab /> },
    { key: "activity", label: "Activity", render: () => <ReviewActivityTab /> },
    { key: "settings", label: "Settings", render: () => <ModuleSettingsPanel moduleKey="review-generation" /> },
  ],
  "missed-call-textback": [
    { key: "overview", label: "Overview", render: () => <OverviewTab moduleKey="missed-call-textback" /> },
    { key: "activity", label: "Activity", render: () => <MissedCallActivityTab /> },
    { key: "settings", label: "Settings", render: () => <ModuleSettingsPanel moduleKey="missed-call-textback" /> },
  ],
};

export function getModuleTabs(moduleKey: string): ModuleTab[] {
  return (
    MODULE_TABS[moduleKey] ?? [
      { key: "overview", label: "Overview", render: () => <OverviewTab moduleKey={moduleKey} /> },
    ]
  );
}
