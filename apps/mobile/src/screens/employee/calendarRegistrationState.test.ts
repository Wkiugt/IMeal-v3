import { describe, expect, it } from 'vitest';
import type { v1 } from '@imeal/contracts';
import {
  CalendarBatchTracker,
  buildDirtyBatchPayload,
  createDraftState,
  getDirtyDates,
  getDirtyDatesForWeek,
  isDateCancelable,
  isDateSelectable,
  mergeAuthoritativeWeek,
  reconcileBatchResults,
  selectAllEligible,
  setDraftDay,
  type CalendarDayAvailability,
  type CalendarServerState,
  type CalendarDraftState,
} from './calendarRegistrationState';

const calendarMenu: v1.WeekDailyMenu = {
  id: 'menu-1',
  weeklyMenuId: 'week-1',
  date: '2026-09-21',
  isHoliday: false,
  isEnabled: true,
  menuRevisionId: 'revision-1',
  mealName: 'Cơm gà',
  description: 'Cơm hấp',
  imageUrl: null,
  createdAt: '2026-09-19T00:00:00.000Z',
};
const calendarLocation: v1.WeekDayLocation = {
  id: 'location-1',
  shortCode: 'MAIN',
  displayName: 'Căng tin chính',
  address: 'Địa chỉ kiểm thử',
  source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
};
function makeCalendarDayAvailability(
  overrides: Partial<CalendarDayAvailability> = {},
): CalendarDayAvailability {
  return {
    cutoffAt: '2026-09-21T00:00:00.000Z',
    availableMealChoices: ['REGULAR'],
    canActivate: true,
    canCancel: true,
    canChangeMealChoice: true,
    menu: calendarMenu,
    location: calendarLocation,
    unavailableReasons: { activate: [], cancel: [], changeMealChoice: [] },
    ...overrides,
  };
}

describe('calendar draft batch behavior', () => {
  it('updates local draft state without mutating server state', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    };
    const draft = createDraftState(server);
    const nextDraft = setDraftDay(draft, '2026-09-21', {
      active: true,
      mealChoice: 'VEGETARIAN',
    });

    expect(server['2026-09-21']).toEqual({
      active: false,
      mealChoice: 'REGULAR',
    });
    expect(nextDraft['2026-09-21']).toEqual({
      active: true,
      mealChoice: 'VEGETARIAN',
    });
  });

  it('only returns active or active-choice differences as dirty dates', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
      '2026-09-22': { active: true, mealChoice: 'REGULAR' },
    };
    const draft: CalendarDraftState = {
      ...server,
      '2026-09-21': { active: false, mealChoice: 'VEGETARIAN' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
    };

    expect(getDirtyDates(server, draft)).toEqual(['2026-09-22']);
  });
  it('limits a dirty batch to the currently loaded week', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
      '2026-09-28': { active: false, mealChoice: 'REGULAR' },
    };
    const draft: CalendarDraftState = {
      ...server,
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-28': { active: true, mealChoice: 'REGULAR' },
    };
    expect(getDirtyDatesForWeek(server, draft, ['2026-09-28'])).toEqual([
      '2026-09-28',
    ]);
    expect(
      buildDirtyBatchPayload(
        server,
        draft,
        getDirtyDatesForWeek(server, draft, ['2026-09-28']),
      ),
    ).toEqual([
      { mealDate: '2026-09-28', status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
  });

  it('does not emit cancellation for an absent inactive date', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    };
    const draft: CalendarDraftState = {
      '2026-09-21': { active: false, mealChoice: 'VEGETARIAN' },
    };
    const dirtyDates = getDirtyDates(server, draft);

    expect(dirtyDates).toEqual([]);
    expect(buildDirtyBatchPayload(server, draft, dirtyDates)).toEqual([]);
  });

  it('emits activation choice and cancellation only for truly dirty dates', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
    };
    const draft: CalendarDraftState = {
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-22': { active: false, mealChoice: 'VEGETARIAN' },
    };

    expect(
      buildDirtyBatchPayload(server, draft, getDirtyDates(server, draft)),
    ).toEqual([
      { mealDate: '2026-09-21', status: 'ACTIVE', mealChoice: 'REGULAR' },
      { mealDate: '2026-09-22', status: 'CANCELLED' },
    ]);
  });

  it('selects eligible dates, preserves vegetarian choices, and estimates cutoff', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-22': { active: false, mealChoice: 'REGULAR' },
      '2026-09-23': { active: false, mealChoice: 'REGULAR' },
      '2026-09-24': { active: false, mealChoice: 'REGULAR' },
    };
    const draft: CalendarDraftState = {
      ...server,
      '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-22': { active: false, mealChoice: 'VEGETARIAN' },
    };
    const nowAt = Date.parse('2026-09-20T00:00:00.000Z');
    const availability: Record<string, CalendarDayAvailability> = {
      '2026-09-21': makeCalendarDayAvailability({
        availableMealChoices: ['REGULAR', 'VEGETARIAN'],
        canActivate: false,
      }),
      '2026-09-22': makeCalendarDayAvailability({
        availableMealChoices: ['REGULAR', 'VEGETARIAN'],
        cutoffAt: '2026-09-21T00:00:00.000Z',
      }),
      '2026-09-23': makeCalendarDayAvailability({
        menu: null,
        canActivate: false,
        unavailableReasons: {
          activate: ['NO_PUBLISHED_MENU'],
          cancel: [],
          changeMealChoice: ['NO_PUBLISHED_MENU'],
        },
      }),
      '2026-09-24': makeCalendarDayAvailability({
        location: null,
        canActivate: false,
        unavailableReasons: {
          activate: ['LOCATION_UNAVAILABLE'],
          cancel: [],
          changeMealChoice: ['LOCATION_UNAVAILABLE'],
        },
      }),
    };
    expect(isDateSelectable(availability['2026-09-23'], nowAt)).toBe(false);
    expect(isDateSelectable(availability['2026-09-24'], nowAt)).toBe(false);
    expect(
      isDateCancelable(
        makeCalendarDayAvailability({ menu: null, canCancel: true }),
        nowAt,
      ),
    ).toBe(true);
    expect(
      isDateSelectable(
        makeCalendarDayAvailability({ location: null, canActivate: true }),
        nowAt,
      ),
    ).toBe(true);

    expect(isDateSelectable(availability['2026-09-22'], nowAt)).toBe(true);
    expect(
      isDateSelectable(
        availability['2026-09-22'],
        Date.parse('2026-09-21T00:00:00.000Z'),
      ),
    ).toBe(false);
    expect(selectAllEligible(server, draft, availability, nowAt)).toEqual({
      ...draft,
      '2026-09-21': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-23': { active: false, mealChoice: 'REGULAR' },
      '2026-09-24': { active: false, mealChoice: 'REGULAR' },
    });
    expect(
      selectAllEligible(
        server,
        {
          ...draft,
          '2026-09-21': { active: false, mealChoice: 'VEGETARIAN' },
        },
        availability,
        nowAt,
      )['2026-09-21'],
    ).toEqual({ active: true, mealChoice: 'VEGETARIAN' });
  });
  it('allows local activate/cancel undo in either direction', () => {
    const inactiveServer: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
    };
    const activatedDraft = setDraftDay(inactiveServer, '2026-09-21', {
      active: true,
      mealChoice: 'REGULAR',
    });
    const restoredInactiveDraft = setDraftDay(activatedDraft, '2026-09-21', {
      active: false,
      mealChoice: 'REGULAR',
    });
    expect(getDirtyDates(inactiveServer, restoredInactiveDraft)).toEqual([]);

    const activeServer: CalendarServerState = {
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
    };
    const cancelledDraft = setDraftDay(activeServer, '2026-09-22', {
      active: false,
      mealChoice: 'VEGETARIAN',
    });
    const restoredActiveDraft = setDraftDay(cancelledDraft, '2026-09-22', {
      active: true,
      mealChoice: 'VEGETARIAN',
    });
    expect(getDirtyDates(activeServer, restoredActiveDraft)).toEqual([]);
  });

  it('commits successful dates but retains the failed draft', () => {
    const server: CalendarServerState = {
      '2026-09-21': { active: false, mealChoice: 'REGULAR' },
      '2026-09-22': { active: false, mealChoice: 'REGULAR' },
      '2026-09-23': { active: false, mealChoice: 'REGULAR' },
    };
    const draft: CalendarDraftState = {
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-23': { active: true, mealChoice: 'REGULAR' },
    };
    const result = reconcileBatchResults(server, draft, draft, [
      { date: '2026-09-21', success: true },
      { date: '2026-09-22', success: true },
      {
        date: '2026-09-23',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'locked',
      },
    ]);

    expect(result.serverState).toMatchObject({
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
    });
    expect(result.draftState['2026-09-23']).toEqual({
      active: true,
      mealChoice: 'REGULAR',
    });
    expect(result.provisionalDates).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('merges authoritative refreshes without losing failed drafts or successes', () => {
    const afterBatchServer: CalendarServerState = {
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-22': { active: true, mealChoice: 'VEGETARIAN' },
      '2026-09-23': { active: true, mealChoice: 'VEGETARIAN' },
    };
    const afterBatchDraft: CalendarDraftState = {
      '2026-09-23': { active: false, mealChoice: 'VEGETARIAN' },
    };
    const authoritative: CalendarServerState = {
      '2026-09-21': { active: true, mealChoice: 'REGULAR' },
      '2026-09-22': { active: false, mealChoice: 'REGULAR' },
      '2026-09-23': { active: true, mealChoice: 'REGULAR' },
    };

    const merged = mergeAuthoritativeWeek(
      authoritative,
      afterBatchServer,
      afterBatchDraft,
    );

    expect(merged.serverState).toEqual(authoritative);
    expect(merged.draftState['2026-09-23']).toEqual({
      active: false,
      mealChoice: 'VEGETARIAN',
    });
    expect(getDirtyDates(merged.serverState, merged.draftState)).toEqual([
      '2026-09-23',
    ]);
    expect(merged.draftState['2026-09-22']).toEqual({
      active: false,
      mealChoice: 'REGULAR',
    });
  });

  it('allows one batch save and rejects duplicate or stale completions', () => {
    const tracker = new CalendarBatchTracker();
    const request = tracker.begin();

    expect(request).not.toBeNull();
    if (request === null) throw new Error('expected a batch request');
    expect(tracker.begin()).toBeNull();
    expect(tracker.isCurrent(request)).toBe(true);
    expect(tracker.finish(request)).toBe(true);
    expect(tracker.finish(request)).toBe(false);
  });

  it('rejects stale GET completion after a newer load starts', () => {
    const tracker = new CalendarBatchTracker();
    const first = tracker.beginLoad();
    const second = tracker.beginLoad();

    expect(tracker.isCurrentLoad(first)).toBe(false);
    expect(tracker.isCurrentLoad(second)).toBe(true);
  });
  it('invalidates an in-flight GET when a batch save begins', () => {
    const tracker = new CalendarBatchTracker();
    const load = tracker.beginLoad();
    const save = tracker.begin();

    expect(save).not.toBeNull();
    expect(tracker.isCurrentLoad(load)).toBe(false);
  });
});
