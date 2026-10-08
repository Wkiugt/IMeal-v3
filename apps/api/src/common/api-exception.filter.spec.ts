import { BadRequestException, HttpException } from '@nestjs/common';
import { JsonStructuredLogger, type StructuredLogger } from '@imeal/observability';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';

function host(
  request: Record<string, unknown>,
  reply: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as never;
}
function capturedMessage(status: number): unknown {
  const send = vi.fn();
  const reply = {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send,
  };
  const request = {
    requestId: '550e8400-e29b-41d4-a716-446655440012',
    headers: {},
  };

  new ApiExceptionFilter().catch(
    new HttpException('internal details', status),
    host(request, reply),
  );

  return (send.mock.calls[0]?.[0] as { message?: unknown } | undefined)
    ?.message;
}

const CANONICAL_MESSAGES = [
  {
    status: 400,
    message:
      'The provided information is not valid. Please check it and try again.',
  },
  {
    status: 401,
    message: 'Your session is no longer valid. Please sign in again.',
  },
  {
    status: 403,
    message: 'You do not have permission to perform this action.',
  },
  {
    status: 404,
    message: 'The requested information could not be found.',
  },
  { status: 405, message: 'This action is currently unavailable.' },
  {
    status: 408,
    message: 'The request took too long. Please try again.',
  },
  {
    status: 409,
    message: 'The information has changed. Please refresh and try again.',
  },
  { status: 410, message: 'This information is no longer available.' },
  { status: 413, message: 'The submitted data is too large.' },
  {
    status: 415,
    message: 'This file or data format is not supported.',
  },
  {
    status: 422,
    message:
      'Some provided information could not be accepted. Please check it and try again.',
  },
  {
    status: 429,
    message: 'Too many attempts were made. Please wait a moment and try again.',
  },
  {
    status: 500,
    message: 'Something went wrong on our side. Please try again later.',
  },
  { status: 501, message: 'This feature is currently unavailable.' },
  {
    status: 502,
    message:
      'A connected service is currently having problems. Please try again later.',
  },
  {
    status: 503,
    message:
      'The service is temporarily unavailable. Please try again.',
  },
  {
    status: 504,
    message:
      'A connected service is taking too long to respond. Please try again later.',
  },
] as const;

describe('canonical status messages', () => {
  it.each(CANONICAL_MESSAGES)(
    'uses the canonical message for $status',
    ({ status, message }) => {
      expect(capturedMessage(status)).toBe(message);
    },
  );

  it.each([
    {
      status: 418,
      message:
        'The request could not be completed. Please check the information and try again.',
    },
    {
      status: 599,
      message:
        'The service is temporarily experiencing a problem. Please try again later.',
    },
  ])('uses the class fallback for unknown $status', ({ status, message }) => {
    expect(capturedMessage(status)).toBe(message);
  });

  it('preserves the pre-phase fallback outside 4xx and 5xx classes', () => {
    expect(capturedMessage(399)).toBe('The request could not be processed.');
  });
});


describe('ApiExceptionFilter', () => {
  const PHASE_A15_CASES = [
    { status: 400, errorCode: 'BAD_REQUEST' },
    { status: 401, errorCode: 'UNAUTHORIZED' },
    { status: 403, errorCode: 'FORBIDDEN' },
    { status: 404, errorCode: 'NOT_FOUND' },
    { status: 405, errorCode: 'METHOD_NOT_ALLOWED' },
    { status: 408, errorCode: 'REQUEST_TIMEOUT' },
    { status: 409, errorCode: 'CONFLICT' },
    { status: 410, errorCode: 'GONE' },
    { status: 413, errorCode: 'PAYLOAD_TOO_LARGE' },
    { status: 415, errorCode: 'UNSUPPORTED_MEDIA_TYPE' },
    { status: 422, errorCode: 'UNPROCESSABLE_ENTITY' },
    { status: 429, errorCode: 'RATE_LIMITED' },
    { status: 500, errorCode: 'INTERNAL_SERVER_ERROR' },
    { status: 501, errorCode: 'NOT_IMPLEMENTED' },
    { status: 502, errorCode: 'BAD_GATEWAY' },
    { status: 503, errorCode: 'SERVICE_UNAVAILABLE' },
    { status: 504, errorCode: 'GATEWAY_TIMEOUT' },
    { status: 418, errorCode: 'BAD_REQUEST' },
    { status: 599, errorCode: 'INTERNAL_SERVER_ERROR' },
  ] as const;
  const phaseA15Message = (status: number): string =>
    CANONICAL_MESSAGES.find((entry) => entry.status === status)?.message ??
    (status >= 400 && status < 500
      ? 'The request could not be completed. Please check the information and try again.'
      : 'The service is temporarily experiencing a problem. Please try again later.');
  const phaseA15Sentinels = [
    'matrix-code-secret',
    'matrix-internal-details',
    'postgresql://user:secret@db.internal/imeal',
    'Bearer matrix-bearer-token',
    'matrix-cookie-secret',
    'matrix-otp-secret',
    'matrix-body-secret',
    'matrix-stack-secret',
    'matrix-details-secret',
    'matrix-query-token',
  ];

  it.each(PHASE_A15_CASES)(
    'keeps the complete safe error contract for $status',
    ({ status, errorCode }) => {
      const lines: string[] = [];
      const logger = new JsonStructuredLogger('api', 'test-release', (line) =>
        lines.push(line),
      );
      const send = vi.fn();
      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send,
      };
      const request = {
        method: 'POST',
        requestId: '550e8400-e29b-41d4-a716-446655440013',
        routeOptions: { url: '/v1/items/:id' },
        url: '/v1/items/42?token=matrix-query-token',
        headers: {},
      };
      const exception = new HttpException(
        {
          code: 'matrix-code-secret',
          message:
            'password=matrix-internal-details databaseUrl=postgresql://user:secret@db.internal/imeal authorization=Bearer matrix-bearer-token cookie=session=matrix-cookie-secret otp=matrix-otp-secret body=matrix-body-secret',
          details: {
            stack: 'matrix-stack-secret',
            body: 'matrix-body-secret',
            cause: 'matrix-details-secret',
          },
        },
        status,
      );

      new ApiExceptionFilter(logger).catch(exception, host(request, reply));

      const response = send.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(reply.status).toHaveBeenCalledWith(status);
      expect(reply.header).toHaveBeenCalledWith(
        'x-request-id',
        request.requestId,
      );
      expect(response).toEqual({
        statusCode: status,
        errorCode,
        message: phaseA15Message(status),
        requestId: request.requestId,
      });
      expect(Object.keys(response).sort()).toEqual([
        'errorCode',
        'message',
        'requestId',
        'statusCode',
      ]);
      expect(response.requestId).toBe(
        (reply.header as ReturnType<typeof vi.fn>).mock.calls[0]?.[1],
      );
      expect(lines).toHaveLength(1);

      const log = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(log).toMatchObject({
        event: 'http.exception',
        service: 'api',
        release: 'test-release',
        statusCode: status,
        errorCode,
        requestId: request.requestId,
        errorClass: status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR',
        method: 'POST',
        path: '/v1/items/42',
        route: '/v1/items/:id',
      });
      const serialized = JSON.stringify({ response, log });
      for (const sentinel of phaseA15Sentinels) {
        expect(serialized).not.toContain(sentinel);
      }
    },
  );

  it('preserves the request context ID and emits complete client-error fields', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      method: 'POST',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      routeOptions: { url: '/registrations/:id' },
      url: '/registrations/reg-1?token=secret',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: { field: 'email' },
      }),
      host(request, reply),
    );

    expect(reply.header).toHaveBeenCalledWith(
      'x-request-id',
      request.requestId,
    );
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      statusCode: 400,
      errorCode: 'VALIDATION_ERROR',
      message:
        'The provided information is not valid. Please check it and try again.',
      requestId: request.requestId,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'http.exception',
      expect.objectContaining({
        event: 'http.exception',
        errorClass: 'CLIENT_ERROR',
        method: 'POST',
        path: '/registrations/reg-1',
        route: '/registrations/:id',
        service: 'api',
        release: expect.any(String),
        requestId: request.requestId,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('token=secret');

  });
  it('uses the safe not-found message and omits exception details', () => {
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440009',
      headers: {},
    };

    new ApiExceptionFilter().catch(
      new HttpException(
        {
          code: 'NOT_FOUND',
          message: 'SQLSTATE[42P01] db.internal.example password=secret',
          details: { path: '/srv/api/app.ts', cause: 'raw cause' },
        },
        404,
      ),
      host(request, reply),
    );

    expect(send).toHaveBeenCalledWith({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      message: 'The requested information could not be found.',
      requestId: request.requestId,
    });
    expect(Object.keys(send.mock.calls[0]?.[0] as object)).toEqual([
      'statusCode',
      'errorCode',
      'message',
      'requestId',
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toContain('SQLSTATE');
    expect(JSON.stringify(send.mock.calls)).not.toContain('db.internal');
    expect(JSON.stringify(send.mock.calls)).not.toContain('/srv/api');
    expect(JSON.stringify(send.mock.calls)).not.toContain('raw cause');
  });
  it('preserves a domain auth code while using the safe auth message', () => {
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440011',
      headers: {},
    };

    new ApiExceptionFilter().catch(
      new HttpException(
        { code: 'SESSION_INVALID', message: 'Invalid or expired session.' },
        401,
      ),
      host(request, reply),
    );

    expect(send).toHaveBeenCalledWith({
      statusCode: 401,
      errorCode: 'SESSION_INVALID',
      message: 'Your session is no longer valid. Please sign in again.',
      requestId: request.requestId,
    });
  });
  it('keeps database, provider, path, stack, and cause text out of responses', () => {
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440010',
      headers: {},
    };
    const exception = new Error(
      'SQLSTATE[08001] host=db.internal.example provider=SMTP password=smtp-secret path=/srv/api/main.ts',
    );
    exception.stack =
      'Error: SQLSTATE[08001]\\n    at sendMail (/srv/api/main.ts:10:2)';
    (exception as Error & { cause?: unknown }).cause =
      'raw cause provider credential=provider-secret';

    new ApiExceptionFilter().catch(exception, host(request, reply));

    expect(send).toHaveBeenCalledWith({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again later.',
      requestId: request.requestId,
    });
    const serialized = JSON.stringify(send.mock.calls);
    expect(serialized).not.toContain('SQLSTATE');
    expect(serialized).not.toContain('db.internal');
    expect(serialized).not.toContain('smtp-secret');
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('/srv/api');
    expect(serialized).not.toContain('raw cause');
  });
  it.each([
    { status: 500, code: 'INTERNAL_SERVER_ERROR' },
    { status: 503, code: 'SERVICE_UNAVAILABLE' },
  ])(
    'does not expose internal 5xx response data for $status',
    ({ status, code }) => {
      const error = vi.fn();
      const logger = { error } as unknown as StructuredLogger;
      const send = vi.fn();
      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send,
      };
      const request = {
        requestId: '550e8400-e29b-41d4-a716-446655440002',
        headers: {},
      };
      const exception = new HttpException(
        {
          code,
          message: 'postgresql://user:secret@db/internal',
          details: {
            password: 'secret-password',
            stack: 'internal-stack',
            body: 'opaque-body',
          },
        },
        status,
      );

      new ApiExceptionFilter(logger).catch(exception, host(request, reply));

      expect(reply.status).toHaveBeenCalledWith(status);
      expect(send).toHaveBeenCalledWith({
        statusCode: status,
        errorCode: code,
        message:
          status === 500
            ? 'Something went wrong on our side. Please try again later.'
            : 'The service is temporarily unavailable. Please try again later.',
        requestId: request.requestId,
      });
      expect(JSON.stringify(send.mock.calls)).not.toContain(
        'postgresql://user:secret@db/internal',
      );
      expect(JSON.stringify(send.mock.calls)).not.toContain('secret-password');
      expect(JSON.stringify(send.mock.calls)).not.toContain('internal-stack');
      expect(JSON.stringify(send.mock.calls)).not.toContain('opaque-body');
      expect(JSON.stringify(error.mock.calls)).not.toContain(
        'postgresql://user:secret@db/internal',
      );
    },
  );
  it('does not expose or log unsafe 5xx error codes', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440006',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new HttpException(
        { code: 'password=raw-secret', message: 'internal details' },
        503,
      ),
      host(request, reply),
    );

    expect(send).toHaveBeenCalledWith({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again later.',
      requestId: request.requestId,
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain('raw-secret');
    expect(JSON.stringify(error.mock.calls)).not.toContain('raw-secret');
    expect(error.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ errorCode: 'SERVICE_UNAVAILABLE' }),
    );
  });
  it.each(['constructor', 'toString', '__proto__'])(
    'rejects inherited unsafe 5xx code %s',
    (code) => {
      const error = vi.fn();
      const logger = { error } as unknown as StructuredLogger;
      const send = vi.fn();
      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send,
      };
      const request = {
        requestId: '550e8400-e29b-41d4-a716-446655440007',
        headers: {},
      };

      new ApiExceptionFilter(logger).catch(
        new HttpException({ code, message: 'internal details' }, 503),
        host(request, reply),
      );

      expect(send).toHaveBeenCalledWith({
        statusCode: 503,
        errorCode: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again later.',
        requestId: request.requestId,
      });
      expect(error.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ errorCode: 'SERVICE_UNAVAILABLE' }),
      );
    },
  );

  it('preserves the public OTP provider code in 5xx responses and logs', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440008',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new HttpException(
        { code: 'OTP_PROVIDER_UNAVAILABLE', message: 'provider unavailable' },
        503,
      ),
      host(request, reply),
    );

    expect(send).toHaveBeenCalledWith({
      statusCode: 503,
      errorCode: 'OTP_PROVIDER_UNAVAILABLE',
      message:
        'The service is temporarily unavailable. Please try again later.',
      requestId: request.requestId,
    });
    expect(error.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ errorCode: 'OTP_PROVIDER_UNAVAILABLE' }),
    );
  });



  it('preserves the established safe shutdown message without 5xx details', () => {
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440003',
      headers: {},
    };

    new ApiExceptionFilter().catch(
      new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is shutting down.',
          details: { internal: 'secret' },
        },
        503,
      ),
      host(request, reply),
    );

    expect(send).toHaveBeenCalledWith({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'Service is shutting down.',
      requestId: request.requestId,
    });
  });

  it('falls back for malformed request metadata', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = {
      method: { secret: 'method-secret' },
      url: { secret: 'path-secret' },
      route: { path: { secret: 'route-secret' } },
      routeOptions: { url: { secret: 'template-secret' } },
      requestId: '550e8400-e29b-41d4-a716-446655440004',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new BadRequestException('Invalid request'),
      host(request, reply),
    );

    expect(error.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'UNKNOWN',
        path: '/',
        route: '/',
      }),
    );
  });

  it('rejects unsafe custom error codes while sanitizing metadata', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = {
      method: 'GET',
      url: 'https://user:password@example.test/items/1?token=query-secret',
      routeOptions: {
        url: 'https://route-user:route-password@example.test/items/:id?x=secret',
      },
      requestId: '550e8400-e29b-41d4-a716-446655440005',
      headers: {},
    };

    new ApiExceptionFilter(logger).catch(
      new BadRequestException({
        code: 'https://service.test/path?token=custom-code-secret&trace=stable-code',
        message: 'Invalid request',
      }),
      host(request, reply),
    );

    const fields = error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).toMatchObject({
      path: 'https://[REDACTED]@example.test/items/1',
      route: 'https://[REDACTED]@example.test/items/:id',
      errorCode: 'BAD_REQUEST',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('password');
    expect(JSON.stringify(error.mock.calls)).not.toContain('query-secret');
    expect(JSON.stringify(error.mock.calls)).not.toContain('custom-code-secret');
  });

  it('sanitizes a string Error cause before mocked logging', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = {
      requestId: '550e8400-e29b-41d4-a716-446655440006',
      headers: {},
    };
    const exception = new Error('unexpected failure');
    (exception as Error & { cause?: unknown }).cause =
      'response={"headers":{"x-internal":"cause-header-sentinel"}} https://service.test/cause?session_token=mock-cause-token';

    new ApiExceptionFilter(logger).catch(exception, host(request, reply));

    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'cause-header-sentinel',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'mock-cause-token',
    );
  });

  it('uses safe metadata defaults when request context is null', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    new ApiExceptionFilter(logger).catch(
      new BadRequestException('Invalid request'),
      host(null as never, reply),
    );

    expect(error.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'UNKNOWN',
        path: '/',
        route: '/',
      }),
    );
  });

  it.each([
    {
      status: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again later.',
    },
    {
      status: 502,
      errorCode: 'BAD_GATEWAY',
      message:
        'A connected service is currently having problems. Please try again later.',
    },
    {
      status: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again later.',
    },
    {
      status: 504,
      errorCode: 'GATEWAY_TIMEOUT',
      message:
        'A connected service is taking too long to respond. Please try again later.',
    },
  ] as const)(
    'logs sanitized unexpected server diagnostics for $status without leaking them to clients',
    ({ status, errorCode, message }) => {
      const lines: string[] = [];
      const logger = new JsonStructuredLogger('api', 'test-release', (line) =>
        lines.push(line),
      );
      const send = vi.fn();
      const reply = {
        header: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        send,
      };
      const request = {
        method: 'GET',
        requestId: '550e8400-e29b-41d4-a716-446655440001',
        route: { path: '/health/ready' },
        url: '/health/ready?cookie=opaque-cookie',
        headers: {},
      };
      const diagnosticMarker = `diagnostic-marker-${status}`;
      const stackMarker = `diagnostic-stack-${status}`;
      const databaseSecret = `postgresql://user:secret@db/internal-${status}`;
      const authSecret = `opaque-token-${status}`;
      const cookieSecret = `opaque-cookie-${status}`;
      const otpSecret = `123456-${status}`;
      const bodySecret = `opaque-body-${status}`;
      const exception = new HttpException(
        { code: errorCode, message: `internal response details ${status}` },
        status,
      );
      exception.message = `${diagnosticMarker} databaseUrl=${databaseSecret} authorization=Bearer ${authSecret} cookie=session=${cookieSecret} otp=${otpSecret} body=${bodySecret}`;
      exception.stack = `Error: ${stackMarker} databaseUrl=${databaseSecret}\\n    at readyHandler (health.ts:10:2)`;

      new ApiExceptionFilter(logger).catch(exception, host(request, reply));

      expect(reply.status).toHaveBeenCalledWith(status);
      expect(send).toHaveBeenCalledWith({
        statusCode: status,
        errorCode,
        message,
        requestId: request.requestId,
      });
      const output = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(output).toMatchObject({
        event: 'http.exception',
        errorClass: 'SERVER_ERROR',
        statusCode: status,
        errorCode,
        requestId: request.requestId,
      });
      expect(output.message).toContain(diagnosticMarker);
      expect(output.stack).toContain(stackMarker);
      const response = send.mock.calls[0]?.[0];
      const serialized = JSON.stringify({ output, response });
      expect(JSON.stringify(response)).not.toContain(diagnosticMarker);
      for (const secret of [
        databaseSecret,
        authSecret,
        cookieSecret,
        otpSecret,
        bodySecret,
      ]) {
        expect(serialized).not.toContain(secret);
      }
    },
  );

  it('does not log raw exception details', () => {
    const error = vi.fn();
    const logger = { error } as unknown as StructuredLogger;
    const send = vi.fn();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const request = {
      requestId: 'malformed-client-id',
      id: 'also-malformed',
      headers: { 'x-request-id': 'malformed-header' },
    };
    const exception = new Error('postgresql://user:secret@db/internal');
    new ApiExceptionFilter(logger).catch(exception, host(request, reply));

    expect(reply.status).toHaveBeenCalledWith(500);
    const response = send.mock.calls[0]?.[0] as { requestId?: string };
    expect(response.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.requestId).not.toBe('malformed-client-id');
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'postgresql://user:secret@db/internal',
    );
  });
});
