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
      'GPS_STALE',
      mobileErrorMessageKey('GPS_STALE'),
    );
    expect(error.code).toBe('GPS_STALE');
    expect(error.messageKey).toBe('errors.gpsStale');
    expect(getMobileErrorMessage(error, t, 'errors.requestFailed')).toBe(
      'translated:errors.gpsStale',
    );
  });

  it('presents required domain error messages without backend details', () => {
    const otpExpired = new MobileApiError(
      'OTP_EXPIRED',
      mobileErrorMessageKey('OTP_EXPIRED'),
    );
    const sessionInvalid = new MobileApiError(
      'SESSION_INVALID',
      mobileErrorMessageKey('SESSION_INVALID'),
    );

    expect(
      getMobileErrorMessage(otpExpired, translate, 'errors.requestFailed'),
    ).toBe('Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.');
    expect(
      getMobileErrorMessage(sessionInvalid, translate, 'errors.requestFailed'),
    ).toBe('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  });
  it('prioritizes a recognized domain code when the response has no request id', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 400,
        errorCode: 'OTP_EXPIRED',
        message: 'technical backend detail',
      }),
      { status: 400 },
    );

    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.requestOtp');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    expect(caught.code).toBe('OTP_EXPIRED');
    expect(
      getMobileErrorMessage(caught, translate, 'errors.requestOtp'),
    ).toBe('Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.');
  });

  it.each([
    [400, 'Không thể kết nối dịch vụ. Hãy kiểm tra kết nối và thử lại.'],
    [404, 'Không thể kết nối dịch vụ. Hãy kiểm tra kết nối và thử lại.'],
  ] as const)(
    'uses a safe generic message for HTTP %s errors',
    (status, message) => {
      const error = new MobileApiError(
        'REQUEST_FAILED',
        'errors.requestFailed',
        undefined,
        { statusCode: status },
      );

      expect(
        getMobileErrorMessage(error, translate, 'errors.loadCalendar'),
      ).toBe(message);
    },
  );

  it.each([
    [429, 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.'],
    [500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.'],
    [503, 'Dịch vụ hiện đang tạm thời gián đoạn. Vui lòng thử lại sau.'],
  ] as const)(
    'uses the safe fallback message for HTTP %s errors',
    (status, message) => {
      const error = new MobileApiError(
        'REQUEST_FAILED',
        'errors.requestFailed',
        undefined,
        { statusCode: status },
      );

      expect(
        getMobileErrorMessage(error, translate, 'errors.loadCalendar'),
      ).toContain(message);
    },
  );
  const HTTP_ERROR_MATRIX = [
    { status: 400, errorCode: 'BAD_REQUEST', messageKey: 'errors.badRequest' },
    {
      status: 401,
      errorCode: 'UNAUTHORIZED',
      messageKey: 'errors.sessionInvalid',
    },
    { status: 403, errorCode: 'FORBIDDEN', messageKey: 'errors.forbidden' },
    { status: 404, errorCode: 'NOT_FOUND', messageKey: 'errors.notFound' },
    {
      status: 405,
      errorCode: 'METHOD_NOT_ALLOWED',
      messageKey: 'errors.methodNotAllowed',
    },
    {
      status: 408,
      errorCode: 'REQUEST_TIMEOUT',
      messageKey: 'errors.requestTimeout',
    },
    {
      status: 409,
      errorCode: 'CONFLICT',
      messageKey: 'errors.conflict',
    },
    {
      status: 410,
      errorCode: 'GONE',
      messageKey: 'errors.gone',
    },
    {
      status: 413,
      errorCode: 'PAYLOAD_TOO_LARGE',
      messageKey: 'errors.payloadTooLarge',
    },
    {
      status: 415,
      errorCode: 'UNSUPPORTED_MEDIA_TYPE',
      messageKey: 'errors.unsupportedMediaType',
    },
    {
      status: 422,
      errorCode: 'UNPROCESSABLE_ENTITY',
      messageKey: 'errors.unprocessableEntity',
    },
    { status: 429, errorCode: 'RATE_LIMITED', messageKey: 'errors.rateLimited' },
    {
      status: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      messageKey: 'errors.internalServerError',
    },
    {
      status: 501,
      errorCode: 'NOT_IMPLEMENTED',
      messageKey: 'errors.notImplemented',
    },
    {
      status: 502,
      errorCode: 'BAD_GATEWAY',
      messageKey: 'errors.badGateway',
    },
    {
      status: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      messageKey: 'errors.serviceUnavailable',
    },
    {
      status: 504,
      errorCode: 'GATEWAY_TIMEOUT',
      messageKey: 'errors.gatewayTimeout',
    },
  ] as const;

  it('maps every supported HTTP status to the exact safe translation key', async () => {
    for (const { status, messageKey } of HTTP_ERROR_MATRIX) {
      const response = new Response(
        JSON.stringify({
          statusCode: status,
          message: `private server diagnostic for ${status}`,
        }),
        { status },
      );

      let caught: unknown;
      try {
        await throwMobileResponseError(response, 'errors.loadCalendar');
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MobileApiError);
      if (!(caught instanceof MobileApiError)) continue;
      expect(caught.messageKey).toBe(messageKey);
    }
  });

  it.each(HTTP_ERROR_MATRIX)(
    'preserves the safe HTTP envelope and presentation for $status',
    async ({ status, errorCode, messageKey }) => {
      const requestId = '550e8400-e29b-41d4-a716-446655440099';
      const internalDetails = `internal-${status} postgresql://user:secret@db.internal`;
      const response = new Response(
        JSON.stringify({
          statusCode: status,
          errorCode,
          message: internalDetails,
          requestId,
        }),
        { status },
      );

      let caught: unknown;
      try {
        await throwMobileResponseError(response, 'errors.loadCalendar');
      } catch (error: unknown) {
        caught = error;
      }

      expect(response.status).toBe(status);
      expect(caught).toBeInstanceOf(MobileApiError);
      if (!(caught instanceof MobileApiError)) return;

      expect(caught).toMatchObject({
        code: errorCode,
        statusCode: status,
        requestId,
      });
      const message = getMobileErrorMessage(
        caught,
        t,
        'errors.loadCalendar',
      );
      expect(message).toContain(`translated:${messageKey}`);
      expect(message).not.toContain(internalDetails);
      expect(message).not.toContain('postgresql://');
    },
  );

  it.each([
    [418, { statusCode: 418, errorCode: 'UNKNOWN_CLIENT_ERROR' }],
    [400, { statusCode: 'not-a-status', errorCode: 'BAD_REQUEST' }],
    [423, null],
    [499, 'malformed payload'],
  ] as const)('uses safe fallbacks for unknown statuses', async (status, payload) => {
    const response = new Response(JSON.stringify(payload), { status });

    await expect(
      throwMobileResponseError(response, 'errors.loadCalendar'),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      messageKey: 'errors.badRequest',
    });
  });

  it('uses an internal-server fallback for unknown 5xx statuses', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 599,
        errorCode: 'UNKNOWN_SERVER_ERROR',
        message: 'private stack trace',
      }),
      { status: 599 },
    );

    await expect(
      throwMobileResponseError(response, 'errors.requestFailed'),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      messageKey: 'errors.internalServerError',
    });
  });

  it('payload errorCode overrides HTTP status', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 400,
        errorCode: 'NOT_FOUND',
        message: 'private detail',
      }),
      { status: 400 },
    );

    await expect(
      throwMobileResponseError(response, 'errors.requestFailed'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
    });
  });

  it('maps SESSION_INVALID to the session message', () => {
    const error = new MobileApiError(
      'SESSION_INVALID',
      mobileErrorMessageKey('SESSION_INVALID'),
    );

    expect(getMobileErrorMessage(error, translate, 'errors.requestFailed')).toBe(
      'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    );
  });

  it('keeps server diagnostics out of presentation text', async () => {
    const diagnostic =
      'NestJS Prisma PostgreSQL stack trace password=secret at /srv/api';
    const response = new Response(
      JSON.stringify({
        statusCode: 500,
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: diagnostic,
      }),
      { status: 500 },
    );

    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.requestFailed');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    const presentation = getMobileErrorMessage(
      caught,
      translate,
      'errors.requestFailed',
    );
    expect(presentation).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
    expect(presentation).not.toContain(diagnostic);
    expect(presentation).not.toContain('PostgreSQL');
  });

  it('falls back to BAD_REQUEST for an unknown 4xx error code', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 418,
        errorCode: 'UNKNOWN_CLIENT_ERROR',
        message: 'technical client detail',
        requestId: '550e8400-e29b-41d4-a716-446655440097',
      }),
      { status: 418 },
    );

    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.requestFailed');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    expect(getMobileErrorMessage(caught, translate, 'errors.requestFailed')).toBe(
      'Yêu cầu không hợp lệ. Vui lòng kiểm tra và thử lại.',
    );
  });
  it('uses system-failure copy for an unknown 5xx response', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 599,
        errorCode: 'UNKNOWN_SERVER_ERROR',
        message: 'NestJS Prisma PostgreSQL stack trace',
      }),
      { status: 599 },
    );

    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.requestFailed');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    expect(caught.code).toBe('INTERNAL_SERVER_ERROR');
    expect(
      getMobileErrorMessage(caught, translate, 'errors.requestFailed'),
    ).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
  });

  it('uses a safe generic fallback for unknown errors', () => {
    expect(
      getMobileErrorMessage(
        new Error('ECONNREFUSED NestJS Prisma'),
        translate,
        'errors.requestFailed',
      ),
    ).toBe('Không thể kết nối dịch vụ. Hãy kiểm tra kết nối và thử lại.');
  });

  it('preserves request ids and only appends them to unexpected server failures', () => {
    const error = new MobileApiError(
      'REQUEST_FAILED',
      'errors.requestFailed',
      undefined,
      {
        statusCode: 500,
        requestId: '550e8400-e29b-41d4-a716-446655440099',
      },
    );

    expect(error.requestId).toBe('550e8400-e29b-41d4-a716-446655440099');
    expect(
      getMobileErrorMessage(error, translate, 'errors.requestFailed'),
    ).toContain('Mã hỗ trợ: 550e8400-e29b-41d4-a716-446655440099');
  });
  it('uses a valid x-request-id header when a 5xx body omits requestId', async () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440096';
    const response = new Response(
      JSON.stringify({
        statusCode: 500,
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'x-request-id': requestId },
      },
    );

    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.requestFailed');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    expect(caught.requestId).toBe(requestId);
    expect(
      getMobileErrorMessage(caught, translate, 'errors.requestFailed'),
    ).toBe(
      `Hệ thống đang gặp sự cố. Vui lòng thử lại sau.\nMã hỗ trợ: ${requestId}`,
    );
  });
  it('does not retain or display malformed request ids', () => {
    const error = new MobileApiError(
      'REQUEST_FAILED',
      'errors.requestFailed',
      undefined,
      { statusCode: 500, requestId: 'ECONNREFUSED Prisma' },
    );

    expect(error.requestId).toBeUndefined();
    expect(
      getMobileErrorMessage(error, translate, 'errors.requestFailed'),
    ).not.toContain('ECONNREFUSED Prisma');
  });

  it('does not append support codes to domain failures with server status', () => {
    const error = new MobileApiError(
      'SESSION_INVALID',
      'errors.sessionInvalid',
      undefined,
      {
        statusCode: 500,
        requestId: '550e8400-e29b-41d4-a716-446655440098',
      },
    );

    expect(
      getMobileErrorMessage(error, translate, 'errors.requestFailed'),
    ).toBe('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    expect(
      getMobileErrorMessage(error, translate, 'errors.requestFailed'),
    ).not.toContain('550e8400-e29b-41d4-a716-446655440098');
  });

  it('uses the status-specific fallback for malformed 4xx responses', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 422,
        message: 'Cannot POST /unknown',
      }),
      { status: 422 },
    );
    let caught: unknown;
    try {
      await throwMobileResponseError(response, 'errors.loadCalendar');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileApiError);
    if (!(caught instanceof MobileApiError)) return;
    expect(caught.code).toBe('UNPROCESSABLE_ENTITY');
    expect(caught.messageKey).toBe('errors.unprocessableEntity');
    expect(getMobileErrorMessage(caught, t, 'errors.requestFailed')).toBe(
      'translated:errors.unprocessableEntity',
    );
  });


  it('keeps canonical HTTP envelope codes available to mobile screens', () => {
    const notFound = new MobileApiError(
      'NOT_FOUND',
      mobileErrorMessageKey('NOT_FOUND'),
    );
    const badRequest = new MobileApiError(
      'BAD_REQUEST',
      mobileErrorMessageKey('BAD_REQUEST'),
    );

    expect(notFound.messageKey).toBe('errors.notFound');
    expect(badRequest.messageKey).toBe('errors.badRequest');
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

  it('maps canonical generic server failures to the fallback code', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 503,
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
        requestId: '550e8400-e29b-41d4-a716-446655440001',
      }),
      { status: 503 },
    );
    await expect(
      throwMobileResponseError(response, 'errors.loadKitchen'),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      messageKey: 'errors.internalServerError',
    });
  });

  it('extracts canonical top-level errorCode responses', async () => {
    const response = new Response(
      JSON.stringify({
        statusCode: 409,
        errorCode: 'ALREADY_CHECKED_IN',
        message: 'Already checked in.',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      { status: 409 },
    );
    await expect(
      throwMobileResponseError(response, 'errors.loadPickup'),
    ).rejects.toMatchObject({
      code: 'ALREADY_CHECKED_IN',
      messageKey: 'errors.checkInAlreadyCheckedIn',
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
      statusCode: 401,
      errorCode: 'SESSION_INVALID',
      message: 'Authentication is required.',
      requestId: '550e8400-e29b-41d4-a716-446655440002',
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
      statusCode: 401,
      errorCode: 'OTP_INVALID_OR_EXPIRED',
      message: 'The request could not be processed.',
      requestId: '550e8400-e29b-41d4-a716-446655440003',
    }),
    { status: 401 },
  );
  await expect(
    throwMobileResponseError(otpResponse, 'errors.verifyOtp'),
  ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });

  const unauthorizedResponse = new Response(
    JSON.stringify({
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
      message: 'Authentication is required.',
      requestId: '550e8400-e29b-41d4-a716-446655440004',
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
          statusCode: 400,
          errorCode: code,
          message: 'The request could not be processed.',
          requestId: '550e8400-e29b-41d4-a716-446655440005',
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
        statusCode: 400,
        errorCode: code,
        message: 'The request could not be processed.',
        requestId: '550e8400-e29b-41d4-a716-446655440005',
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
