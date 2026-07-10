"use client";

import { Component, ReactNode } from "react";

interface Props {
  moduleKey: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Isolates a single module widget's render crash from the rest of the
// dashboard: one broken widget shows this fallback, everything else
// (nav, other widgets, the rest of the page) keeps working normally.
export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`Module widget "${this.props.moduleKey}" crashed:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-[var(--color-status-attention)]/40 p-4 text-sm text-[var(--color-status-attention)]">
          &ldquo;{this.props.moduleKey}&rdquo; failed to load.
        </div>
      );
    }

    return this.props.children;
  }
}
