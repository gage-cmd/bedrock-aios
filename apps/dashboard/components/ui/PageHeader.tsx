import type { ReactNode } from "react";

// Serif display title + quiet subtitle, the top of every page in the
// (dashboard) group.
export function PageHeader({
  title,
  subtitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
