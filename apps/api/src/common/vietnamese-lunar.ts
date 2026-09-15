import { getLunarDate } from '@dqcai/vn-lunar';
import type { v1 } from '@imeal/contracts';
import { parseMealDate } from './business-time.js';

type MealChoice = v1.MealChoice;

const MIN_SUPPORTED_YEAR = 1200;
const MAX_SUPPORTED_YEAR = 2199;
const REGULAR_MEAL_CHOICES = ['REGULAR'] as const satisfies readonly MealChoice[];
const VEGETARIAN_MEAL_CHOICES = [
  'REGULAR',
  'VEGETARIAN',
] as const satisfies readonly MealChoice[];

export interface VietnameseLunarDate {
  day: number;
  month: number;
  year: number;
  isLeapMonth: boolean;
}

function getSolarDateParts(mealDate: string) {
  const parsed = parseMealDate(mealDate);
  const year = parsed.getUTCFullYear();
  if (year < MIN_SUPPORTED_YEAR || year > MAX_SUPPORTED_YEAR) {
    throw new RangeError(
      `Vietnamese lunar dates are supported only between ${MIN_SUPPORTED_YEAR} and ${MAX_SUPPORTED_YEAR}`,
    );
  }

  return {
    day: parsed.getUTCDate(),
    month: parsed.getUTCMonth() + 1,
    year,
  };
}

export function getVietnameseLunarDate(
  mealDate: string,
): VietnameseLunarDate {
  const { day, month, year } = getSolarDateParts(mealDate);
  const lunarDate = getLunarDate(day, month, year);
  return {
    day: lunarDate.day,
    month: lunarDate.month,
    year: lunarDate.year,
    isLeapMonth: lunarDate.leap,
  };
}

export function isVegetarianMealDate(mealDate: string): boolean {
  const { day } = getVietnameseLunarDate(mealDate);
  return day === 1 || day === 15;
}

export function getAvailableMealChoices(mealDate: string): readonly MealChoice[] {
  return isVegetarianMealDate(mealDate)
    ? VEGETARIAN_MEAL_CHOICES
    : REGULAR_MEAL_CHOICES;
}
