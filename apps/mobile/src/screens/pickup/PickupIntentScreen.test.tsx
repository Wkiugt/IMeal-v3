import { describe, expect, it } from 'vitest';
import {
  getInitialSelection,
  isGpsRecoveryError,
  sortRegistrationIds,
} from './pickupIntentRules';
describe('PickupIntentScreen selection and recovery rules', () => {
  it('auto-selects one eligible item but leaves multiple items unselected', () => {
    expect(getInitialSelection(['registration-1'])).toEqual(['registration-1']);
    expect(getInitialSelection(['registration-2', 'registration-1'])).toEqual(
      [],
    );
  });

  it('sorts selected registration IDs before creating an exact intent', () => {
    expect(sortRegistrationIds(['registration-2', 'registration-1'])).toEqual([
      'registration-1',
      'registration-2',
    ]);
  });

  it.each([
    'GPS_RETRY_REQUIRED',
    'GPS_UNAVAILABLE',
    'GPS_STALE',
    'GPS_INACCURATE',
  ])('treats %s as Retry/Refresh-only recovery', (code) => {
    expect(isGpsRecoveryError({ code })).toBe(true);
  });
});
