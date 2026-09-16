export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export type BusinessLocale = 'vi-VN' | 'en-US';

export function formatDay(date: Date, locale: BusinessLocale): string {
  return date.toLocaleDateString(locale, { weekday: 'long' });
}

export function formatShortDate(date: Date, locale: BusinessLocale): string {
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function formatMonth(date: Date, locale: BusinessLocale): string {
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function formatBusinessInstant(iso: string, locale: BusinessLocale): string {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

export function initials(name?: string, fallback = 'ME'): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) || [];
  if (parts.length === 0) return fallback;
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}
