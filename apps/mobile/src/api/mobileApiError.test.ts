import { afterEach, describe, expect, it } from 'vitest';
import { registerAuthInvalidationHandler } from '../auth/authInvalidation';
import {
  MobileApiError,
  getMobileErrorMessage,
  mobileErrorMessageKey,
  toMobileApiError,
  throwMobileResponseError,
} from './mobileApiError';
import { en, i18n, translate, vi } from '../i18n/translations';

const t = (key: string) => `translated:${key}`;
let unregisterHandler: (() => void) | null = null;
afterEach(() => {
  unregisterHandler?.();
  unregisterHandler = null;
});

describe('MobileApiError', () => {
  it('maps known codes to localized message keys', () => {
    const error = new MobileApiError(
      'PICKUP_SESSION_EXPIRED',
      mobileErrorMessageKey('PICKUP_SESSION_EXPIRED'),
    );
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
    expect(
      getMobileErrorMessage(
        new Error('raw server detail'),
        t,
        'errors.loadCalendar',
      ),
    ).toBe('translated:errors.loadCalendar');
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
    const response = new Response(
      JSON.stringify({ code: 'SERVER_MAINTENANCE', message: 'raw detail' }),
      { status: 503 },
    );
    await expect(
      throwMobileResponseError(response, 'errors.loadKitchen'),
    ).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      messageKey: 'errors.loadKitchen',
      cause: { code: 'SERVER_MAINTENANCE', message: 'raw detail' },
    });
  });

  it('extracts typed codes wrapped in Nest message fields', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 400,
        message: 'PICKUP_NOT_READY',
        error: 'Bad Request',
      }),
      { status: 400 },
    );
    await expect(
      throwMobileResponseError(response, 'errors.loadPickup'),
    ).rejects.toMatchObject({
      code: 'PICKUP_NOT_READY',
      messageKey: 'errors.pickupNotReady',
    });
  });
});

it('notifies the mounted session provider only for a protected 401 SESSION_INVALID response', async () => {
  const offendingTokens: string[] = [];
  unregisterHandler = registerAuthInvalidationHandler((token) =>
    offendingTokens.push(token),
  );

  const response = new Response(
    JSON.stringify({
      error: {
        code: 'SESSION_INVALID',
        message: 'Invalid or expired session.',
      },
    }),
    { status: 401 },
  );
  await expect(
    throwMobileResponseError(response, 'errors.loadCalendar', {
      token: 'expired-token',
    }),
  ).rejects.toMatchObject({ code: 'SESSION_INVALID' });

  expect(offendingTokens).toEqual(['expired-token']);
});

it('does not clear auth for OTP errors or plain unauthorized responses', async () => {
  const offendingTokens: string[] = [];
  unregisterHandler = registerAuthInvalidationHandler((token) =>
    offendingTokens.push(token),
  );

  const otpResponse = new Response(
    JSON.stringify({
      error: { code: 'OTP_INVALID_OR_EXPIRED', message: 'Invalid code.' },
    }),
    { status: 401 },
  );
  await expect(
    throwMobileResponseError(otpResponse, 'errors.verifyOtp'),
  ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });

  const unauthorizedResponse = new Response(
    JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized.' },
    }),
    { status: 401 },
  );
  await expect(
    throwMobileResponseError(unauthorizedResponse, 'errors.loadCalendar', {
      token: 'expired-token',
    }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

  expect(offendingTokens).toEqual([]);
});
it.each([
  ['vi', 'REGISTRATION_WEEK_NOT_OPEN', 'errors.registrationWeekNotOpen'],
  ['vi', 'OUTSIDE_REGISTRATION_WINDOW', 'errors.outsideRegistrationWindow'],
  ['en', 'REGISTRATION_WEEK_NOT_OPEN', 'errors.registrationWeekNotOpen'],
  ['en', 'OUTSIDE_REGISTRATION_WINDOW', 'errors.outsideRegistrationWindow'],
] as const)(
  'parses %s registration code %s and selects its localized message',
  async (locale, code, messageKey) => {
    const previousLocale = i18n.locale;
    try {
      const response = new Response(
        JSON.stringify({
          error: { code, message: 'server weekly restriction' },
        }),
        { status: 400 },
      );
      let caught: unknown;
      try {
        await throwMobileResponseError(response, 'errors.requestFailed');
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MobileApiError);
      if (!(caught instanceof MobileApiError)) {
        throw new Error('Expected a typed mobile API error');
      }
      const mobileError = caught;
      expect(mobileError.code).toBe(code);
      expect(mobileError.messageKey).toBe(messageKey);
      expect(mobileError.cause).toEqual({
        error: { code, message: 'server weekly restriction' },
      });

      i18n.locale = locale;
      const localizedMessage = getMobileErrorMessage(
        mobileError,
        translate,
        'errors.requestFailed',
      );
      const dictionary = locale === 'vi' ? vi : en;
      expect(localizedMessage).toBe(dictionary[messageKey]);
      expect(localizedMessage).not.toBe(translate('errors.cutoffPassed'));
    } finally {
      i18n.locale = previousLocale;
    }
  },
);
