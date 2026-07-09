"use client";

// Reference template for building a real module's dashboard widget:
// receives this module's `config` straight from module_manifest and
// renders whatever it wants. Copy this file as the starting point for a
// new module's widget, then register it in lib/module-loader.ts.
//
// TEST FLAG -- flip to true and register "test-module" in module-loader.ts
// to exercise the ModuleErrorBoundary crash-isolation path during
// development. Must be false and unregistered otherwise.
const SHOULD_THROW_FOR_TESTING = false;

export function TestModuleWidget({
  config,
}: {
  config: Record<string, unknown>;
}) {
  if (SHOULD_THROW_FOR_TESTING) {
    throw new Error("Deliberate test-module render failure");
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-4">
      <p className="text-sm font-medium text-[var(--color-ink)]">Test module</p>
      <pre className="mt-2 text-xs text-[var(--color-text-secondary)]">
        {JSON.stringify(config, null, 2)}
      </pre>
    </div>
  );
}
