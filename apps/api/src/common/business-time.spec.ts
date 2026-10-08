import { describe, expect, it } from 'vitest';
import {
  getBusinessDate,
  getBusinessMonthRange,
  getCutoffInstant,
  isWithinServingWindow,
  parseMealDate,
  resolveRegistrationWeekRestriction,
  resolveRegistrationWeekWindow,
} from './business-time.js';

describe('business time', () => {
  it('uses the Vietnam business date', () => {
    expect(getBusinessDate(new Date('2026-09-03T18:00:00.000Z'))).toBe(
      '2026-09-04',
    );
  });

  describe('registration week window', () => {
    it.each([
      [
        'Monday midday',
        '2026-08-31T05:00:00.000Z',
        '2026-08-31',
        false,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        'REGISTRATION_WEEK_NOT_OPEN',
        '2026-09-14',
      ],
      [
        'Friday at 23:59 Vietnam time',
        '2026-09-04T16:59:00.000Z',
        '2026-09-04',
        false,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        'REGISTRATION_WEEK_NOT_OPEN',
        '2026-09-14',
      ],
      [
        'Saturday at 16:59:59 Vietnam time',
        '2026-09-05T09:59:59.000Z',
        '2026-09-05',
        false,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        'REGISTRATION_WEEK_NOT_OPEN',
        '2026-09-14',
      ],
      [
        'Saturday at exactly 17:00 Vietnam time',
        '2026-09-05T10:00:00.000Z',
        '2026-09-05',
        true,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        null,
        '2026-09-14',
      ],
      [
        'Saturday after the weekly boundary',
        '2026-09-05T10:00:01.000Z',
        '2026-09-05',
        true,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        null,
        '2026-09-14',
      ],
      [
        'Sunday at 23:59:59 Vietnam time',
        '2026-09-06T16:59:59.000Z',
        '2026-09-06',
        true,
        '2026-08-31',
        '2026-09-06',
        '2026-09-07',
        '2026-09-13',
        '2026-09-05T10:00:00.000Z',
        null,
        '2026-09-14',
      ],
      [
        'next Monday at Vietnam midnight',
        '2026-09-06T17:00:00.000Z',
        '2026-09-07',
        false,
        '2026-09-07',
        '2026-09-13',
        '2026-09-14',
        '2026-09-20',
        '2026-09-12T10:00:00.000Z',
        'REGISTRATION_WEEK_NOT_OPEN',
        '2026-09-21',
      ],
    ] as const)(
      'resolves %s in UTC',
      (
        _label,
        instant,
        businessDate,
        nextWeekOpen,
        currentWeekStart,
        currentWeekEnd,
        nextWeekStart,
        nextWeekEnd,
        nextWeekOpenAt,
        nextRestriction,
        plusTwoDate,
      ) => {
        const window = resolveRegistrationWeekWindow(new Date(instant));
        expect(window).toMatchObject({
          businessDate,
          currentWeekStart,
          currentWeekEnd,
          nextWeekStart,
          nextWeekEnd,
          nextWeekOpen,
        });
        expect(window.nextWeekOpenAt.toISOString()).toBe(nextWeekOpenAt);
        expect(
          resolveRegistrationWeekRestriction(window, currentWeekStart),
        ).toBeNull();
        expect(
          resolveRegistrationWeekRestriction(window, nextWeekStart),
        ).toBe(nextRestriction);
        expect(
          resolveRegistrationWeekRestriction(window, plusTwoDate),
        ).toBe('OUTSIDE_REGISTRATION_WINDOW');
        expect(
          resolveRegistrationWeekRestriction(window, '2026-08-24'),
        ).toBe('OUTSIDE_REGISTRATION_WINDOW');
      },
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
