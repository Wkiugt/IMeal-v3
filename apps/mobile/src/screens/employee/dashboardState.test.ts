import { describe, expect, it } from 'vitest';
import type { v1 } from '@imeal/contracts';
import {
  countHomeWeekRegistrations,
  projectHomeToday,
  type HomeDay,
} from './dashboardState';

const menu: v1.WeekDailyMenu = {
  id: 'menu-1',
  weeklyMenuId: 'week-1',
  date: '2026-09-30',
  isHoliday: false,
  isEnabled: true,
  menuRevisionId: 'revision-1',
  mealName: 'Cơm gà',
  description: 'Cơm hấp, đùi gà nướng',
  imageUrl: null,
  createdAt: '2026-09-29T00:00:00.000Z',
};

const location: v1.WeekDayLocation = {
  id: 'location-1',
  shortCode: 'MAIN',
  displayName: 'Căng tin chính',
  address: 'Địa chỉ kiểm thử',
  source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
};

function makeHomeDay(overrides: Partial<HomeDay> = {}): HomeDay {
  return {
    mealDate: '2026-09-30',
    menu,
    registration: null,
    location,
    ...overrides,
  };
}

function registration(
  status: v1.RegistrationRecord['status'],
  mealDate = '2026-09-30',
): v1.RegistrationRecord {
  return {
    id: `registration-${mealDate}`,
    mealDate,
    status,
    mealChoice: 'REGULAR',
    menuRevisionId: 'revision-1',
  };
}

describe('Home lifecycle projection', () => {
  it('uses the backend SERVED projection without inferring a client-side serving state', () => {
    const day = makeHomeDay({ registration: registration('SERVED') });

    expect(projectHomeToday(day)).toMatchObject({
      lifecycle: 'SERVED',
      canOpenQr: false,
      menu: day.menu,
      location: day.location,
    });
  });

  it.each([
    ['ACTIVE', true],
    ['SERVED', false],
    ['NO_SHOW', false],
    ['CANCELLED', false],
  ] as const)(
    'allows QR only for active registration with menu (%s)',
    (status, expected) => {
      expect(
        projectHomeToday(makeHomeDay({ registration: registration(status) }))
          .canOpenQr,
      ).toBe(expected);
    },
  );

  it('distinguishes unregistered and no-menu states', () => {
    expect(projectHomeToday(makeHomeDay({ registration: null })).lifecycle).toBe(
      'UNREGISTERED',
    );
    expect(
      projectHomeToday(makeHomeDay({ menu: null, registration: null })).lifecycle,
    ).toBe('NO_MENU');
  });

  it('does not expose QR when an active registration has no menu', () => {
    expect(
      projectHomeToday(
        makeHomeDay({ menu: null, registration: registration('ACTIVE') }),
      ),
    ).toMatchObject({ lifecycle: 'NO_MENU', canOpenQr: false });
  });
  it('treats an unpublished revision with null menu fields as unavailable', () => {
    const incompleteMenu = {
      ...menu,
      menuRevisionId: null,
      mealName: null,
      description: null,
    } satisfies v1.WeekDailyMenu;
    expect(
      projectHomeToday(
        makeHomeDay({
          menu: incompleteMenu,
          registration: registration('ACTIVE'),
        }),
      ),
    ).toMatchObject({ lifecycle: 'NO_MENU', canOpenQr: false, menu: null });
  });

  it('counts ACTIVE, SERVED, and NO_SHOW but not CANCELLED', () => {
    expect(
      countHomeWeekRegistrations([
        makeHomeDay({ mealDate: '2026-09-30', registration: registration('ACTIVE', '2026-09-30') }),
        makeHomeDay({ mealDate: '2026-10-01', registration: registration('SERVED', '2026-10-01') }),
        makeHomeDay({ mealDate: '2026-10-02', registration: registration('NO_SHOW', '2026-10-02') }),
        makeHomeDay({ mealDate: '2026-10-03', registration: registration('CANCELLED', '2026-10-03') }),
        makeHomeDay({ mealDate: '2026-10-04', registration: null }),
      ]),
    ).toBe(3);
  });
});
