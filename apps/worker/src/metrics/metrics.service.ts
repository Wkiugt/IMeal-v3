import { Injectable, Optional } from '@nestjs/common';
import {
  METRIC_CONTRACT,
  MetricRegistry,
  type MetricFreshness,
  type MetricSampleEnvelope,
  type MetricSnapshotMetadata,
  type MetricSourceSnapshot,
} from '@imeal/observability';
import type {
  AuthoritativeMetricsFailureReason,
  AuthoritativeSourceIdentity,
} from './authoritative-metrics.js';
import { PrismaService } from '../common/prisma.service.js';

export const WORKER_METRIC_JOBS = [
  'otp_delivery',
  'notification_dispatch',
  'registration_reminder',
  'pickup_reminder',
  'cutoff_lock',
  'pickup_session_cleanup',
  'no_show',
] as const;

export type WorkerMetricJob = (typeof WORKER_METRIC_JOBS)[number];
export type WorkerMetricStatus = 'success' | 'failure' | 'skipped';

const DB_JOB_HISTORY = new Set<WorkerMetricJob>([
  'registration_reminder',
  'pickup_reminder',
  'cutoff_lock',
  'no_show',
]);
const SECOND_INTERVALS: Partial<Record<WorkerMetricJob, number>> = {
  otp_delivery: 15,
  notification_dispatch: 15,
  pickup_session_cleanup: 10,
};
const DAY_MS = 24 * 60 * 60 * 1000;
function dateAtVietnamTime(now: Date, hour: number, minute: number): Date {
  const vietnam = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const candidate = new Date(
    Date.UTC(
      vietnam.getUTCFullYear(),
      vietnam.getUTCMonth(),
      vietnam.getUTCDate(),
      hour - 7,
      minute,
      0,
      0,
    ),
  );
  return candidate > now ? new Date(candidate.getTime() - DAY_MS) : candidate;
}

function scheduledAt(job: WorkerMetricJob, now: Date): Date {
  const interval = SECOND_INTERVALS[job];
  if (interval) {
    const timestamp = Math.floor(now.getTime() / 1000 / interval) * interval * 1000;
    return new Date(timestamp);
  }
  if (job === 'registration_reminder') {
    const candidate = dateAtVietnamTime(now, 10, 0);
    const vietnamDay = new Date(candidate.getTime() + 7 * 60 * 60 * 1000).getUTCDay();
    const daysSinceSunday = vietnamDay;
    return new Date(candidate.getTime() - daysSinceSunday * DAY_MS);
  }
  if (job === 'pickup_reminder') return dateAtVietnamTime(now, 11, 30);
  if (job === 'cutoff_lock') return dateAtVietnamTime(now, 14, 0);
  return dateAtVietnamTime(now, 13, 45);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function jobRunPrefix(job: WorkerMetricJob): string {
  return job === 'no_show' ? 'no_show_worker_' : `${job}_`;
}
function sourceSeriesKey(sample: MetricSampleEnvelope): string {
  const labels = Object.entries(sample.labels).sort(([first], [second]) =>
    first.localeCompare(second),
  );
  return `${sample.metricName}\u0000${JSON.stringify(labels)}`;
}

function sourceSampleSignature(sample: MetricSampleEnvelope): string {
  return JSON.stringify({
    metricName: sample.metricName,
    type: sample.type,
    unit: sample.unit,
    labels: Object.entries(sample.labels).sort(([first], [second]) =>
      first.localeCompare(second),
    ),
    value: sample.value,
    observedAt: sample.observedAt,
    source: sample.source,
    freshness: sample.freshness,
    evidence: sample.evidence,
  });
}

@Injectable()
export class WorkerMetricsService {
  /** Local worker counters/gauges; source snapshots are kept separately. */
  private readonly application = new MetricRegistry();
  /** Worker-owned aggregate of application and authoritative source snapshots. */
  private readonly aggregate = new MetricRegistry();
  private readonly lastSuccessfulJobs = new Map<WorkerMetricJob, Date>();
  private readonly collectorFailures = new Set<string>();
  private workerMetadata?: MetricSnapshotMetadata;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  recordOtpDeliveryAttempt(): void {
    this.application.increment('imeal_otp_delivery_total');
  }

  recordOtpDeliveryRetry(): void {
    this.application.increment('imeal_otp_delivery_retries_total');
  }

  recordOtpDeliveryFailure(): void {
    this.application.increment('imeal_otp_delivery_failures_total');
  }

  recordWorkerRun(
    job: WorkerMetricJob,
    status: WorkerMetricStatus,
    completedAt: Date = new Date(),
  ): void {
    if (!WORKER_METRIC_JOBS.includes(job) || !isValidDate(completedAt)) {
      throw new Error('Worker metric job or completion timestamp is invalid');
    }
    this.application.increment('imeal_worker_runs_total', { job, status });
    if (status === 'success') {
      this.lastSuccessfulJobs.set(job, new Date(completedAt.getTime()));
      this.updateJobGauges(job, completedAt);
    }
  }

  async refreshOutboxAge(now: Date = new Date()): Promise<void> {
    try {
      const finder = this.prisma?.otpDeliveryOutbox?.findFirst;
      if (typeof finder !== 'function') throw new Error('OTP outbox query unavailable');
      const row = await finder.call(this.prisma?.otpDeliveryOutbox, {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, nextAttemptAt: true },
      });
      if (!row) {
        this.application.setGauge('imeal_otp_outbox_oldest_age_seconds', {}, 0);
      } else {
        const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
        const nextAttemptAt =
          row.nextAttemptAt instanceof Date
            ? row.nextAttemptAt
            : new Date(row.nextAttemptAt);
        if (
          !isValidDate(createdAt) ||
          !isValidDate(nextAttemptAt) ||
          createdAt.getTime() > now.getTime()
        ) {
          throw new Error('OTP outbox timestamp is invalid');
        }
        this.application.setGauge(
          'imeal_otp_outbox_oldest_age_seconds',
          {},
          (now.getTime() - createdAt.getTime()) / 1000,
        );
      }
      this.collectorFailures.delete('imeal_otp_outbox_oldest_age_seconds');
    } catch {
      this.application.removeSeries('imeal_otp_outbox_oldest_age_seconds', {});
      this.collectorFailures.add('imeal_otp_outbox_oldest_age_seconds');
    }
  }

  /**
   * Refreshes M12/M13 from persisted JobRun records where they exist. Jobs with
   * no JobRun model use only an observed successful lifecycle completion.
   */
  async refreshJobHistory(now: Date = new Date()): Promise<void> {
    for (const job of WORKER_METRIC_JOBS) {
      if (DB_JOB_HISTORY.has(job)) {
        const failureKey = `worker_job_history:${job}`;
        try {
          const finder = this.prisma?.jobRun?.findFirst;
          if (typeof finder !== 'function') throw new Error('JobRun query unavailable');
          const row = await finder.call(this.prisma?.jobRun, {
            where: { jobName: { startsWith: jobRunPrefix(job) }, status: 'COMPLETED' },
            orderBy: { completedAt: 'desc' },
            select: { completedAt: true },
          });
          const completedAt = row?.completedAt;
          if (completedAt === undefined || completedAt === null) {
            this.lastSuccessfulJobs.delete(job);
            this.application.removeSeries(
              'imeal_worker_job_last_success_timestamp_seconds',
              { job },
            );
            this.application.removeSeries('imeal_worker_job_lag_seconds', { job });
            this.removePublishedWorkerJob(job);
            // Missing history is an explicit unknown, not a fabricated zero.
          } else if (
            !isValidDate(completedAt) ||
            completedAt.getTime() > now.getTime()
          ) {
            throw new Error('JobRun completion timestamp is invalid');
          } else {
            this.lastSuccessfulJobs.set(job, new Date(completedAt.getTime()));
          }
          this.collectorFailures.delete(failureKey);
        } catch {
          this.collectorFailures.add(failureKey);
        }
      }
      const completedAt = this.lastSuccessfulJobs.get(job);
      if (completedAt) this.updateJobGauges(job, completedAt, now);
    }
  }

  setWorkerApplicationMetadata(metadata: MetricSnapshotMetadata): void {
    if (metadata.source !== 'worker_application') {
      throw new Error('Worker application metadata has an invalid source');
    }
    this.workerMetadata = metadata;
  }
  configureWorkerApplicationMetadataFromEnvironment(): boolean {
    const release = process.env.RELEASE_VERSION?.trim();
    const digest = process.env.WORKER_METRICS_EVIDENCE_DIGEST?.trim();
    if (!release || !digest || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
      return false;
    }
    const observedAt = new Date().toISOString();
    this.setWorkerApplicationMetadata({
      source: 'worker_application',
      observedAt,
      freshness: 'fresh',
      evidence: {
        release,
        source: 'worker_application',
        observedAt,
        contractRevision: '2026-09-30',
        freshness: 'fresh',
        sha256Digest: digest,
        retryPolicyRevision: 'retry-policy-v1',
        failureTaxonomyRevision: 'failure-taxonomy-v1',
        jobTaxonomyRevision: 'job-taxonomy-v1',
        querySchemaRevision: 'query-schema-v1',
        scheduleRevision: 'schedule-v1',
      },
    });
    return true;
  }

  createWorkerApplicationSnapshot(
    metadata: MetricSnapshotMetadata = this.workerMetadata as MetricSnapshotMetadata,
  ): MetricSourceSnapshot {
    if (!metadata) throw new Error('Worker application metadata is required');
    return this.application.createApplicationSnapshot('worker_application', metadata);
  }

  acceptWorkerApplicationSnapshot(snapshot: MetricSourceSnapshot): void {
    if (snapshot.source !== 'worker_application') {
      throw new Error('Worker application snapshot source is invalid');
    }
    this.replaceAggregateSnapshot(snapshot);
  }
  acceptApiApplicationSnapshot(snapshot: MetricSourceSnapshot): void {
    if (snapshot.source !== 'api_application') {
      throw new Error('API application snapshot source is invalid');
    }
    this.replaceAggregateSnapshot(snapshot);
  }
  acceptAuthoritativeSnapshot(snapshot: MetricSourceSnapshot): void {
    if (
      snapshot.source !== 'postgres_authoritative' &&
      snapshot.source !== 'object_storage_authoritative' &&
      snapshot.source !== 'backup_restore_evidence' &&
      snapshot.source !== 'security_boundary_evidence'
    ) {
      throw new Error('Authoritative metric snapshot source is invalid');
    }
    this.replaceAggregateSnapshot(snapshot);
    this.collectorFailures.delete(`authoritative:${snapshot.source}`);
  }
  acceptAuthoritativeFailure(
    source: AuthoritativeSourceIdentity,
    _freshness: MetricFreshness,
    _reason: AuthoritativeMetricsFailureReason,
  ): void {
    if (
      source !== 'postgres_authoritative' &&
      source !== 'object_storage_authoritative' &&
      source !== 'backup_restore_evidence' &&
      source !== 'security_boundary_evidence'
    ) {
      throw new Error('Authoritative metric source is invalid');
    }
    this.collectorFailures.add(`authoritative:${source}`);
  }

  /** Publish local worker observations into the endpoint aggregate. */
  publishWorkerApplicationSnapshot(
    metadata?: MetricSnapshotMetadata,
  ): MetricSourceSnapshot {
    const configured = metadata ?? this.workerMetadata;
    if (!configured) throw new Error('Worker application metadata is required');
    const current =
      metadata === undefined
        ? (() => {
            const observedAt = new Date().toISOString();
            return {
              ...configured,
              observedAt,
              evidence: { ...configured.evidence, observedAt },
            };
          })()
        : configured;
    const snapshot = this.createWorkerApplicationSnapshot(current);
    this.acceptWorkerApplicationSnapshot(snapshot);
    return snapshot;
  }

  serializeApplicationMetrics(): string {
    return this.application.serialize();
  }

  getSourceSnapshots(): readonly MetricSourceSnapshot[] {
    return this.aggregate.getSourceSnapshots();
  }

  async getCompleteSnapshot(): Promise<string | null> {
    if (this.prisma) await this.refreshOutboxAge();
    await this.refreshJobHistory();
    if (this.workerMetadata) {
      try {
        this.publishWorkerApplicationSnapshot();
      } catch {
        return null;
      }
    }
    const observedNow = Date.now();
    let agedSource = false;
    const sourceSamples = this.aggregate
      .getSourceSnapshots()
      .flatMap((snapshot) => snapshot.samples)
      .filter((sample) => {
        if (sample.freshness !== 'fresh') return false;
        const row = METRIC_CONTRACT.find(
          (candidate) => candidate.name === sample.metricName,
        );
        const observedAt = Date.parse(sample.observedAt);
        if (
          !row ||
          !Number.isFinite(observedAt) ||
          observedAt > observedNow ||
          observedNow - observedAt > row.staleAfterSeconds * 1000
        ) {
          agedSource = true;
        }
        return true;
      });
    const presentNames = new Set(sourceSamples.map((sample) => sample.metricName));
    const missing = METRIC_CONTRACT.some((row) => !presentNames.has(row.name));
    const missingWorkerJobSeries = WORKER_METRIC_JOBS.some((job) =>
      ['imeal_worker_job_last_success_timestamp_seconds', 'imeal_worker_job_lag_seconds'].some(
        (metricName) =>
          !sourceSamples.some(
            (sample) =>
              sample.metricName === metricName && sample.labels.job === job,
          ),
      ),
    );
    if (
      agedSource ||
      missing ||
      missingWorkerJobSeries ||
      this.collectorFailures.size > 0
    )
      return null;
    try {
      return this.aggregate.serialize();
    } catch {
      return null;
    }
  }

  getMissingMetricNames(): readonly string[] {
    const freshNames = new Set(
      this.aggregate
        .getSourceSnapshots()
        .flatMap((snapshot) => snapshot.samples)
        .filter((sample) => sample.freshness === 'fresh')
        .map((sample) => sample.metricName),
    );
    return Object.freeze(
      [...METRIC_CONTRACT]
        .filter((row) => !freshNames.has(row.name))
        .map((row) => row.name),
    );
  }

  private replaceAggregateSnapshot(snapshot: MetricSourceSnapshot): void {
    const previous = this.aggregate.getSourceSnapshot(snapshot.source);
    const previousBySeries = new Map(
      previous.map((sample) => [sourceSeriesKey(sample), sample]),
    );
    for (const sample of snapshot.samples) {
      const prior = previousBySeries.get(sourceSeriesKey(sample));
      if (
        prior &&
        prior.observedAt === sample.observedAt &&
        sourceSampleSignature(prior) !== sourceSampleSignature(sample)
      ) {
        throw new Error(
          `Conflicting duplicate metric sample: ${sourceSeriesKey(sample)}`,
        );
      }
    }
    this.aggregate.replaceSourceSnapshot(snapshot);
  }

  private removePublishedWorkerJob(job: WorkerMetricJob): void {
    const snapshot = this.aggregate.getSourceSnapshot('worker_application');
    if (snapshot.length === 0) return;
    this.aggregate.replaceSourceSnapshot({
      source: 'worker_application',
      samples: snapshot.filter(
        (sample) =>
          !(
            (sample.metricName ===
              'imeal_worker_job_last_success_timestamp_seconds' ||
              sample.metricName === 'imeal_worker_job_lag_seconds') &&
            sample.labels.job === job
          ),
      ),
    });
  }

  private updateJobGauges(
    job: WorkerMetricJob,
    completedAt: Date,
    now: Date = new Date(),
  ): void {
    this.application.setGauge(
      'imeal_worker_job_last_success_timestamp_seconds',
      { job },
      completedAt.getTime() / 1000,
    );
    const expected = scheduledAt(job, now);
    this.application.setGauge(
      'imeal_worker_job_lag_seconds',
      { job },
      Math.max(0, (expected.getTime() - completedAt.getTime()) / 1000),
    );
  }
}
