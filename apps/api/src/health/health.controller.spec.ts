import { GUARDS_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../common/request-context.js';
import { HealthController } from './health.controller.js';
import type { ApiHealthResult } from './health.types.js';

const DEFAULT_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function result(
  statusCode: 200 | 503 = 200,
  requestId = DEFAULT_REQUEST_ID,
): ApiHealthResult {
  return {
    statusCode,
    body: {
      status: statusCode === 200 ? 'ok' : 'error',
      service: 'api',
      release: 'release-1',
      checks: {
        environment: 'ok',
        database: statusCode === 200 ? 'ok' : 'down',
        migration: 'ok',
        draining: 'ok',
      },
      requestId,
    },
  };
}

describe('HealthController', () => {
  let service: {
    live: ReturnType<typeof vi.fn>;
    ready: ReturnType<typeof vi.fn>;
  };
  let controller: HealthController;
  let response: {
    status: ReturnType<typeof vi.fn>;
    header: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      live: vi.fn((requestId: string) => ({
        ...result(),
        body: { ...result().body, requestId },
      })),
      ready: vi.fn(async (requestId: string) => ({
        ...result(),
        body: { ...result().body, requestId },
      })),
    };
    response = { status: vi.fn(), header: vi.fn() };
    controller = new HealthController(service as never);
  });

  it('serves live without an auth guard and sets the request ID header', () => {
    const body = controller.live(
      '123e4567-e89b-42d3-a456-426614174000',
      response as never,
    );

    expect(body).toHaveProperty('status', 'ok');
    expect(service.live).toHaveBeenCalledWith(expect.any(String));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.header).toHaveBeenCalledWith(
      'x-request-id',
      '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HealthController),
    ).toBeUndefined();
  });

  it('returns the canonical error response for readiness failures', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174001';
    service.ready.mockResolvedValueOnce(result(503, requestId));

    const body = await controller.ready(requestId, response as never);

    expect(body).toEqual({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      requestId,
    });
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.header).toHaveBeenCalledWith('x-request-id', requestId);
  });
  it('keeps the legacy health alias canonical on readiness failure', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174002';
    service.ready.mockResolvedValueOnce(result(503, requestId));

    const body = await controller.legacy(requestId, response as never);

    expect(body).toEqual({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      requestId,
    });
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns the canonical error response when live is draining', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174005';
    service.live.mockReturnValueOnce(result(503, requestId));

    const body = controller.live(requestId, response as never);

    expect(body).toEqual({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      requestId,
    });
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.header).toHaveBeenCalledWith('x-request-id', requestId);
  });
  it('uses established request IDs for malformed and missing headers', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174003';
    service.ready.mockResolvedValueOnce(result(503, requestId));

    const body = await runWithRequestContext(requestId, () =>
      controller.ready('not-a-request-id', response as never),
    );

    expect(service.ready).toHaveBeenCalledWith(requestId);
    expect(body).toEqual({
      statusCode: 503,
      errorCode: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      requestId,
    });
    expect(response.header).toHaveBeenCalledWith('x-request-id', requestId);
  });

  it('uses the request context ID when the health header is missing', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174004';

    const body = controller.live(undefined, response as never, { requestId });

    expect(service.live).toHaveBeenCalledWith(requestId);
    expect(body.requestId).toBe(requestId);
    expect(response.header).toHaveBeenCalledWith('x-request-id', requestId);
  });

});
