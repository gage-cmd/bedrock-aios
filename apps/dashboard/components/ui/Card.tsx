import type { ReactNode } from "react";

// The one card surface. Every boxed thing on the dashboard (widgets, list
// rows, form panels) renders on this so border, radius, and background stay
// identical everywhere and theme changes are token-only.
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
