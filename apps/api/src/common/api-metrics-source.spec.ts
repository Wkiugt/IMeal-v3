import { describe, expect, it, vi } from 'vitest';
import type { ApplicationSnapshotMetadata } from '@imeal/observability';
import { ApiMetricsService } from './metrics.service.js';
import {
  ApiMetricsSourceAdapter,
  WorkerMetricsHttpAggregator,
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

  it('reports metadata_missing before checking an unavailable sink', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');

    await expect(new ApiMetricsSourceAdapter().flush(metrics)).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'metadata_missing',
    });
  });

  it('reports sink_unavailable after valid metadata is accepted', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');

    await expect(
      new ApiMetricsSourceAdapter().flush(metrics, metadata),
    ).resolves.toEqual({
      source: 'api_application',
      freshness: 'collector_failure',
      reason: 'sink_unavailable',
    });
  });

  it('reports sink_rejected when the structured sink rejects', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
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
  it('delivers a structured snapshot to the protected worker transport', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    const request = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const transport = new WorkerMetricsHttpAggregator(
      'http://worker:3001/metrics/application-snapshot',
      'transport-secret',
      request,
    );
    const result = await new ApiMetricsSourceAdapter(transport).flush(
      metrics,
      metadata,
    );

    expect(result.freshness).toBe('fresh');
    expect(request).toHaveBeenCalledWith(
      'http://worker:3001/metrics/application-snapshot',
      expect.objectContaining({
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer transport-secret',
          'content-type': 'application/json',
        },
      }),
    );
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      source: 'api_application',
    });
    expect(String(init.body)).not.toContain('# HELP');
  });

  it.each([
    ['missing URL', undefined, 'transport-secret'],
    ['missing token', 'http://worker:3001/metrics/application-snapshot', undefined],
  ])('fails closed for %s transport configuration', async (_name, url, token) => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    const transport = new WorkerMetricsHttpAggregator(url, token, vi.fn());
    await expect(
      new ApiMetricsSourceAdapter(transport).flush(metrics, metadata),
    ).resolves.toMatchObject({
      freshness: 'collector_failure',
      reason: 'sink_unavailable',
    });
  });

  it('reports a protected transport rejection without logging or forwarding the token', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const transport = new WorkerMetricsHttpAggregator(
      'http://worker:3001/metrics/application-snapshot',
      'transport-secret',
      request,
    );
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');

    await expect(
      new ApiMetricsSourceAdapter(transport).flush(metrics, metadata),
    ).resolves.toMatchObject({
      freshness: 'collector_failure',
      reason: 'sink_rejected',
    });
    expect(request.mock.calls[0]?.[1]).not.toMatchObject({
      body: expect.stringContaining('transport-secret'),
    });
  });
});
