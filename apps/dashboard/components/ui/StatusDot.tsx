const TONE_CLASSES = {
  good: "status-dot-good bg-[var(--color-status-good)]",
  attention: "bg-[var(--color-status-attention)]",
  unknown: "bg-[var(--color-ink-muted)]",
} as const;

const TONE_LABELS = {
  good: "Running",
  attention: "Needs attention",
  unknown: "Status unknown",
} as const;

export type StatusTone = keyof typeof TONE_CLASSES;

// Status is never conveyed by color alone: the dot always carries a
// screen-reader label alongside the visual. The good tone breathes
// (status-breathe in globals.css, disabled under prefers-reduced-motion).
export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span className={className ? `inline-flex ${className}` : "inline-flex"}>
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${TONE_CLASSES[tone]}`}
      />
      <span className="sr-only">{TONE_LABELS[tone]}</span>
    </span>
  );
}
