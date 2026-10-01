import { describe, expect, it } from 'vitest';
import {
  getAvailableMealChoices,
  getVietnameseLunarDate,
  isVegetarianMealDate,
} from './vietnamese-lunar.js';

describe('Vietnamese lunar date utility', () => {
  it.each([
    ['2026-02-17', { day: 1, month: 1, year: 2026, isLeapMonth: false }],
    ['2026-03-03', { day: 15, month: 1, year: 2026, isLeapMonth: false }],
    ['2026-09-25', { day: 15, month: 8, year: 2026, isLeapMonth: false }],
    ['2026-09-26', { day: 16, month: 8, year: 2026, isLeapMonth: false }],
    ['2026-11-09', { day: 1, month: 10, year: 2026, isLeapMonth: false }],
    ['2026-11-10', { day: 2, month: 10, year: 2026, isLeapMonth: false }],
  ])('converts %s to its Vietnamese lunar date', (mealDate, expected) => {
    expect(getVietnameseLunarDate(mealDate)).toEqual(expected);
  });

  it('allows vegetarian meals on lunar day 1 and 15', () => {
    expect(isVegetarianMealDate('2026-09-25')).toBe(true);
    expect(getAvailableMealChoices('2026-09-25')).toEqual([
      'REGULAR',
      'VEGETARIAN',
    ]);
  });

  it('only allows regular meals on other dates', () => {
    expect(isVegetarianMealDate('2026-09-26')).toBe(false);
    expect(getAvailableMealChoices('2026-09-26')).toEqual(['REGULAR']);
  });

  it('supports vegetarian choices on leap-month lunar days 1 and 15', () => {
    const leapMealDates = [
      {
        mealDate: '2025-07-25',
        lunarDate: { day: 1, month: 6, year: 2025, isLeapMonth: true },
      },
      {
        mealDate: '2025-08-08',
        lunarDate: { day: 15, month: 6, year: 2025, isLeapMonth: true },
      },
    ];
    for (const { mealDate, lunarDate } of leapMealDates) {
      expect(getVietnameseLunarDate(mealDate)).toEqual(lunarDate);
      expect(getAvailableMealChoices(mealDate)).toEqual([
        'REGULAR',
        'VEGETARIAN',
      ]);
    }

    expect(getVietnameseLunarDate('2025-08-09')).toEqual({
      day: 16,
      month: 6,
      year: 2025,
      isLeapMonth: true,
    });
    expect(getAvailableMealChoices('2025-08-09')).toEqual(['REGULAR']);
  });

  it.each(['2026-02-30', '2026/09/25', 'not-a-date'])(
    'rejects invalid meal date %s',
    (mealDate) => {
      expect(() => getVietnameseLunarDate(mealDate)).toThrow(
        /Meal date (must use YYYY-MM-DD|is invalid)/,
      );
    },
  );

  it.each(['1199-12-31', '2200-01-01'])(
    'rejects meal date outside supported lunar range: %s',
    (mealDate) => {
      expect(() => getVietnameseLunarDate(mealDate)).toThrow(RangeError);
      expect(() => getVietnameseLunarDate(mealDate)).toThrow(
        /between 1200 and 2199/,
      );
    },
  );

  it.each(['1200-02-01', '2199-12-31'])(
    'supports lunar range boundary date %s',
    (mealDate) => {
      expect(getVietnameseLunarDate(mealDate).year).toBeGreaterThanOrEqual(
        1200,
      );
    },
  );
});
