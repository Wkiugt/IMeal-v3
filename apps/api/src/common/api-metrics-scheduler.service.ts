import { Inject, Injectable, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  APPLICATION_OBSERVATION_INTERVAL_SECONDS,
  type ApplicationSnapshotMetadata,
} from '@imeal/observability';
import { ApiMetricsService } from './metrics.service.js';
import {
  ApiMetricsSourceAdapter,
  type ApiMetricsSourceSnapshot,
} from './api-metrics-source.js';
import {
  API_METRICS_EVIDENCE_DIGEST_ENV,
  API_METRICS_EVIDENCE_DIGEST_PATTERN,
} from '../config/environment.js';
import { ShutdownCoordinator } from './shutdown-coordinator.js';

export { API_METRICS_EVIDENCE_DIGEST_ENV };

export const API_METRICS_OBSERVATION_TIMEOUT_MS = 5_000;
export const API_METRICS_SCHEDULER_ENVIRONMENT = Symbol(
  'API_METRICS_SCHEDULER_ENVIRONMENT',
);

export interface ApiMetricsSchedulerSource {
  flush(
    metrics: ApiMetricsService,
    metadata?: ApplicationSnapshotMetadata,
    signal?: AbortSignal,
  ): Promise<ApiMetricsSourceSnapshot>;
}

const RELEASE_PATTERN = /^release-[a-z0-9][a-z0-9.-]{0,63}$/;
const API_ROUTE_TAXONOMY_REVISION = 'route-taxonomy-v1';
const API_BUCKET_REVISION = 'bucket-v1';
const API_RESULT_TAXONOMY_REVISION = 'result-taxonomy-v1';
const API_IDEMPOTENCY_BRANCH_REVISION = 'idempotency-branch-v1';

function metadataForAttempt(
  environment: NodeJS.ProcessEnv,
): ApplicationSnapshotMetadata | undefined {
  const release = environment.RELEASE_VERSION?.trim();
  const digest = environment[API_METRICS_EVIDENCE_DIGEST_ENV]?.trim();
  if (
    !release ||
    !RELEASE_PATTERN.test(release) ||
    !digest ||
    !API_METRICS_EVIDENCE_DIGEST_PATTERN.test(digest)
  ) {
    return undefined;
  }

  const observedAt = new Date().toISOString();
  return {
    source: 'api_application',
    observedAt,
    freshness: 'fresh',
    evidence: {
      release,
      source: 'api_application',
      observedAt,
      contractRevision: '2026-09-30',
      freshness: 'fresh',
      sha256Digest: digest,
      routeTaxonomyRevision: API_ROUTE_TAXONOMY_REVISION,
      bucketRevision: API_BUCKET_REVISION,
      resultTaxonomyRevision: API_RESULT_TAXONOMY_REVISION,
      idempotencyBranchRevision: API_IDEMPOTENCY_BRANCH_REVISION,
    },
  };
}

@Injectable()
export class ApiMetricsSchedulerService {
  private flushInFlight = false;

  constructor(
    private readonly metrics: ApiMetricsService,
    @Inject(ApiMetricsSourceAdapter)
    private readonly source: ApiMetricsSchedulerSource,
    @Optional() private readonly shutdown?: ShutdownCoordinator,
    @Optional()
    @Inject(API_METRICS_SCHEDULER_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  onModuleInit(): void {
    void this.flushOnce().catch(() => undefined);
  }

  @Interval(APPLICATION_OBSERVATION_INTERVAL_SECONDS * 1000)
  async handlePeriodicFlush(): Promise<void> {
    await this.flushOnce();
  }

  async flushOnce(): Promise<ApiMetricsSourceSnapshot | undefined> {
    if (this.flushInFlight) return undefined;
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) return undefined;

    const metadata = metadataForAttempt(this.environment);
    if (!metadata) {
      release?.();
      return undefined;
    }

    this.flushInFlight = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finalized = false;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout as ReturnType<typeof setTimeout>);
      this.flushInFlight = false;
      release?.();
    };
    const underlying = Promise.resolve()
      .then(() => this.source.flush(this.metrics, metadata, controller.signal))
      .then(
        (result) => {
          finalize();
          return result;
        },
        () => {
          finalize();
          return undefined;
        },
      );
    try {
      const timeoutPromise = new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, API_METRICS_OBSERVATION_TIMEOUT_MS);
      });
      return await Promise.race([underlying, timeoutPromise]);
    } catch {
      finalize();
      return undefined;
    }
  }
}
