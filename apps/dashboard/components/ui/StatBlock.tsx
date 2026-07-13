// A labeled headline metric: quiet label, gold tabular-mono value. This is
// the house style for every number that represents the client's results.
export function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>
      <p className="font-metric text-2xl font-medium text-[var(--color-accent-gold)]">
        {value}
      </p>
    </div>
  );
}
