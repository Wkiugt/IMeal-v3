import type { v1 } from '@imeal/contracts';

export type MealChoice = v1.MealChoice;
const REGULAR: MealChoice = 'REGULAR';
export type CalendarDayState = {
  active: boolean;
  mealChoice: MealChoice;
};

export type CalendarServerState = Readonly<Record<string, CalendarDayState>>;
export type CalendarDraftState = Readonly<Record<string, CalendarDayState>>;
export type CalendarDayAvailability = Pick<
  v1.WeekRegistrationDay,
  | 'cutoffAt'
  | 'availableMealChoices'
  | 'canActivate'
  | 'canCancel'
  | 'canChangeMealChoice'
  | 'menu'
  | 'location'
  | 'unavailableReasons'
>;
export type CalendarBatchResult = v1.BatchRegistrationResult;

const inactiveCalendarDay: CalendarDayState = {
  active: false,
  mealChoice: REGULAR,
};

function sameCalendarDay(
  left: CalendarDayState | undefined,
  right: CalendarDayState | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.active === right.active &&
    (!left.active || left.mealChoice === right.mealChoice)
  );
}

export function createDraftState(
  serverState: CalendarServerState,
): CalendarDraftState {
  const next: Record<string, CalendarDayState> = {};
  for (const [dateKey, state] of Object.entries(serverState)) {
    next[dateKey] = { ...state };
  }
  return next;
}

export function setDraftDay(
  draftState: CalendarDraftState,
  dateKey: string,
  nextDay: CalendarDayState,
): CalendarDraftState {
  return { ...draftState, [dateKey]: { ...nextDay } };
}

export function getDirtyDates(
  serverState: CalendarServerState,
  draftState: CalendarDraftState,
): string[] {
  const dateKeys = new Set([
    ...Object.keys(serverState),
    ...Object.keys(draftState),
  ]);
  return [...dateKeys].sort().filter((dateKey) => {
    const serverDay = serverState[dateKey] ?? inactiveCalendarDay;
    const draftDay = draftState[dateKey] ?? serverDay;
    return !sameCalendarDay(serverDay, draftDay);
  });
}
export function getDirtyDatesForWeek(
  serverState: CalendarServerState,
  draftState: CalendarDraftState,
  weekDates: readonly string[],
): string[] {
  const allowedDates = new Set(weekDates);
  return getDirtyDates(serverState, draftState).filter((dateKey) =>
    allowedDates.has(dateKey),
  );
}

export function buildDirtyBatchPayload(
  serverState: CalendarServerState,
  draftState: CalendarDraftState,
  dirtyDates: readonly string[],
): v1.BatchRegistrationItem[] {
  const payload: v1.BatchRegistrationItem[] = [];
  for (const dateKey of dirtyDates) {
    const serverDay = serverState[dateKey] ?? inactiveCalendarDay;
    const draftDay = draftState[dateKey] ?? serverDay;
    if (draftDay.active) {
      payload.push({
        mealDate: dateKey,
        status: 'ACTIVE',
        mealChoice: draftDay.mealChoice,
      });
    } else if (serverDay.active) {
      payload.push({ mealDate: dateKey, status: 'CANCELLED' });
    }
  }
  return payload;
}

export function isDateSelectable(
  day: CalendarDayAvailability,
  nowAt: number,
): boolean {
  const cutoffAt = Date.parse(day.cutoffAt);
  return (
    day.canActivate &&
    day.menu !== null &&
    day.menu.isEnabled &&
    day.menu.menuRevisionId !== null &&
    !day.menu.isHoliday &&
    day.availableMealChoices.length > 0 &&
    Number.isFinite(cutoffAt) &&
    nowAt < cutoffAt
  );
}

export function isDateCancelable(
  day: CalendarDayAvailability,
  nowAt: number,
): boolean {
  const cutoffAt = Date.parse(day.cutoffAt);
  return day.canCancel && Number.isFinite(cutoffAt) && nowAt < cutoffAt;
}
export function isDateSelectAllEligible(
  serverDay: CalendarDayState | undefined,
  day: CalendarDayAvailability,
  nowAt: number,
): boolean {
  const menuIsPublished =
    day.menu !== null &&
    day.menu.isEnabled &&
    day.menu.menuRevisionId !== null &&
    !day.menu.isHoliday;
  return (
    menuIsPublished &&
    day.availableMealChoices.length > 0 &&
    (isDateSelectable(day, nowAt) ||
      (serverDay?.active === true && isDateCancelable(day, nowAt)))
  );
}

export function selectAllEligible(
  serverState: CalendarServerState,
  draftState: CalendarDraftState,
  availabilityByDate: Readonly<Record<string, CalendarDayAvailability>>,
  nowAt: number,
): CalendarDraftState {
  const next: Record<string, CalendarDayState> = { ...draftState };
  for (const dateKey of Object.keys(availabilityByDate).sort()) {
    const day = availabilityByDate[dateKey];
    if (!isDateSelectAllEligible(serverState[dateKey], day, nowAt)) continue;
    const current =
      next[dateKey] ?? serverState[dateKey] ?? inactiveCalendarDay;
    const preferredChoice = day.availableMealChoices.includes(
      current.mealChoice,
    )
      ? current.mealChoice
      : day.availableMealChoices.includes(REGULAR)
        ? REGULAR
        : day.availableMealChoices[0];
    if (!preferredChoice) continue;
    next[dateKey] = { active: true, mealChoice: preferredChoice };
  }
  return next;
}

export function reconcileBatchResults(
  serverState: CalendarServerState,
  draftState: CalendarDraftState,
  submittedDraft: CalendarDraftState,
  results: readonly CalendarBatchResult[],
): {
  serverState: CalendarServerState;
  draftState: CalendarDraftState;
  provisionalDates: string[];
} {
  const nextServer: Record<string, CalendarDayState> = { ...serverState };
  const nextDraft: Record<string, CalendarDayState> = { ...draftState };
  const provisionalDates: string[] = [];

  for (const result of results) {
    const submittedDay =
      submittedDraft[result.date] ??
      serverState[result.date] ??
      inactiveCalendarDay;
    if (!result.success) continue;
    nextServer[result.date] = { ...submittedDay };
    provisionalDates.push(result.date);
    if (sameCalendarDay(nextDraft[result.date], submittedDay)) {
      delete nextDraft[result.date];
    }
  }

  const resultDates = new Set(results.map((result) => result.date));
  for (const dateKey of Object.keys(submittedDraft)) {
    if (resultDates.has(dateKey)) continue;
    const submittedDay = submittedDraft[dateKey];
    if (!sameCalendarDay(serverState[dateKey], submittedDay)) {
      nextDraft[dateKey] = { ...submittedDay };
    }
  }

  return {
    serverState: nextServer,
    draftState: nextDraft,
    provisionalDates,
  };
}

export function mergeAuthoritativeWeek(
  authoritativeState: CalendarServerState,
  previousServerState: CalendarServerState,
  previousDraftState: CalendarDraftState,
): {
  serverState: CalendarServerState;
  draftState: CalendarDraftState;
} {
  const nextDraft: Record<string, CalendarDayState> = {
    ...createDraftState(authoritativeState),
  };
  for (const [dateKey, draftDay] of Object.entries(previousDraftState)) {
    const previousServerDay =
      previousServerState[dateKey] ?? inactiveCalendarDay;
    if (
      draftDay.active !== previousServerDay.active ||
      draftDay.mealChoice !== previousServerDay.mealChoice
    ) {
      nextDraft[dateKey] = { ...draftDay };
    }
  }
  return { serverState: authoritativeState, draftState: nextDraft };
}

export class CalendarBatchTracker {
  private saveRequestId = 0;
  private saveInFlight = false;
  private loadRequestId = 0;

  begin(): number | null {
    if (this.saveInFlight) return null;
    this.loadRequestId += 1;
    this.saveInFlight = true;
    this.saveRequestId += 1;
    return this.saveRequestId;
  }

  isCurrent(requestId: number): boolean {
    return this.saveInFlight && this.saveRequestId === requestId;
  }

  finish(requestId: number): boolean {
    if (!this.isCurrent(requestId)) return false;
    this.saveInFlight = false;
    return true;
  }

  beginLoad(): number {
    this.loadRequestId += 1;
    return this.loadRequestId;
  }

  isCurrentLoad(requestId: number): boolean {
    return this.loadRequestId === requestId;
  }
}
