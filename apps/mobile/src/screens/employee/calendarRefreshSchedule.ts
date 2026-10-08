import type { v1 } from '@imeal/contracts';

export const MAX_CALENDAR_REFRESH_DELAY_MS = 2_147_483_647;

type CalendarDayUnavailableReasons =
  v1.WeekRegistrationDay['unavailableReasons'];

export type CalendarRefreshDay = Pick<
  v1.WeekRegistrationDay,
  | 'cutoffAt'
  | 'canActivate'
  | 'canCancel'
  | 'canChangeMealChoice'
  | 'unavailableReasons'
>;

export type CalendarRefreshSnapshot = {
  serverNowAt: number;
  receiptAt: number;
  nextWeekOpenAt: string;
  days: readonly CalendarRefreshDay[];
};

function hasRegistrationWeekNotOpen(
  reasons: CalendarDayUnavailableReasons,
): boolean {
  return Object.values(reasons).some((dayReasons) =>
    dayReasons.includes('REGISTRATION_WEEK_NOT_OPEN'),
  );
}

export function getCalendarRefreshDelay(
  snapshot: CalendarRefreshSnapshot,
  deviceNowAt: number,
): number | null {
  const estimatedServerNowAt =
    snapshot.serverNowAt + (deviceNowAt - snapshot.receiptAt);
  if (!Number.isFinite(estimatedServerNowAt)) return null;

  const candidateTimes: number[] = [];
  for (const day of snapshot.days) {
    if (!day.canActivate && !day.canCancel && !day.canChangeMealChoice)
      continue;
    const cutoffAt = Date.parse(day.cutoffAt);
    if (Number.isFinite(cutoffAt) && cutoffAt > estimatedServerNowAt) {
      candidateTimes.push(cutoffAt);
    }
  }

  if (
    snapshot.days.some((day) =>
      hasRegistrationWeekNotOpen(day.unavailableReasons),
    )
  ) {
    const nextWeekOpenAt = Date.parse(snapshot.nextWeekOpenAt);
    if (
      Number.isFinite(nextWeekOpenAt) &&
      nextWeekOpenAt > estimatedServerNowAt
    ) {
      candidateTimes.push(nextWeekOpenAt);
    }
  }

  if (candidateTimes.length === 0) return null;
  const remaining = Math.min(...candidateTimes) - estimatedServerNowAt;
  if (!Number.isFinite(remaining)) return null;
  return Math.min(MAX_CALENDAR_REFRESH_DELAY_MS, Math.max(0, remaining));
}
