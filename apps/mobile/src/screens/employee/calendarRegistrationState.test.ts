import { describe, expect, it } from 'vitest';
import type { v1 } from '@imeal/contracts';
import {
  CalendarMutationTracker,
  createWeekState,
  getAvailableChoices,
  getMutationPayload,
  reconcileWeekState,
  type DraftChoiceByDate,
  type WeekState,
} from './calendarRegistrationState';

const weekStart = new Date(2026, 8, 21);
const registrationWindow = {
  serverNow: '2026-09-20T04:00:00.000Z',
  cutoffAt: '2026-09-24T07:00:00.000Z',
  timeZone: 'Asia/Ho_Chi_Minh' as const,
  days: [
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
  ].map((mealDate) => ({
    mealDate,
    cutoffAt: '2026-09-24T07:00:00.000Z',
    editable: true,
    lunarDate: { day: mealDate === '2026-09-25' ? 15 : 16, month: 8, year: 2026, isLeapMonth: false },
    availableMealChoices: (mealDate === '2026-09-25' ? ['REGULAR', 'VEGETARIAN'] : ['REGULAR']) as v1.MealChoice[],
  })),
};

const response = {
  menu: null,
  registrations: [
    { id: 'active-1', mealDate: '2026-09-25', status: 'ACTIVE', mealChoice: 'VEGETARIAN' },
    { id: 'cancelled-1', mealDate: '2026-09-24', status: 'CANCELLED', mealChoice: 'REGULAR' },
  ],
  registrationWindow,
} satisfies v1.WeekRegistrationResponse;

describe('calendar registration state', () => {
  it('hydrates active status and meal choice while defaulting missing dates to regular', () => {
    expect(createWeekState(response.registrations, weekStart)).toEqual({
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
      '2026-09-22': { active: false, mealChoice: 'REGULAR' },
      '2026-09-23': { active: false, mealChoice: 'REGULAR' },
      '2026-09-24': { active: false, mealChoice: 'REGULAR' },
      '2026-09-25': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-26': { active: false, mealChoice: 'REGULAR' },
      '2026-09-27': { active: false, mealChoice: 'REGULAR' },
    });
  });

  it('keeps an off-day draft only while the server still offers that choice', () => {
    const serverState = createWeekState(response.registrations, weekStart);
    const responseWithOffDayChoice = {
      ...response,
      registrationWindow: {
        ...response.registrationWindow,
        days: response.registrationWindow.days.map((day) =>
          day.mealDate === '2026-09-24'
            ? { ...day, availableMealChoices: ['REGULAR', 'VEGETARIAN'] as v1.MealChoice[] }
            : day,
        ),
      },
    } as v1.WeekRegistrationResponse;
    const drafts: DraftChoiceByDate = {
      '2026-09-23': 'VEGETARIAN',
      '2026-09-24': 'VEGETARIAN',
      '2026-09-25': 'VEGETARIAN',
    };

    const reconciled = reconcileWeekState(serverState, drafts, responseWithOffDayChoice, weekStart);

    expect(reconciled.draftChoiceByDate).toEqual({ '2026-09-24': 'VEGETARIAN' });
    expect(reconciled.weekState['2026-09-23']).toEqual({ active: false, mealChoice: 'REGULAR' });
    expect(reconciled.weekState['2026-09-24']).toEqual({ active: false, mealChoice: 'REGULAR' });
    expect(reconciled.weekState['2026-09-25']).toEqual({ active: true, mealChoice: 'VEGETARIAN' });
  });

  it('changes an off-day draft without mutating server registration state', () => {
    const current: WeekState = {
      '2026-09-25': { active: false, mealChoice: 'REGULAR' },
    };
    const drafts: DraftChoiceByDate = {};

    expect(getAvailableChoices(response, '2026-09-25')).toEqual(['REGULAR', 'VEGETARIAN']);
    expect(getMutationPayload('2026-09-25', current, drafts, false)).toEqual({
      mealDate: '2026-09-25',
      status: 'CANCELLED',
    });
    expect(getMutationPayload('2026-09-25', current, { '2026-09-25': 'VEGETARIAN' }, true)).toEqual({
      mealDate: '2026-09-25',
      status: 'ACTIVE',
      mealChoice: 'VEGETARIAN',
    });
  });

  it('produces a cancellation payload without a meal choice', () => {
    const current: WeekState = { '2026-09-25': { active: true, mealChoice: 'VEGETARIAN' } };
    const payload = getMutationPayload('2026-09-25', current, {}, false);

    expect(payload).toEqual({ mealDate: '2026-09-25', status: 'CANCELLED' });
    expect('mealChoice' in payload).toBe(false);
  });
  it('allows one in-flight mutation per date and rejects stale responses', () => {
    const tracker = new CalendarMutationTracker();
    const first = tracker.begin('2026-09-25');

    expect(first).toBe(1);
    expect(tracker.begin('2026-09-25')).toBeNull();
    expect(tracker.isCurrent('2026-09-25', first as number)).toBe(true);
    expect(tracker.finish('2026-09-25', first as number)).toBe(true);

    const second = tracker.begin('2026-09-25');
    expect(second).toBe(2);
    expect(tracker.isCurrent('2026-09-25', first as number)).toBe(false);
    expect(tracker.isCurrent('2026-09-25', second as number)).toBe(true);
  });
});
