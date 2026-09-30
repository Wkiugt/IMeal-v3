import {
  APPLICATION_SNAPSHOT_TRANSPORT_PATH,
  WORKER_METRICS_TRANSPORT_TOKEN_ENV,
  WORKER_METRICS_TRANSPORT_URL_ENV,
  type ApplicationSnapshotMetadata,
  type MetricFreshness,
  type MetricSourceSnapshot,
  validateMetricSnapshotMetadata,
} from '@imeal/observability';
import type { ApiMetricsService } from './metrics.service.js';

export const API_METRICS_SOURCE = 'api_application' as const;
type SnapshotTransportResponse = Pick<Response, 'ok' | 'status'>;
type SnapshotTransportRequest = (
  input: string,
  init: RequestInit,
) => Promise<SnapshotTransportResponse>;

type ApiMetricsFailureReason =
  | 'sink_unavailable'
  | 'sink_rejected'
  | 'metadata_missing'
  | 'snapshot_invalid'
  | 'snapshot_empty';

export interface ApiMetricsSourceSnapshot {
  readonly source: typeof API_METRICS_SOURCE;
  readonly freshness: MetricFreshness;
  readonly snapshot?: MetricSourceSnapshot;
  readonly reason?: ApiMetricsFailureReason;
}

export interface WorkerMetricsAggregator {
  acceptApiApplicationSnapshot(
    snapshot: MetricSourceSnapshot,
    signal?: AbortSignal,
  ): Promise<void> | void;
  isAvailable?(): boolean;
}

function isConfiguredTransportUrl(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === APPLICATION_SNAPSHOT_TRANSPORT_PATH
    );
  } catch {
    return false;
  }
}

export class WorkerMetricsHttpAggregator implements WorkerMetricsAggregator {
  private readonly request: SnapshotTransportRequest;
  private readonly configured: boolean;

  constructor(
    private readonly endpoint: string | undefined = process.env[
      WORKER_METRICS_TRANSPORT_URL_ENV
    ],
    private readonly token: string | undefined = process.env[
      WORKER_METRICS_TRANSPORT_TOKEN_ENV
    ],
    request: SnapshotTransportRequest = (input, init) =>
      fetch(input, init),
  ) {
    this.request = request;
    this.configured = isConfiguredTransportUrl(endpoint) && Boolean(token?.trim());
  }

  isAvailable(): boolean {
    return this.configured;
  }

  async acceptApiApplicationSnapshot(
    snapshot: MetricSourceSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.configured || !this.endpoint || !this.token) {
      throw new Error('Worker metrics transport is unavailable');
    }
    const response = await this.request(this.endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(snapshot),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Worker metrics transport rejected (${response.status})`);
    }
  }
}

export function createWorkerMetricsHttpAggregator(
  env: NodeJS.ProcessEnv = process.env,
): WorkerMetricsHttpAggregator {
  return new WorkerMetricsHttpAggregator(
    env[WORKER_METRICS_TRANSPORT_URL_ENV],
    env[WORKER_METRICS_TRANSPORT_TOKEN_ENV],
  );
}

export class ApiMetricsSourceAdapter {
  constructor(private readonly aggregator?: WorkerMetricsAggregator) {}

  async flush(
    metrics: ApiMetricsService,
    metadata?: ApplicationSnapshotMetadata,
    signal?: AbortSignal,
  ): Promise<ApiMetricsSourceSnapshot> {
    let validatedMetadata: ApplicationSnapshotMetadata;
    try {
      validatedMetadata = validateMetricSnapshotMetadata(
        metadata,
        API_METRICS_SOURCE,
      );
    } catch {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'metadata_missing',
      };
    }

    let snapshot: MetricSourceSnapshot;
    try {
      snapshot = metrics.createApplicationSnapshot(validatedMetadata);
    } catch {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'snapshot_invalid',
      };
    }
    if (snapshot.samples.length === 0) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'snapshot_empty',
      };
    }
    if (!this.aggregator) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_unavailable',
      };
    }
    if (
      this.aggregator.isAvailable &&
      !this.aggregator.isAvailable()
    ) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_unavailable',
      };
    }
    try {
      await this.aggregator.acceptApiApplicationSnapshot(snapshot, signal);
      return {
        source: API_METRICS_SOURCE,
        freshness: validatedMetadata.freshness,
        snapshot,
      };
    } catch {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_rejected',
      };
    }
  }
}
