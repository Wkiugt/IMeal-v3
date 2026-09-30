import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MetricsController } from './metrics.controller.js';

describe('MetricsController', () => {
  it('fails closed when the worker-owned snapshot is incomplete', async () => {
    const metrics = { getCompleteSnapshot: vi.fn().mockResolvedValue(null) };
    const controller = new MetricsController(metrics as never);

    await expect(controller.getMetrics()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns only the complete registry text', async () => {
    const metrics = {
      getCompleteSnapshot: vi.fn().mockResolvedValue(
        '# HELP imeal_worker_runs_total Scheduled worker job start/end/failure lifecycle\n',
      ),
    };
    const controller = new MetricsController(metrics as never);

    await expect(controller.getMetrics()).resolves.toContain(
      'imeal_worker_runs_total',
    );
  });

  it('accepts a structured API snapshot only with the configured bearer token', () => {
    const acceptApiApplicationSnapshot = vi.fn();
    const body = { source: 'api_application', samples: [] };
    const controller = new MetricsController(
      { getCompleteSnapshot: vi.fn(), acceptApiApplicationSnapshot } as never,
      'transport-secret',
    );

    controller.acceptApiApplicationSnapshot('Bearer transport-secret', body);

    expect(acceptApiApplicationSnapshot).toHaveBeenCalledWith(body);
  });

  it('rejects missing or incorrect transport credentials without calling the service', () => {
    const acceptApiApplicationSnapshot = vi.fn();
    const controller = new MetricsController(
      { getCompleteSnapshot: vi.fn(), acceptApiApplicationSnapshot } as never,
      'transport-secret',
    );

    expect(() =>
      controller.acceptApiApplicationSnapshot(undefined, {}),
    ).toThrow(UnauthorizedException);
    expect(() =>
      controller.acceptApiApplicationSnapshot('Bearer wrong', {}),
    ).toThrow(UnauthorizedException);
    expect(acceptApiApplicationSnapshot).not.toHaveBeenCalled();

    const missingConfigController = new MetricsController(
      { getCompleteSnapshot: vi.fn(), acceptApiApplicationSnapshot } as never,
      undefined,
    );
    expect(() =>
      missingConfigController.acceptApiApplicationSnapshot(
        'Bearer transport-secret',
        {},
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects malformed structured snapshots without leaking validation details', () => {
    const controller = new MetricsController(
      {
        getCompleteSnapshot: vi.fn(),
        acceptApiApplicationSnapshot: vi.fn().mockImplementation(() => {
          throw new Error('postgresql://secret');
        }),
      } as never,
      'transport-secret',
    );

    expect(() =>
      controller.acceptApiApplicationSnapshot('Bearer transport-secret', {
        source: 'api_application',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.acceptApiApplicationSnapshot('Bearer transport-secret', {
        source: 'api_application',
      }),
    ).toThrowError(/invalid application snapshot/i);
  });
});
