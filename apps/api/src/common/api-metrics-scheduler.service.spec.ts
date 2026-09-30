import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiMetricsService } from './metrics.service.js';
import {
  ApiMetricsSchedulerService,
  API_METRICS_EVIDENCE_DIGEST_ENV,
  API_METRICS_OBSERVATION_TIMEOUT_MS,
  type ApiMetricsSchedulerSource,
} from './api-metrics-scheduler.service.js';
import type { ApiMetricsSourceSnapshot } from './api-metrics-source.js';

const digest = `sha256:${'a'.repeat(64)}`;
const environment = {
  RELEASE_VERSION: 'release-test',
  [API_METRICS_EVIDENCE_DIGEST_ENV]: digest,
} satisfies NodeJS.ProcessEnv;

function success(): ApiMetricsSourceSnapshot {
  return {
    source: 'api_application',
    freshness: 'fresh',
    snapshot: { source: 'api_application', samples: [] },
  };
}

describe('ApiMetricsSchedulerService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the initial flush without blocking module bootstrap', async () => {
    const metrics = new ApiMetricsService();
    metrics.recordAuthAttempt('success');
    let resolveInitial!: (value: ApiMetricsSourceSnapshot) => void;
    let calls = 0;
    const flush = vi.fn<ApiMetricsSchedulerSource['flush']>(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<ApiMetricsSourceSnapshot>((resolve) => {
          resolveInitial = resolve;
        });
      }
      return Promise.resolve(success());
    });
    const source: ApiMetricsSchedulerSource = { flush };
    const scheduler = new ApiMetricsSchedulerService(
      metrics,
      source,
      undefined,
      environment,
    );

    await scheduler.onModuleInit();
    expect(flush).toHaveBeenCalledTimes(1);
    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(1);

    resolveInitial(success());
    await Promise.resolve();
    await Promise.resolve();
    await scheduler.handlePeriodicFlush();

    expect(flush).toHaveBeenCalledTimes(2);
    const [receivedMetrics, metadata, signal] = vi.mocked(source.flush).mock
      .calls[0] ?? [];
    expect(receivedMetrics).toBe(metrics);
    expect(metadata).toMatchObject({
      source: 'api_application',
      freshness: 'fresh',
      evidence: {
        source: 'api_application',
        freshness: 'fresh',
        contractRevision: '2026-09-30',
        sha256Digest: digest,
        release: 'release-test',
        routeTaxonomyRevision: 'route-taxonomy-v1',
        bucketRevision: 'bucket-v1',
        resultTaxonomyRevision: 'result-taxonomy-v1',
        idempotencyBranchRevision: 'idempotency-branch-v1',
      },
    });
    expect(metadata?.observedAt).toBeTypeOf('string');
    expect(metadata?.evidence.observedAt).toBe(metadata?.observedAt);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(source.flush).toHaveBeenNthCalledWith(
      1,
      metrics,
      expect.objectContaining({ observedAt: metadata?.observedAt }),
      expect.any(AbortSignal),
    );
  });

  it('does not overlap an in-flight flush or retry within a tick', async () => {
    let resolveFlush!: (value: ApiMetricsSourceSnapshot) => void;
    let calls = 0;
    const flush = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<ApiMetricsSourceSnapshot>((resolve) => {
          resolveFlush = resolve;
        });
      }
      return Promise.resolve(success());
    });
    const source: ApiMetricsSchedulerSource = { flush };
    const scheduler = new ApiMetricsSchedulerService(
      new ApiMetricsService(),
      source,
      undefined,
      environment,
    );

    const first = scheduler.handlePeriodicFlush();
    const skipped = scheduler.handlePeriodicFlush();
    expect(await skipped).toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(1);

    resolveFlush(success());
    await first;
    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(2);
  });
  it('keeps timed-out flushes single-flight until the underlying call settles', async () => {
    vi.useFakeTimers();
    let resolveFlush!: (value: ApiMetricsSourceSnapshot) => void;
    const release = vi.fn();
    let calls = 0;
    const flush = vi.fn<ApiMetricsSchedulerSource['flush']>(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<ApiMetricsSourceSnapshot>((resolve) => {
          resolveFlush = resolve;
        });
      }
      return Promise.resolve(success());
    });
    const source: ApiMetricsSchedulerSource = { flush };
    const shutdown = {
      registerInFlight: vi.fn().mockReturnValue(release),
    };
    const scheduler = new ApiMetricsSchedulerService(
      new ApiMetricsService(),
      source,
      shutdown as never,
      environment,
    );

    const pending = scheduler.handlePeriodicFlush();
    await vi.advanceTimersByTimeAsync(API_METRICS_OBSERVATION_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(1);

    const signal = vi.mocked(flush).mock.calls[0]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);

    resolveFlush(success());
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('fails closed when protected metadata configuration is missing or invalid', async () => {
    const flush = vi.fn().mockResolvedValue(success());
    for (const invalidEnvironment of [
      { RELEASE_VERSION: 'release-test' },
      { RELEASE_VERSION: 'release-test', [API_METRICS_EVIDENCE_DIGEST_ENV]: 'digest' },
      { RELEASE_VERSION: 'not-a-release', [API_METRICS_EVIDENCE_DIGEST_ENV]: digest },
    ]) {
      const scheduler = new ApiMetricsSchedulerService(
        new ApiMetricsService(),
        { flush },
        undefined,
        invalidEnvironment,
      );
      await scheduler.handlePeriodicFlush();
    }
    expect(flush).not.toHaveBeenCalled();
  });
  it('registers flushes with shutdown drain and skips after draining begins', async () => {
    const release = vi.fn();
    const shutdown = {
      registerInFlight: vi.fn().mockReturnValueOnce(release).mockReturnValue(undefined),
    };
    const flush = vi.fn<ApiMetricsSchedulerSource['flush']>().mockResolvedValue(
      success(),
    );
    const scheduler = new ApiMetricsSchedulerService(
      new ApiMetricsService(),
      { flush },
      shutdown as never,
      environment,
    );

    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    await scheduler.handlePeriodicFlush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(shutdown.registerInFlight).toHaveBeenCalledTimes(2);
  });
});
