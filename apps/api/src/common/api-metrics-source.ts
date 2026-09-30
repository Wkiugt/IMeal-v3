import type { MetricFreshness } from '@imeal/observability';
import type { ApiMetricsService } from './metrics.service.js';

export const API_METRICS_SOURCE = 'api_application' as const;

export interface ApiMetricsSourceSnapshot {
  readonly source: typeof API_METRICS_SOURCE;
  readonly freshness: MetricFreshness;
  readonly payload?: string;
  readonly reason?: 'sink_unavailable' | 'sink_rejected';
}

export interface WorkerMetricsAggregator {
  acceptApiApplicationSnapshot(
    snapshot: ApiMetricsSourceSnapshot,
  ): Promise<void> | void;
}

export class ApiMetricsSourceAdapter {
  constructor(private readonly aggregator?: WorkerMetricsAggregator) {}

  async flush(metrics: ApiMetricsService): Promise<ApiMetricsSourceSnapshot> {
    if (!this.aggregator) {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_unavailable',
      };
    }

    const snapshot: ApiMetricsSourceSnapshot = {
      source: API_METRICS_SOURCE,
      freshness: 'fresh',
      payload: metrics.serialize(),
    };
    try {
      await this.aggregator.acceptApiApplicationSnapshot(snapshot);
      return snapshot;
    } catch {
      return {
        source: API_METRICS_SOURCE,
        freshness: 'collector_failure',
        reason: 'sink_rejected',
      };
    }
  }
}
