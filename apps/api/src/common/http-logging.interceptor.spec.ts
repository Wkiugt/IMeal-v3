import { HttpException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@imeal/observability';
import { HttpLoggingInterceptor } from './http-logging.interceptor.js';
import type { ApiMetricsService } from './metrics.service.js';
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

function metrics() {
  return {
    recordHttpRequest: vi.fn(),
  } as unknown as Pick<ApiMetricsService, 'recordHttpRequest'>;
}

describe('HttpLoggingInterceptor', () => {
  it('logs successful requests with normalized safe fields', async () => {
    const sink = logger();
    const metricSink = metrics();
    const interceptor = new HttpLoggingInterceptor(
      sink,
      undefined,
      metricSink as never,
    );
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
    expect(metricSink.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(metricSink.recordHttpRequest).toHaveBeenCalledWith(
      '/registrations/:id',
      'GET',
      200,
      expect.any(Number),
    );
  });

  it('does not record the reserved /metrics path', async () => {
    const sink = logger();
    const metricSink = metrics();
    const interceptor = new HttpLoggingInterceptor(
      sink,
      undefined,
      metricSink as never,
    );

    await lastValueFrom(
      interceptor.intercept(
        context(
          {
            method: 'GET',
            route: { path: '/metrics' },
            url: '/metrics',
          },
          { statusCode: 404 },
        ),
        { handle: () => of({ ok: false }) },
      ),
    );

    expect(metricSink.recordHttpRequest).not.toHaveBeenCalled();
  });
  it('does not record a request with no approved response status', async () => {
    const sink = logger();
    const metricSink = metrics();
    const interceptor = new HttpLoggingInterceptor(
      sink,
      undefined,
      metricSink as never,
    );

    await lastValueFrom(
      interceptor.intercept(
        context(
          {
            method: 'GET',
            route: { path: '/api/orders' },
            url: '/api/orders',
          },
          {},
        ),
        { handle: () => of({ ok: true }) },
      ),
    );

    expect(metricSink.recordHttpRequest).not.toHaveBeenCalled();
  });


  it('logs safe error metadata while preserving the original exception', async () => {
    const sink = logger();
    const metricSink = metrics();
    const interceptor = new HttpLoggingInterceptor(
      sink,
      undefined,
      metricSink as never,
    );
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
    expect(metricSink.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(metricSink.recordHttpRequest).toHaveBeenCalledWith(
      '/auth/otp',
      'POST',
      400,
      expect.any(Number),
    );
  });

  it('rejects new work while draining but still serves health probes', async () => {
    const sink = logger();
    const metricSink = metrics();
    const registerInFlight = vi.fn().mockReturnValue(undefined);
    const shutdown = {
      isDraining: vi.fn().mockReturnValue(true),
      registerInFlight,
    };
    const interceptor = new HttpLoggingInterceptor(
      sink,
      shutdown,
      metricSink as never,
    );
    const response = { statusCode: 200 };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context(
            {
              method: 'GET',
              route: { path: '/registrations' },
              url: '/registrations',
            },
            response,
          ),
          { handle: () => of({ ok: true }) },
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'SERVICE_UNAVAILABLE' } });

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context(
            {
              method: 'GET',
              route: { path: '/health/ready' },
              url: '/health/ready',
            },
            response,
          ),
          { handle: () => of({ ok: true }) },
        ),
      ),
    ).resolves.toEqual({ ok: true });
    expect(registerInFlight).toHaveBeenCalledTimes(1);
    expect(metricSink.recordHttpRequest).toHaveBeenCalledTimes(2);
    expect(metricSink.recordHttpRequest).toHaveBeenNthCalledWith(
      1,
      '/registrations',
      'GET',
      503,
      expect.any(Number),
    );
    expect(metricSink.recordHttpRequest).toHaveBeenNthCalledWith(
      2,
      '/health/ready',
      'GET',
      200,
      expect.any(Number),
    );
  });
});
