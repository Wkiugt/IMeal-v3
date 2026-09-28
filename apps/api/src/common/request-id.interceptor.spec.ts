import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContextRequest } from './request-context.js';
import { RequestIdInterceptor } from './request-id.interceptor.js';

function context(
  request: RequestContextRequest,
  response: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RequestIdInterceptor', () => {
  it('sets and preserves a valid request ID on successful responses', async () => {
    const request: RequestContextRequest = {
      headers: {
        'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
      },
    };
    const response = { header: vi.fn() };
    const interceptor = new RequestIdInterceptor();

    await lastValueFrom(
      interceptor.intercept(context(request, response), {
        handle: () => of({ ok: true }),
      }),
    );

    expect(request.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(response.header).toHaveBeenCalledWith(
      'x-request-id',
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('sets the same generated ID before an error reaches the filter', async () => {
    const request: RequestContextRequest = {
      headers: { 'x-request-id': 'malformed' },
    };
    const response = { header: vi.fn() };
    const interceptor = new RequestIdInterceptor();

    await expect(
      lastValueFrom(
        interceptor.intercept(context(request, response), {
          handle: () => throwError(() => new Error('failure')),
        }),
      ),
    ).rejects.toThrow('failure');

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.header).toHaveBeenCalledWith(
      'x-request-id',
      request.requestId,
    );
  });
});
