import { ServiceUnavailableException } from '@nestjs/common';
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
});
