import { describe, expect, it } from 'vitest';
import {
  getBusinessDate,
  getBusinessMonthRange,
  getCutoffInstant,
  isWithinServingWindow,
  parseMealDate,
} from './business-time.js';

describe('business time', () => {
  it('uses the Vietnam business date', () => {
    expect(getBusinessDate(new Date('2026-09-03T18:00:00.000Z'))).toBe(
      '2026-09-04',
    );
  });

  it.each([
    ['2026-09-04T03:29:59.000Z', false],
    ['2026-09-04T03:30:00.000Z', true],
    ['2026-09-04T06:30:00.000Z', false],
    ['2026-09-04T06:30:01.000Z', false],
  ])('enforces the serving window at %s', (instant, expected) => {
    expect(isWithinServingWindow(new Date(instant))).toBe(expected);
  });

  it('locks a meal at exactly the previous-day cutoff', () => {
    expect(getCutoffInstant('2026-09-05', '14:00').toISOString()).toBe(
      '2026-09-04T07:00:00.000Z',
    );
  });

  it('rejects normalized and malformed meal dates', () => {
    expect(() => parseMealDate('2026-02-30')).toThrow('Meal date is invalid');
    expect(() => parseMealDate('09/04/2026')).toThrow(
      'Meal date must use YYYY-MM-DD',
    );
  });

  it.each([
    ['2024-02', '2024-02-01', '2024-02-29'],
    ['0000-02', '0000-02-01', '0000-02-29'],
  ])('returns the UTC calendar range for %s', (month, start, end) => {
    const range = getBusinessMonthRange(month);
    expect(range.startDate.toISOString().slice(0, 10)).toBe(start);
    expect(range.endDate.toISOString().slice(0, 10)).toBe(end);
  });

  it('rejects invalid business months', () => {
    expect(() => getBusinessMonthRange('2024-13')).toThrow('Invalid time value');
  });
});
