import { describe, expect, it } from 'vitest';
import { buildMonthRows } from './calendarGrid';

describe('buildMonthRows', () => {
  it('pads September 2026 with Monday-first seven-cell rows', () => {
    const rows = buildMonthRows(new Date(2026, 8, 1));

    expect(rows.map((row) => row.map((day) => day?.getDate() ?? null))).toEqual([
      [null, 1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12, 13],
      [14, 15, 16, 17, 18, 19, 20],
      [21, 22, 23, 24, 25, 26, 27],
      [28, 29, 30, null, null, null, null],
    ]);
  });

  it('always returns rows with exactly seven cells', () => {
    const rows = buildMonthRows(new Date(2026, 1, 1));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.length === 7)).toBe(true);
  });
});
