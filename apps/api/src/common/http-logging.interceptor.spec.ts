import { HttpException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@imeal/observability';
import { HttpLoggingInterceptor } from './http-logging.interceptor.js';

function context(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as never;
}

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as StructuredLogger;
}

describe('HttpLoggingInterceptor', () => {
  it('logs successful requests with normalized safe fields', async () => {
    const sink = logger();
    const interceptor = new HttpLoggingInterceptor(sink);
    const request = {
      method: 'GET',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      routeOptions: { url: '/registrations/:id' },
      url: '/registrations/reg-1?token=secret',
    };
    const response = { statusCode: 200 };

    await lastValueFrom(
      interceptor.intercept(context(request, response), {
        handle: () => of({ ok: true }),
      }),
    );

    expect(sink.info).toHaveBeenCalledWith(
      'http.request',
      expect.objectContaining({
        method: 'GET',
        route: '/registrations/:id',
        statusCode: 200,
        requestId: request.requestId,
        durationMs: expect.any(Number),
      }),
    );
    const fields = (sink.info as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(fields.route).not.toContain('token=secret');
  });

  it('logs safe error metadata while preserving the original exception', async () => {
    const sink = logger();
    const interceptor = new HttpLoggingInterceptor(sink);
    const request = {
      method: 'POST',
      requestId: '550e8400-e29b-41d4-a716-446655440001',
      route: { path: '/auth/otp' },
      url: '/auth/otp?code=123456',
    };
    const response = { statusCode: 200 };
    const exception = new HttpException('database password=secret', 400);

    await expect(
      lastValueFrom(
        interceptor.intercept(context(request, response), {
          handle: () => throwError(() => exception),
        }),
      ),
    ).rejects.toBe(exception);

    expect(sink.error).toHaveBeenCalledWith(
      'http.error',
      expect.objectContaining({
        method: 'POST',
        route: '/auth/otp',
        statusCode: 400,
        requestId: request.requestId,
      }),
    );
    expect(
      JSON.stringify((sink.error as ReturnType<typeof vi.fn>).mock.calls[0]),
    ).not.toContain('database password=secret');
    expect(
      JSON.stringify((sink.error as ReturnType<typeof vi.fn>).mock.calls[0]),
    ).not.toContain('123456');
  });
});
