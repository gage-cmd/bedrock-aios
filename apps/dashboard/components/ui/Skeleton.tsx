// Loading placeholder shaped like the content it stands in for -- pages
// compose these to mirror their final layout instead of showing "Loading..."
// text. Shimmer lives in globals.css and stops under prefers-reduced-motion.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton rounded-md${className ? ` ${className}` : ""}`}
    />
  );
}
