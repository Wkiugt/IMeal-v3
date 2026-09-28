import { GUARDS_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { WorkerHealthResult } from './health.service.js';

function result(statusCode: 200 | 503 = 200): WorkerHealthResult {
  return {
    statusCode,
    body: {
      status: statusCode === 200 ? 'ok' : 'error',
      service: 'worker',
      release: 'release-1',
      checks: {
        environment: 'ok',
        database: statusCode === 200 ? 'ok' : 'down',
        migration: 'ok',
        scheduler: 'ok',
        draining: 'ok',
        lastLoop: 'not_configured',
      },
      requestId: '123e4567-e89b-42d3-a456-426614174000',
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
      live: vi.fn().mockReturnValue(result()),
      ready: vi.fn().mockResolvedValue(result()),
    };
    response = { status: vi.fn(), header: vi.fn() };
    controller = new HealthController(service as never);
  });

  it('serves live without an auth guard and sets request ID', () => {
    const body = controller.live(
      '123e4567-e89b-42d3-a456-426614174000',
      response as never,
    );

    expect(body.status).toBe('ok');
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

  it('maps readiness failures to HTTP 503', async () => {
    service.ready.mockResolvedValueOnce(result(503));

    const body = await controller.ready(
      '123e4567-e89b-42d3-a456-426614174001',
      response as never,
    );

    expect(body.status).toBe('error');
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
