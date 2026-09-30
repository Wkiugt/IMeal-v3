import {
  type ApplicationSnapshotMetadata,
  type MetricFreshness,
  type MetricSourceSnapshot,
  validateMetricSnapshotMetadata,
} from '@imeal/observability';
import type { ApiMetricsService } from './metrics.service.js';

export const API_METRICS_SOURCE = 'api_application' as const;

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
  ): Promise<void> | void;
}

export class ApiMetricsSourceAdapter {
  constructor(private readonly aggregator?: WorkerMetricsAggregator) {}

  async flush(
    metrics: ApiMetricsService,
    metadata?: ApplicationSnapshotMetadata,
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

    try {
      await this.aggregator.acceptApiApplicationSnapshot(snapshot);
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
