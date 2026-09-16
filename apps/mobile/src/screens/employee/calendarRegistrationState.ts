import type { v1 } from '@imeal/contracts';
import { addDays, toDateKey } from '../../businessDate';

export type MealChoice = v1.MealChoice;
export type WeekState = Record<string, { active: boolean; mealChoice: MealChoice }>;
export type DraftChoiceByDate = Record<string, MealChoice>;

const REGULAR: MealChoice = 'REGULAR';

export function createWeekState(
  registrations: readonly v1.RegistrationRecord[],
  weekStart: Date,
): WeekState {
  const next: WeekState = {};
  for (let index = 0; index < 7; index += 1) {
    const dateKey = toDateKey(addDays(weekStart, index));
    const registration = registrations.find((candidate) => candidate.mealDate === dateKey);
    next[dateKey] = {
      active: registration?.status === 'ACTIVE',
      mealChoice: registration?.mealChoice ?? REGULAR,
    };
  }
  return next;
}

export function getAvailableChoices(
  response: Pick<v1.WeekRegistrationResponse, 'registrationWindow'>,
  dateKey: string,
): readonly MealChoice[] {
  return response.registrationWindow.days.find((day) => day.mealDate === dateKey)?.availableMealChoices ?? [REGULAR];
}

export function reconcileWeekState(
  serverState: WeekState,
  drafts: DraftChoiceByDate,
  response: v1.WeekRegistrationResponse,
  weekStart: Date,
): { weekState: WeekState; draftChoiceByDate: DraftChoiceByDate } {
  const next: WeekState = {};
  const nextDrafts: DraftChoiceByDate = {};

  for (let index = 0; index < 7; index += 1) {
    const dateKey = toDateKey(addDays(weekStart, index));
    const registration = response.registrations.find((candidate) => candidate.mealDate === dateKey);
    const available = getAvailableChoices(response, dateKey);
    if (registration?.status === 'ACTIVE') {
      next[dateKey] = {
        active: true,
        mealChoice: registration.mealChoice ?? REGULAR,
      };
      continue;
    }

    const draft = drafts[dateKey];
    if (draft && available.includes(draft)) nextDrafts[dateKey] = draft;
    next[dateKey] = {
      active: false,
      mealChoice: REGULAR,
    };
  }

  return { weekState: { ...serverState, ...next }, draftChoiceByDate: nextDrafts };
}

export function getMutationPayload(
  dateKey: string,
  weekState: WeekState,
  drafts: DraftChoiceByDate,
  active: boolean,
): v1.BatchRegistrationItem {
  if (!active) return { mealDate: dateKey, status: 'CANCELLED' };
  return {
    mealDate: dateKey,
    status: 'ACTIVE',
    mealChoice: drafts[dateKey] ?? weekState[dateKey]?.mealChoice ?? REGULAR,
  };
}

export class CalendarMutationTracker {
  private readonly requestIds: Record<string, number> = {};
  private readonly inFlight = new Set<string>();

  begin(dateKey: string): number | null {
    if (this.inFlight.has(dateKey)) return null;
    const requestId = (this.requestIds[dateKey] ?? 0) + 1;
    this.requestIds[dateKey] = requestId;
    this.inFlight.add(dateKey);
    return requestId;
  }

  isCurrent(dateKey: string, requestId: number): boolean {
    return this.requestIds[dateKey] === requestId;
  }

  latestRequestId(dateKey: string): number {
    return this.requestIds[dateKey] ?? 0;
  }

  finish(dateKey: string, requestId: number): boolean {
    if (!this.isCurrent(dateKey, requestId)) return false;
    this.inFlight.delete(dateKey);
    return true;
  }

  isInFlight(dateKey: string): boolean {
    return this.inFlight.has(dateKey);
  }

  snapshotRequestIds(): Readonly<Record<string, number>> {
    return { ...this.requestIds };
  }

  snapshotInFlight(): ReadonlySet<string> {
    return new Set(this.inFlight);
  }
}
