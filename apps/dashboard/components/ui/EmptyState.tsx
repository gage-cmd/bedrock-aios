// The empty state sells what will appear, in client language -- never a bare
// "no data". Copy rules: talk about their business (calls, reviews,
// customers, results), never AI, agents, modules, or internals.
export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center">
      <p className="font-medium text-[var(--color-ink)]">{title}</p>
      {body && (
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">
          {body}
        </p>
      )}
    </div>
  );
}
