export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMAT = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function getZonedParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function getBusinessDate(now: Date = new Date()): string {
  const parts = getZonedParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type RegistrationWeekRestriction =
  | null
  | 'REGISTRATION_WEEK_NOT_OPEN'
  | 'OUTSIDE_REGISTRATION_WINDOW';

export type RegistrationWeekWindow = {
  businessDate: string;
  currentWeekStart: string;
  currentWeekEnd: string;
  nextWeekStart: string;
  nextWeekEnd: string;
  nextWeekOpenAt: Date;
  nextWeekOpen: boolean;
};

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toMealDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveRegistrationWeekWindow(
  now: Date,
): RegistrationWeekWindow {
  const businessDate = getBusinessDate(now);
  const businessDateValue = parseMealDate(businessDate);
  const daysSinceMonday = (businessDateValue.getUTCDay() + 6) % 7;
  const currentWeekStartValue = addUtcDays(
    businessDateValue,
    -daysSinceMonday,
  );
  const currentWeekEndValue = addUtcDays(currentWeekStartValue, 6);
  const nextWeekStartValue = addUtcDays(currentWeekStartValue, 7);
  const nextWeekEndValue = addUtcDays(nextWeekStartValue, 6);
  const nextWeekOpenAt = addUtcDays(currentWeekStartValue, 5);
  // Saturday 17:00 in Vietnam is 10:00 UTC; this is independent of CUTOFF_TIME.
  nextWeekOpenAt.setUTCHours(10, 0, 0, 0);

  return {
    businessDate,
    currentWeekStart: toMealDateKey(currentWeekStartValue),
    currentWeekEnd: toMealDateKey(currentWeekEndValue),
    nextWeekStart: toMealDateKey(nextWeekStartValue),
    nextWeekEnd: toMealDateKey(nextWeekEndValue),
    nextWeekOpenAt,
    nextWeekOpen: now >= nextWeekOpenAt,
  };
}

export function resolveRegistrationWeekRestriction(
  window: RegistrationWeekWindow,
  mealDate: string,
): RegistrationWeekRestriction {
  const mealDateKey = toMealDateKey(parseMealDate(mealDate));
  if (
    mealDateKey >= window.currentWeekStart &&
    mealDateKey <= window.currentWeekEnd
  ) {
    return null;
  }
  if (
    mealDateKey >= window.nextWeekStart &&
    mealDateKey <= window.nextWeekEnd
  ) {
    return window.nextWeekOpen ? null : 'REGISTRATION_WEEK_NOT_OPEN';
  }
  return 'OUTSIDE_REGISTRATION_WINDOW';
}

export function getBusinessMonthRange(month: string): {
  startDate: Date;
  endDate: Date;
} {
  const startDate = parseMealDate(`${month}-01`);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return { startDate, endDate };
}

export function parseMealDate(value: string): Date {
  if (!DATE_FORMAT.test(value)) {
    throw new Error('Meal date must use YYYY-MM-DD');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Meal date is invalid');
  }
  return parsed;
}

export function isWithinServingWindow(now: Date = new Date()): boolean {
  const parts = getZonedParts(now);
  const secondOfDay =
    Number(parts.hour) * 3600 +
    Number(parts.minute) * 60 +
    Number(parts.second);
  return (
    secondOfDay >= 10 * 3600 + 30 * 60 && secondOfDay < 13 * 3600 + 30 * 60
  );
}

export function getCutoffInstant(mealDate: string, cutoffTime: string): Date {
  if (!TIME_FORMAT.test(cutoffTime)) {
    throw new Error('Cutoff time must use HH:mm');
  }

  const date = parseMealDate(mealDate);
  const [hour, minute] = cutoffTime.split(':').map(Number);
  date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCHours(hour - 7, minute, 0, 0);
  return date;
}
