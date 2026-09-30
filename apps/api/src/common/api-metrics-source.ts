import type {
  ApplicationSnapshotMetadata,
  MetricFreshness,
  MetricSourceSnapshot,
} from '@imeal/observability';
import type { ApiMetricsService } from './metrics.service.js';

export const API_METRICS_SOURCE = 'api_application' as const;

type ApiMetricsFailureReason =
  | 'sink_unavailable'
  | 'sink_rejected'
  | 'metadata_missing'
  | 'snapshot_invalid';

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

const FRESHNESS_STATES = new Set<MetricFreshness>([
  'fresh',
  'stale',
  'unknown',
  'collector_failure',
]);

function hasRequiredMetadata(
  metadata: ApplicationSnapshotMetadata | undefined,
): metadata is ApplicationSnapshotMetadata {
  if (!metadata || typeof metadata !== 'object') return false;
  if (
    typeof metadata.observedAt !== 'string' ||
    !FRESHNESS_STATES.has(metadata.freshness) ||
    !metadata.evidence ||
    typeof metadata.evidence !== 'object'
  ) {
    return false;
  }
  const evidence = metadata.evidence as unknown as Record<string, unknown>;
  return [
    'release',
    'source',
    'observedAt',
    'contractRevision',
    'freshness',
    'sha256Digest',
  ].every((key) => typeof evidence[key] === 'string');
}

export class ApiMetricsSourceAdapter {
  constructor(private readonly aggregator?: WorkerMetricsAggregator) {}

  async flush(
    metrics: ApiMetricsService,
    metadata?: ApplicationSnapshotMetadata,
  ): Promise<ApiMetricsSourceSnapshot> {
    if (!this.aggregator) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_unavailable',
      };
    }
    if (!hasRequiredMetadata(metadata)) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'metadata_missing',
      };
    }

    let snapshot: MetricSourceSnapshot;
    try {
      snapshot = metrics.createApplicationSnapshot(metadata);
    } catch {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'snapshot_invalid',
      };
    }

    try {
      await this.aggregator.acceptApiApplicationSnapshot(snapshot);
      return {
        source: API_METRICS_SOURCE,
        freshness: metadata.freshness,
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
