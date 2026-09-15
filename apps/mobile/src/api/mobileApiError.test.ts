import { describe, expect, it } from 'vitest';
import {
  MobileApiError,
  getMobileErrorMessage,
  mobileErrorMessageKey,
} from './mobileApiError';

const t = (key: string) => `translated:${key}`;

describe('MobileApiError', () => {
  it('maps known codes to localized message keys', () => {
    const error = new MobileApiError('PICKUP_SESSION_EXPIRED', mobileErrorMessageKey('PICKUP_SESSION_EXPIRED'));
    expect(error.code).toBe('PICKUP_SESSION_EXPIRED');
    expect(error.messageKey).toBe('errors.pickupSessionExpired');
    expect(getMobileErrorMessage(error, t, 'errors.requestFailed')).toBe(
      'translated:errors.pickupSessionExpired',
    );
  });

  it('uses the operation fallback for unknown failures while retaining the cause', () => {
    const cause = new Error('raw server detail');
    const error = new MobileApiError(
      'REQUEST_FAILED',
      mobileErrorMessageKey('REQUEST_FAILED'),
      cause,
    );
    expect(error.cause).toBe(cause);
    expect(getMobileErrorMessage(error, t, 'errors.loadCalendar')).toBe(
      'translated:errors.requestFailed',
    );
    expect(getMobileErrorMessage(new Error('raw server detail'), t, 'errors.loadCalendar')).toBe(
      'translated:errors.loadCalendar',
    );
  });
});
