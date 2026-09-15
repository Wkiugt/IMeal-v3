import { describe, expect, it } from 'vitest';
import {
  MobileApiError,
  getMobileErrorMessage,
  mobileErrorMessageKey,
  toMobileApiError,
  throwMobileResponseError,
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

  it('uses the operation fallback key for unknown transport failures', () => {
    const cause = new Error('network down');
    const error = toMobileApiError(cause, 'errors.loadCalendar');
    expect(error.code).toBe('REQUEST_FAILED');
    expect(error.messageKey).toBe('errors.loadCalendar');
    expect(error.cause).toBe(cause);
    expect(getMobileErrorMessage(error, t, 'errors.requestFailed')).toBe(
      'translated:errors.loadCalendar',
    );
  });

  it('uses the operation fallback key for unknown HTTP failures', async () => {
    const response = new Response(JSON.stringify({ code: 'SERVER_MAINTENANCE', message: 'raw detail' }), { status: 503 });
    await expect(throwMobileResponseError(response, 'errors.loadKitchen')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      messageKey: 'errors.loadKitchen',
      cause: { code: 'SERVER_MAINTENANCE', message: 'raw detail' },
    });
  });
});
