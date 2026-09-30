import { describe, expect, it, vi } from 'vitest';
import { WorkerMetricsService } from './metrics.service.js';
import { METRIC_CONTRACT, validateMetricSampleEnvelope } from '@imeal/observability';
import type { MetricSourceSnapshot } from '@imeal/observability';

function metricValue(text: string, name: string): string | undefined {
  return text
    .split('\n')
    .find((line) => line.startsWith(`${name} `) || line.startsWith(`${name}{`));
}
const DIGEST = 'sha256:' + 'a'.repeat(64);
const WORKER_JOBS = [
  'otp_delivery',
  'notification_dispatch',
  'registration_reminder',
  'pickup_reminder',
  'cutoff_lock',
  'pickup_session_cleanup',
  'no_show',
] as const;
const SOURCE_BINDINGS: Record<string, string> = {
  api_application: 'approved_api_application_source',
  worker_application: 'approved_worker_application_source',
  postgres_authoritative: 'approved_postgres_source',
  object_storage_authoritative: 'approved_object_storage_source',
  backup_restore_evidence: 'approved_backup_restore_evidence',
  security_boundary_evidence: 'approved_security_boundary_source',
};

function sampleFor(
  row: (typeof METRIC_CONTRACT)[number],
  observedAt: string,
  labelOverrides: Record<string, string> = {},
): ReturnType<typeof validateMetricSampleEnvelope> {
  const evidenceValues: Record<string, string> = {
    release: 'release-test',
    source: row.sourceIdentity,
    observedAt,
    contractRevision: '2026-09-30',
    freshness: 'fresh',
    sha256Digest: DIGEST,
    sourceKind: row.sourceKind,
    sourceBinding: SOURCE_BINDINGS[row.sourceIdentity],
    queryExporterBinding: 'approved_postgres_query_or_exporter',
    capacitySourceBinding: 'approved_object_storage_capacity_source',
    targetFingerprint: DIGEST,
    manifestDigest: DIGEST,
    rehearsalDigest: DIGEST,
    manifestCompletionTimestamp: observedAt,
    verificationResult: 'passed',
    deduplicationWindow: 'PT1M',
    reference: 'ref-test',
    routeTaxonomyRevision: 'route-taxonomy-v1',
    bucketRevision: 'bucket-v1',
    resultTaxonomyRevision: 'result-taxonomy-v1',
    idempotencyBranchRevision: 'idempotency-branch-v1',
    retryPolicyRevision: 'retry-policy-v1',
    failureTaxonomyRevision: 'failure-taxonomy-v1',
    jobTaxonomyRevision: 'job-taxonomy-v1',
    querySchemaRevision: 'query-schema-v1',
    scheduleRevision: 'schedule-v1',
    operationTaxonomyRevision: 'operation-taxonomy-v1',
    securityTaxonomyRevision: 'security-taxonomy-v1',
  };
  const evidence = Object.fromEntries([
    ...row.evidence.map((binding) => [binding, evidenceValues[binding]]),
    ['reference', evidenceValues.reference],
  ]);
  const labels = Object.fromEntries(
    Object.entries(row.labels).map(([key, values]) => [
      key,
      labelOverrides[key] ?? values[0],
    ]),
  );
  const value =
    row.type === 'histogram'
      ? { buckets: row.buckets.map(() => 1), sum: 1, count: 1 }
      : 1;
  return validateMetricSampleEnvelope({
    metricName: row.name,
    type: row.type,
    unit: row.unit,
    labels,
    value,
    observedAt,
    source: row.sourceIdentity,
    freshness: 'fresh',
    evidence,
  });
}

function completeSnapshots(
  observedAt: string,
  staleMetric?: string,
): readonly MetricSourceSnapshot[] {
  const grouped = new Map<
    string,
    ReturnType<typeof validateMetricSampleEnvelope>[]
  >();
  for (const row of METRIC_CONTRACT) {
    const samples = grouped.get(row.sourceIdentity) ?? [];
    const sampleObservedAt =
      staleMetric === row.name
        ? new Date(Date.now() - 10 * 60_000).toISOString()
        : observedAt;
    if (
      row.name === 'imeal_worker_job_last_success_timestamp_seconds' ||
      row.name === 'imeal_worker_job_lag_seconds'
    ) {
      for (const job of WORKER_JOBS) {
        samples.push(sampleFor(row, sampleObservedAt, { job }));
      }
    } else {
      samples.push(sampleFor(row, sampleObservedAt));
    }
    grouped.set(row.sourceIdentity, samples);
  }
  return [...grouped.entries()].map(([source, samples]) => ({
    source: source as MetricSourceSnapshot['source'],
    samples,
  }));
}

describe('WorkerMetricsService', () => {
  it('records OTP delivery counters only through explicit lifecycle boundaries', () => {
    const service = new WorkerMetricsService();

    service.recordOtpDeliveryAttempt();
    service.recordOtpDeliveryRetry();
    service.recordOtpDeliveryFailure();

    const text = service.serializeApplicationMetrics();
    expect(metricValue(text, 'imeal_otp_delivery_total')).toContain(' 1');
    expect(metricValue(text, 'imeal_otp_delivery_retries_total')).toContain(' 1');
    expect(metricValue(text, 'imeal_otp_delivery_failures_total')).toContain(' 1');
  });

  it('records one bounded terminal status and real completion gauges per worker job', () => {
    const service = new WorkerMetricsService();
    const completedAt = new Date('2026-09-30T07:00:00.000Z');

    service.recordWorkerRun('notification_dispatch', 'success', completedAt);
    service.recordWorkerRun('notification_dispatch', 'skipped', completedAt);

    const text = service.serializeApplicationMetrics();
    expect(text).toContain('imeal_worker_runs_total{job="notification_dispatch",status="success"} 1');
    expect(text).toContain('imeal_worker_runs_total{job="notification_dispatch",status="skipped"} 1');
    expect(text).toContain(
      `imeal_worker_job_last_success_timestamp_seconds{job="notification_dispatch"} ${completedAt.getTime() / 1000}`,
    );
  });

  it('reports the real oldest pending OTP outbox age and empty queue as fresh zero', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      createdAt: new Date('2026-09-30T06:59:00.000Z'),
      nextAttemptAt: new Date('2026-09-30T07:01:00.000Z'),
    });
    const service = new WorkerMetricsService({
      otpDeliveryOutbox: { findFirst },
    } as never);
    const now = new Date('2026-09-30T07:00:00.000Z');

    await service.refreshOutboxAge(now);
    expect(metricValue(service.serializeApplicationMetrics(), 'imeal_otp_outbox_oldest_age_seconds')).toContain(' 60');
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, nextAttemptAt: true },
    });

    findFirst.mockResolvedValueOnce(null);
    await service.refreshOutboxAge(now);
    expect(metricValue(service.serializeApplicationMetrics(), 'imeal_otp_outbox_oldest_age_seconds')).toContain(' 0');
  });
  it('removes missing DB-backed job gauges from local and published worker state', async () => {
    const now = new Date();
    const service = new WorkerMetricsService({
      jobRun: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    service.recordWorkerRun('cutoff_lock', 'success', now);

    await service.refreshJobHistory(now);

    expect(service.serializeApplicationMetrics()).not.toContain(
      'imeal_worker_job_last_success_timestamp_seconds{job="cutoff_lock"}',
    );
  });

  it('keeps the endpoint unavailable until all fresh approved source series exist', async () => {
    const service = new WorkerMetricsService();
    service.recordOtpDeliveryAttempt();

    await expect(service.getCompleteSnapshot()).resolves.toBeNull();
    expect(service.getMissingMetricNames()).toContain('imeal_otp_delivery_total');
  });
  it('returns a complete 23-name snapshot only for fresh bound source samples', async () => {
    const now = new Date();
    const service = new WorkerMetricsService({
      otpDeliveryOutbox: { findFirst: vi.fn().mockResolvedValue(null) },
      jobRun: { findFirst: vi.fn().mockResolvedValue({ completedAt: now }) },
    } as never);
    for (const snapshot of completeSnapshots(now.toISOString())) {
      if (snapshot.source === 'api_application') {
        service.acceptApiApplicationSnapshot(snapshot);
      } else if (snapshot.source === 'worker_application') {
        service.acceptWorkerApplicationSnapshot(snapshot);
      } else {
        service.acceptAuthoritativeSnapshot(snapshot);
      }
    }

    const text = await service.getCompleteSnapshot();
    expect(text).not.toBeNull();
    for (const row of METRIC_CONTRACT) {
      expect(text).toContain(row.name);
    }
    expect(text).not.toMatch(/password|authorization|Bearer|postgresql:/i);
  });
  it('fails closed when one required worker job gauge series is missing', async () => {
    const now = new Date();
    const service = new WorkerMetricsService({
      otpDeliveryOutbox: { findFirst: vi.fn().mockResolvedValue(null) },
      jobRun: { findFirst: vi.fn().mockResolvedValue({ completedAt: now }) },
    } as never);
    for (const snapshot of completeSnapshots(now.toISOString())) {
      const reduced =
        snapshot.source === 'worker_application'
          ? {
              ...snapshot,
              samples: snapshot.samples.filter(
                (sample) =>
                  !(
                    sample.metricName ===
                      'imeal_worker_job_last_success_timestamp_seconds' &&
                    sample.labels.job === 'no_show'
                  ),
              ),
            }
          : snapshot;
      if (reduced.source === 'api_application') {
        service.acceptApiApplicationSnapshot(reduced);
      } else if (reduced.source === 'worker_application') {
        service.acceptWorkerApplicationSnapshot(reduced);
      } else {
        service.acceptAuthoritativeSnapshot(reduced);
      }
    }

    await expect(service.getCompleteSnapshot()).resolves.toBeNull();
  });
  it('fails closed when an authoritative source reports collector failure', async () => {
    const now = new Date();
    const service = new WorkerMetricsService({
      otpDeliveryOutbox: { findFirst: vi.fn().mockResolvedValue(null) },
      jobRun: { findFirst: vi.fn().mockResolvedValue({ completedAt: now }) },
    } as never);
    for (const snapshot of completeSnapshots(now.toISOString())) {
      if (snapshot.source === 'api_application') {
        service.acceptApiApplicationSnapshot(snapshot);
      } else if (snapshot.source === 'worker_application') {
        service.acceptWorkerApplicationSnapshot(snapshot);
      } else {
        service.acceptAuthoritativeSnapshot(snapshot);
      }
    }

    service.acceptAuthoritativeFailure(
      'postgres_authoritative',
      'collector_failure',
      'source_unavailable',
    );
    await expect(service.getCompleteSnapshot()).resolves.toBeNull();
  });

  it('fails closed when a previously fresh source sample ages past its contract window', async () => {
    const now = new Date();
    const service = new WorkerMetricsService({
      otpDeliveryOutbox: { findFirst: vi.fn().mockResolvedValue(null) },
      jobRun: { findFirst: vi.fn().mockResolvedValue({ completedAt: now }) },
    } as never);
    for (const snapshot of completeSnapshots(
      now.toISOString(),
      'imeal_postgres_disk_usage_ratio',
    )) {
      if (snapshot.source === 'api_application') {
        service.acceptApiApplicationSnapshot(snapshot);
      } else if (snapshot.source === 'worker_application') {
        service.acceptWorkerApplicationSnapshot(snapshot);
      } else {
        service.acceptAuthoritativeSnapshot(snapshot);
      }
    }

    await expect(service.getCompleteSnapshot()).resolves.toBeNull();
  });
});
