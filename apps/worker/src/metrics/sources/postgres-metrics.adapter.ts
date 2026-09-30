import type {
  MetricEvidenceMetadata,
  MetricFreshness,
} from '@imeal/observability';
import {
  authoritativeFailure,
  authoritativeResult,
  AUTHORITATIVE_CONTRACT_REVISION,
  createAuthoritativeSample,
  hasOnlyKeys,
  isCanonicalTimestamp,
  isFiniteNonnegative,
  isSha256Digest,
  type AuthoritativeMetricsResult,
} from '../authoritative-metrics.js';

export interface PostgresMetricsConfig {
  readonly sourceBinding: string;
  readonly queryExporterBinding: string;
  readonly targetFingerprint: string;
}

export interface PostgresConnectionUsageRecord {
  readonly pool: 'pgbouncer_client' | 'postgres_backend';
  readonly usedConnections: number;
  readonly configuredMaximum: number;
}

export interface PostgresMetricsInput {
  readonly observedAt: string;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
  readonly targetScope: 'imeal_postgres';
  readonly connectionUsage?: readonly PostgresConnectionUsageRecord[];
  readonly transactionErrors?: number;
  readonly lockWaits?: number;
  readonly diskUsedBytes?: number;
  readonly diskCapacityBytes?: number;
}

const SOURCE = 'postgres_authoritative' as const;
const SOURCE_BINDING = 'approved_postgres_source';
const QUERY_EXPORTER_BINDING = 'approved_postgres_query_or_exporter';

export class PostgresMetricsAdapter {
  constructor(private readonly config?: PostgresMetricsConfig) {}

  collect(input?: PostgresMetricsInput): AuthoritativeMetricsResult {
    if (!this.validConfig()) {
      return authoritativeFailure(SOURCE, 'collector_failure', 'configuration_missing');
    }
    if (!input) {
      return authoritativeFailure(SOURCE, 'collector_failure', 'source_unavailable');
    }
    try {
      this.validateInput(input);
      if (input.freshness === 'unknown' || input.freshness === 'collector_failure') {
        return authoritativeFailure(SOURCE, input.freshness, 'source_unavailable');
      }
      const samples = [
        ...(input.connectionUsage ?? []).map((record) =>
          createAuthoritativeSample({
            metricName: 'imeal_postgres_connection_usage_ratio',
            labels: { pool: record.pool },
            value: record.usedConnections / record.configuredMaximum,
            observedAt: input.observedAt,
            source: SOURCE,
            freshness: input.freshness,
            evidence: input.evidence,
          }),
        ),
        createAuthoritativeSample({
          metricName: 'imeal_postgres_transaction_errors_total',
          labels: {},
          value: input.transactionErrors!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
        createAuthoritativeSample({
          metricName: 'imeal_postgres_lock_waits_total',
          labels: {},
          value: input.lockWaits!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
        createAuthoritativeSample({
          metricName: 'imeal_postgres_disk_usage_ratio',
          labels: {},
          value: input.diskUsedBytes! / input.diskCapacityBytes!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
      ];
      return authoritativeResult(SOURCE, input.freshness, samples);
    } catch {
      return authoritativeFailure(SOURCE, 'collector_failure', 'source_malformed');
    }
  }

  private validConfig(): boolean {
    const config = this.config;
    return Boolean(
      config &&
        config.sourceBinding === SOURCE_BINDING &&
        config.queryExporterBinding === QUERY_EXPORTER_BINDING &&
        isSha256Digest(config.targetFingerprint),
    );
  }

  private validateInput(input: PostgresMetricsInput): void {
    if (
      !hasOnlyKeys(input, [
        'observedAt',
        'freshness',
        'evidence',
        'targetScope',
        'connectionUsage',
        'transactionErrors',
        'lockWaits',
        'diskUsedBytes',
        'diskCapacityBytes',
      ]) ||
      !isCanonicalTimestamp(input.observedAt) ||
      input.targetScope !== 'imeal_postgres' ||
      !input.evidence ||
      input.evidence.source !== SOURCE ||
      input.evidence.observedAt !== input.observedAt ||
      input.evidence.freshness !== input.freshness ||
      input.evidence.contractRevision !== AUTHORITATIVE_CONTRACT_REVISION ||
      input.evidence.sourceKind !== 'authoritative' ||
      input.evidence.sourceBinding !== this.config?.sourceBinding ||
      input.evidence.queryExporterBinding !== this.config?.queryExporterBinding ||
      input.evidence.targetFingerprint !== this.config?.targetFingerprint
    ) {
      throw new Error('postgres source input is malformed');
    }
    if (!['fresh', 'stale', 'unknown', 'collector_failure'].includes(input.freshness)) {
      throw new Error('postgres freshness is malformed');
    }
    if (
      !Array.isArray(input.connectionUsage) ||
      input.connectionUsage.length !== 2 ||
      !input.connectionUsage.every((record) => {
        if (
          !hasOnlyKeys(record, ['pool', 'usedConnections', 'configuredMaximum']) ||
          !['pgbouncer_client', 'postgres_backend'].includes(record.pool) ||
          !isFiniteNonnegative(record.usedConnections) ||
          !Number.isFinite(record.configuredMaximum) ||
          record.configuredMaximum <= 0 ||
          record.usedConnections > record.configuredMaximum
        ) {
          return false;
        }
        return true;
      }) ||
      new Set(input.connectionUsage.map((record) => record.pool)).size !== 2 ||
      !isFiniteNonnegative(input.transactionErrors) ||
      !isFiniteNonnegative(input.lockWaits) ||
      !isFiniteNonnegative(input.diskUsedBytes) ||
      !isFiniteNonnegative(input.diskCapacityBytes) ||
      input.diskCapacityBytes <= 0 ||
      input.diskUsedBytes > input.diskCapacityBytes
    ) {
      throw new Error('postgres source record is malformed');
    }
  }
}
