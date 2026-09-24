import { describe, expect, it } from 'vitest';
import {
  canStartQrGeneration,
  getInitialSelection,
  getPresentableQrValue,
  getSelectionAfterEligibilityRefresh,
  isCurrentCapture,
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

  it('does not start generation until an explicit selection exists', () => {
    expect(canStartQrGeneration([])).toBe(false);
    expect(canStartQrGeneration(['registration-1'])).toBe(true);
  });

  it('does not let stale cleanup target a newer location capture', () => {
    const staleCapture = {};
    const currentCapture = {};
    expect(isCurrentCapture(currentCapture, staleCapture)).toBe(false);
    expect(isCurrentCapture(currentCapture, currentCapture)).toBe(true);
  });
  it('never presents a cleared QR while fresh evidence is pending', () => {
    expect(
      getPresentableQrValue(null, 'old-qr', 'registration-a', true, false),
    ).toBeNull();
  });

  it('does not auto-substitute a new sole option after A is removed', () => {
    const initialSelection = getSelectionAfterEligibilityRefresh(
      ['registration-a'],
      [],
      false,
    );
    const refreshedSelection = getSelectionAfterEligibilityRefresh(
      ['registration-b'],
      initialSelection,
      true,
    );

    expect(initialSelection).toEqual(['registration-a']);
    expect(refreshedSelection).toEqual([]);
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
