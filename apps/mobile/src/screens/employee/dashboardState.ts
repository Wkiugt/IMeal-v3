import type { v1 } from '@imeal/contracts';

export type HomeDay = Pick<
  v1.WeekRegistrationDay,
  'mealDate' | 'menu' | 'registration' | 'location'
>;

export type HomeLifecycle =
  | 'ACTIVE'
  | 'SERVED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'UNREGISTERED'
  | 'NO_MENU';

export type HomeProjection = {
  lifecycle: HomeLifecycle;
  menu: HomeDay['menu'];
  location: HomeDay['location'];
  registration: HomeDay['registration'];
  canOpenQr: boolean;
};

const COUNTED_REGISTRATION_STATUS: Record<
  Extract<v1.RegistrationRecordStatus, 'ACTIVE' | 'SERVED' | 'NO_SHOW'>,
  true
> = {
  ACTIVE: true,
  SERVED: true,
  NO_SHOW: true,
};

function hasPublishedMenu(day: HomeDay): boolean {
  return (
    day.menu !== null &&
    day.menu.isEnabled &&
    !day.menu.isHoliday &&
    day.menu.menuRevisionId !== null &&
    day.menu.mealName !== null
  );
}

export function projectHomeToday(day: HomeDay): HomeProjection {
  if (!hasPublishedMenu(day)) {
    return {
      lifecycle: 'NO_MENU',
      menu: null,
      location: day.location,
      registration: day.registration,
      canOpenQr: false,
    };
  }
  if (!day.registration) {
    return {
      lifecycle: 'UNREGISTERED',
      menu: day.menu,
      location: day.location,
      registration: null,
      canOpenQr: false,
    };
  }
  const lifecycle = day.registration.status;
  return {
    lifecycle,
    menu: day.menu,
    location: day.location,
    registration: day.registration,
    canOpenQr: lifecycle === 'ACTIVE',
  };
}

export function countHomeWeekRegistrations(
  days: readonly HomeDay[],
): number {
  let count = 0;
  for (const day of days) {
    const status = day.registration?.status;
    if (
      status &&
      status in COUNTED_REGISTRATION_STATUS
    ) {
      count += 1;
    }
  }
  return count;
}
