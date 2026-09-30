import { describe, expect, it, vi } from 'vitest';
import type { ApplicationSnapshotMetadata } from '@imeal/observability';
import { ApiMetricsService } from './metrics.service.js';
import {
  ApiMetricsSourceAdapter,
  type WorkerMetricsAggregator,
} from './api-metrics-source.js';

const metadata: ApplicationSnapshotMetadata = {
  source: 'api_application',
  observedAt: '2026-09-30T00:00:00.000Z',
  freshness: 'fresh',
  evidence: {
    release: 'release-test',
    source: 'api_application',
    observedAt: '2026-09-30T00:00:00.000Z',
    contractRevision: '2026-09-30',
    freshness: 'fresh',
    sha256Digest: `sha256:${'a'.repeat(64)}`,
    resultTaxonomyRevision: 'result-taxonomy-v1',
    routeTaxonomyRevision: 'route-taxonomy-v1',
    bucketRevision: 'bucket-v1',
  },
};

describe('ApiMetricsSourceAdapter', () => {
  it('publishes structured api_application samples with exact histogram data', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    metrics.recordHttpRequest('/api/orders', 'GET', 200, 250);
    const accept = vi.fn();
    const aggregator = {
      acceptApiApplicationSnapshot: accept,
    } satisfies WorkerMetricsAggregator;
    const adapter = new ApiMetricsSourceAdapter(aggregator);

    const result = await adapter.flush(metrics, metadata);

    expect(result).toMatchObject({
      source: 'api_application',
      freshness: 'fresh',
      snapshot: { source: 'api_application' },
    });
    expect('payload' in result).toBe(false);
    expect(accept).toHaveBeenCalledTimes(1);
    const snapshot = accept.mock.calls[0]?.[0];
    expect(snapshot.source).toBe('api_application');
    expect(snapshot.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'imeal_auth_attempts_total',
          value: 1,
        }),
        expect.objectContaining({
          metricName: 'imeal_http_request_duration_seconds_bucket',
          value: {
            buckets: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
            sum: 0.25,
            count: 1,
          },
        }),
      ]),
    );
  });

  it('exposes collector_failure when metadata or the private sink is unavailable', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');

    await expect(new ApiMetricsSourceAdapter().flush(metrics)).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'metadata_missing',
    });
    await expect(
      new ApiMetricsSourceAdapter().flush(metrics, metadata),
    ).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'sink_unavailable',
    });
    await expect(
      new ApiMetricsSourceAdapter({
        acceptApiApplicationSnapshot: vi.fn(),
      }).flush(metrics),
    ).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'metadata_missing',
    });

    const adapter = new ApiMetricsSourceAdapter({
      acceptApiApplicationSnapshot: vi
        .fn()
        .mockRejectedValue(new Error('sink unavailable')),
    });
    await expect(adapter.flush(metrics, metadata)).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'sink_rejected',
    });
  });
  it('fails closed for malformed metadata before sending to the sink', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    const accept = vi.fn();
    const adapter = new ApiMetricsSourceAdapter({
      acceptApiApplicationSnapshot: accept,
    });
    const malformed = [
      ['timestamp', { observedAt: 'not-a-timestamp' }],
      [
        'digest',
        {
          evidence: {
            ...metadata.evidence,
            sha256Digest: 'sha256:not-a-digest',
          },
        },
      ],
      [
        'revision',
        {
          evidence: {
            ...metadata.evidence,
            contractRevision: 'revision-v1',
          },
        },
      ],
      ['source', { source: 'worker_application' }],
      ['freshness', { freshness: 'not-fresh' }],
      [
        'evidence observedAt',
        {
          evidence: {
            ...metadata.evidence,
            observedAt: '2026-09-30T00:01:00.000Z',
          },
        },
      ],
      [
        'evidence source',
        {
          evidence: {
            ...metadata.evidence,
            source: 'worker_application',
          },
        },
      ],
      [
        'evidence freshness',
        {
          evidence: {
            ...metadata.evidence,
            freshness: 'stale',
          },
        },
      ],
    ] as const;

    for (const [, override] of malformed) {
      await expect(
        adapter.flush(metrics, {
          ...metadata,
          ...override,
        } as ApplicationSnapshotMetadata),
      ).resolves.toMatchObject({
        freshness: 'collector_failure',
        reason: 'metadata_missing',
      });
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it('fails closed for an empty API registry', async () => {
    const adapter = new ApiMetricsSourceAdapter({
      acceptApiApplicationSnapshot: vi.fn(),
    });

    await expect(
      adapter.flush(new ApiMetricsService(), metadata),
    ).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'snapshot_empty',
    });
  });
});
