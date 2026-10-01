import { describe, expect, it } from 'vitest';
import {
  formatBusinessInstant,
  formatDay,
  formatMonth,
  formatShortDate,
  toBusinessDateKey,
} from './businessDate';

describe('business date formatting', () => {
  const date = new Date(2026, 8, 15);

  it('formats date-only calendar values with the requested locale', () => {
    expect(formatDay(date, 'en-US')).toBe(
      date.toLocaleDateString('en-US', { weekday: 'long' }),
    );
    expect(formatDay(date, 'vi-VN')).toBe(
      date.toLocaleDateString('vi-VN', { weekday: 'long' }),
    );
    expect(formatShortDate(date, 'en-US')).toBe(
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    );
    expect(formatMonth(date, 'vi-VN')).toBe(
      date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }),
    );
  });

  it('formats instants in the business timezone without changing the instant', () => {
    const iso = '2026-09-15T16:30:00.000Z';
    expect(formatBusinessInstant(iso, 'en-US')).toBe(
      new Date(iso).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
    );
  });
  it('derives the meal date from an instant in the business timezone', () => {
    expect(toBusinessDateKey('2026-09-30T16:59:59.000Z')).toBe('2026-09-30');
    expect(toBusinessDateKey('2026-09-30T17:00:00.000Z')).toBe('2026-10-01');
  });
});
