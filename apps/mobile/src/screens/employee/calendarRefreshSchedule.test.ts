import { describe, expect, it } from 'vitest';
import {
  MAX_CALENDAR_REFRESH_DELAY_MS,
  getCalendarRefreshDelay,
  type CalendarRefreshDay,
} from './calendarRefreshSchedule';

const SERVER_NOW = Date.parse('2026-10-03T09:59:00.000Z');
const RECEIPT_AT = 1_000;
const NEXT_WEEK_OPEN_AT = '2026-10-03T10:00:00.000Z';

function makeDay(
  overrides: Partial<CalendarRefreshDay> = {},
): CalendarRefreshDay {
  return {
    cutoffAt: '2026-10-03T10:00:00.000Z',
    canActivate: false,
    canCancel: false,
    canChangeMealChoice: false,
    unavailableReasons: {
      activate: [],
      cancel: [],
      changeMealChoice: [],
    },
    ...overrides,
  };
}

function makeSnapshot(
  days: readonly CalendarRefreshDay[],
  nextWeekOpenAt = NEXT_WEEK_OPEN_AT,
  serverNowAt = SERVER_NOW,
) {
  return {
    serverNowAt,
    receiptAt: RECEIPT_AT,
    nextWeekOpenAt,
    days,
  };
}

describe('Calendar refresh scheduling', () => {
  it('schedules the next-week opening when the loaded week is not open yet', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot([
        makeDay({
          unavailableReasons: {
            activate: ['REGISTRATION_WEEK_NOT_OPEN'],
            cancel: [],
            changeMealChoice: [],
          },
        }),
      ]),
      RECEIPT_AT,
    );

    expect(delay).toBe(60_000);
  });

  it.each([60_000, 61_000])(
    'does not schedule an opening at or after the boundary (%d ms elapsed)',
    (elapsedAt) => {
      const delay = getCalendarRefreshDelay(
        makeSnapshot([
          makeDay({
            unavailableReasons: {
              activate: ['REGISTRATION_WEEK_NOT_OPEN'],
              cancel: [],
              changeMealChoice: [],
            },
          }),
        ]),
        RECEIPT_AT + elapsedAt,
      );

      expect(delay).toBeNull();
    },
  );

  it('does not use next-week opening for days outside the registration window', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot([
        makeDay({
          unavailableReasons: {
            activate: ['OUTSIDE_REGISTRATION_WINDOW'],
            cancel: [],
            changeMealChoice: [],
          },
        }),
      ]),
      RECEIPT_AT,
    );

    expect(delay).toBeNull();
  });

  it('selects an earlier actionable cutoff over the next-week opening', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot(
        [
          makeDay({
            cutoffAt: '2026-10-03T09:30:00.000Z',
            canActivate: true,
            unavailableReasons: {
              activate: [],
              cancel: [],
              changeMealChoice: [],
            },
          }),
          makeDay({
            unavailableReasons: {
              activate: ['REGISTRATION_WEEK_NOT_OPEN'],
              cancel: [],
              changeMealChoice: [],
            },
          }),
        ],
        '2026-10-03T10:00:00.000Z',
        Date.parse('2026-10-03T09:00:00.000Z'),
      ),
      RECEIPT_AT,
    );

    expect(delay).toBe(1_800_000);
  });

  it('selects an earlier next-week opening over a later actionable cutoff', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot(
        [
          makeDay({
            cutoffAt: '2026-10-03T11:00:00.000Z',
            canActivate: true,
          }),
          makeDay({
            unavailableReasons: {
              activate: ['REGISTRATION_WEEK_NOT_OPEN'],
              cancel: [],
              changeMealChoice: [],
            },
          }),
        ],
        '2026-10-03T10:00:00.000Z',
        Date.parse('2026-10-03T09:00:00.000Z'),
      ),
      RECEIPT_AT,
    );

    expect(delay).toBe(3_600_000);
  });

  it('returns no timer when there is no future candidate', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot(
        [
          makeDay({
            cutoffAt: '2026-10-03T09:58:00.000Z',
            canActivate: true,
          }),
        ],
        '2026-10-03T09:58:30.000Z',
        Date.parse('2026-10-03T09:59:00.000Z'),
      ),
      RECEIPT_AT,
    );

    expect(delay).toBeNull();
  });

  it('bounds delays to the JavaScript timer maximum', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot(
        [
          makeDay({
            canActivate: true,
            cutoffAt: '9999-12-31T23:59:59.999Z',
          }),
        ],
        '9999-12-31T23:59:59.999Z',
      ),
      RECEIPT_AT,
    );

    expect(delay).toBe(MAX_CALENDAR_REFRESH_DELAY_MS);
  });

  it('uses elapsed receipt time to estimate server time under device clock skew', () => {
    const delay = getCalendarRefreshDelay(
      makeSnapshot([
        makeDay({
          canActivate: true,
          cutoffAt: '2026-10-03T09:59:40.000Z',
        }),
      ]),
      RECEIPT_AT + 30_000,
    );

    expect(delay).toBe(10_000);
  });
});
