import { fillDailySeries, weekDelta } from './snapshot-helpers';

describe('fillDailySeries', () => {
  it('zero-fills a full window from empty input', () => {
    const series = fillDailySeries([], 14);

    expect(series).toHaveLength(14);
    expect(series.every((p) => p.value === 0)).toBe(true);
    // Last entry is today (UTC), dates strictly ascending.
    expect(series[13].date).toBe(new Date().toISOString().slice(0, 10));
    const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
    expect(series).toEqual(sorted);
  });

  it('places sparse counts on their day and zero-fills the rest', () => {
    const today = new Date().toISOString().slice(0, 10);
    const series = fillDailySeries([{ date: today, value: 3 }], 14);

    expect(series[13]).toEqual({ date: today, value: 3 });
    expect(series.reduce((sum, p) => sum + p.value, 0)).toBe(3);
  });

  it('ignores rows outside the window', () => {
    const series = fillDailySeries([{ date: '2020-01-01', value: 9 }], 7);

    expect(series).toHaveLength(7);
    expect(series.every((p) => p.value === 0)).toBe(true);
  });
});

describe('weekDelta', () => {
  it('is flat and good when nothing changed', () => {
    expect(weekDelta(2, 2)).toEqual({
      direction: 'flat',
      text: 'same as last week',
      good: true,
    });
  });

  it('up is good by default', () => {
    expect(weekDelta(5, 3)).toEqual({
      direction: 'up',
      text: 'up 2 from last week',
      good: true,
    });
  });

  it('down is bad by default, good when downIsGood', () => {
    expect(weekDelta(1, 4)?.good).toBe(false);
    expect(weekDelta(1, 4, { downIsGood: true })?.good).toBe(true);
  });

  it('formats fractional deltas with one decimal and a unit', () => {
    expect(weekDelta(4.8, 4.5, { unit: '★' })?.text).toBe(
      'up 0.3★ from last week',
    );
  });
});
