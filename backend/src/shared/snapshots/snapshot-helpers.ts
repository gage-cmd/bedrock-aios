// Helpers shared by module snapshot mappers (Snapshot Contract v2). Types
// mirror core/module-registry/module-contract.ts structurally -- shared/
// cannot import from core/ (eslint-boundaries), and TypeScript's structural
// typing makes the duplication safe.

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface WeekDelta {
  direction: 'up' | 'down' | 'flat';
  text: string;
  good: boolean;
}

// Expands sparse per-day counts into a dense series covering the last `days`
// days (UTC), zero-filling missing days so sparklines have a stable x-axis.
export function fillDailySeries(
  rows: DailyPoint[],
  days: number,
): DailyPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const series: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    series.push({ date, value: byDate.get(date) ?? 0 });
  }
  return series;
}

// Week-over-week delta in client language. `downIsGood` flips which
// direction counts as good news (e.g. fewer un-recovered calls).
export function weekDelta(
  current: number,
  prior: number,
  {
    downIsGood = false,
    unit = '',
  }: { downIsGood?: boolean; unit?: string } = {},
): WeekDelta | undefined {
  const diff = current - prior;
  if (diff === 0) {
    return { direction: 'flat', text: 'same as last week', good: true };
  }
  const direction = diff > 0 ? 'up' : 'down';
  const magnitude = Math.abs(diff);
  const rounded = Number.isInteger(magnitude)
    ? String(magnitude)
    : magnitude.toFixed(1);
  return {
    direction,
    text: `${direction} ${rounded}${unit} from last week`,
    good: diff > 0 ? !downIsGood : downIsGood,
  };
}
