import { describe, expect, it, vi } from 'vitest';
import { ApiMetricsService } from './metrics.service.js';
import {
  ApiMetricsSourceAdapter,
  type WorkerMetricsAggregator,
} from './api-metrics-source.js';

describe('ApiMetricsSourceAdapter', () => {
  it('publishes a strict api_application snapshot to the private aggregator interface', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    const accept = vi.fn();
    const aggregator = { acceptApiApplicationSnapshot: accept } satisfies WorkerMetricsAggregator;
    const adapter = new ApiMetricsSourceAdapter(aggregator);

    await expect(adapter.flush(metrics)).resolves.toMatchObject({
      source: 'api_application',
      freshness: 'fresh',
      payload: expect.stringContaining('imeal_auth_attempts_total'),
    });
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'api_application',
        freshness: 'fresh',
      }),
    );
  });

  it('exposes collector_failure when the private sink is unavailable or rejects', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');

    await expect(new ApiMetricsSourceAdapter().flush(metrics)).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'sink_unavailable',
    });

    const adapter = new ApiMetricsSourceAdapter({
      acceptApiApplicationSnapshot: vi
        .fn()
        .mockRejectedValue(new Error('sink unavailable')),
    });
    await expect(adapter.flush(metrics)).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'sink_rejected',
    });
  });
});
