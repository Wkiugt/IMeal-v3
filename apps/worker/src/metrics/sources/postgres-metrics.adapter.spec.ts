import { describe, expect, it } from 'vitest';
import type { MetricEvidenceMetadata, MetricFreshness } from '@imeal/observability';
import {
  PostgresMetricsAdapter,
  type PostgresMetricsConfig,
  type PostgresMetricsInput,
} from './postgres-metrics.adapter.js';

const observedAt = '2026-09-30T00:00:00.000Z';
const digest = `sha256:${'a'.repeat(64)}`;
const config: PostgresMetricsConfig = {
  sourceBinding: 'approved_postgres_source',
  queryExporterBinding: 'approved_postgres_query_or_exporter',
  targetFingerprint: digest,
};

function evidence(freshness: MetricFreshness = 'fresh'): MetricEvidenceMetadata {
  return {
    release: 'release-test',
    source: 'postgres_authoritative',
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    targetFingerprint: digest,
    queryExporterBinding: config.queryExporterBinding,
    sourceBinding: config.sourceBinding,
    querySchemaRevision: 'query-schema-v1',
  };
}

function input(overrides: Partial<PostgresMetricsInput> = {}): PostgresMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence(),
    targetScope: 'imeal_postgres',
    connectionUsage: [
      { pool: 'pgbouncer_client', usedConnections: 20, configuredMaximum: 100 },
      { pool: 'postgres_backend', usedConnections: 4, configuredMaximum: 10 },
    ],
    transactionErrors: 2,
    lockWaits: 3,
    diskUsedBytes: 40,
    diskCapacityBytes: 100,
    ...overrides,
  };
}

describe('PostgresMetricsAdapter', () => {
  it('maps exporter/query records to M14-M17 with fixed pool labels and scope', () => {
    const result = new PostgresMetricsAdapter(config).collect(input());

    expect(result).toMatchObject({
      source: 'postgres_authoritative',
      freshness: 'fresh',
      snapshot: { source: 'postgres_authoritative' },
    });
    expect(result.snapshot?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'imeal_postgres_connection_usage_ratio',
          labels: { pool: 'pgbouncer_client' },
          value: 0.2,
        }),
        expect.objectContaining({
          metricName: 'imeal_postgres_connection_usage_ratio',
          labels: { pool: 'postgres_backend' },
          value: 0.4,
        }),
        expect.objectContaining({
          metricName: 'imeal_postgres_transaction_errors_total',
          value: 2,
        }),
        expect.objectContaining({ metricName: 'imeal_postgres_lock_waits_total', value: 3 }),
        expect.objectContaining({ metricName: 'imeal_postgres_disk_usage_ratio', value: 0.4 }),
      ]),
    );
  });

  it('returns collector_failure without a configured authoritative binding', () => {
    const result = new PostgresMetricsAdapter().collect(input());

    expect(result).toEqual({
      source: 'postgres_authoritative',
      freshness: 'collector_failure',
      reason: 'configuration_missing',
    });
  });

  it('rejects application-only substitutions and malformed source records', () => {
    const malformed = input({
      transactionErrors: undefined,
      lockWaits: undefined,
      diskUsedBytes: undefined,
      diskCapacityBytes: undefined,
      connectionUsage: undefined,
      applicationHttpErrors: 4,
    } as unknown as Partial<PostgresMetricsInput>);

    expect(new PostgresMetricsAdapter(config).collect(malformed)).toMatchObject({
      freshness: 'collector_failure',
      reason: 'source_malformed',
    });
  });

  it('rejects ratios outside [0,1], missing denominators, and negative counters', () => {
    expect(
      new PostgresMetricsAdapter(config).collect(
        input({ connectionUsage: [{ pool: 'pgbouncer_client', usedConnections: 101, configuredMaximum: 100 }] }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
    expect(
      new PostgresMetricsAdapter(config).collect(
        input({ diskCapacityBytes: 0 }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
    expect(
      new PostgresMetricsAdapter(config).collect(
        input({ lockWaits: -1 }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
  });

  it('preserves a stale source state instead of replacing it with a numeric fallback', () => {
    const stale = input({
      freshness: 'stale',
      evidence: evidence('stale'),
    });

    const result = new PostgresMetricsAdapter(config).collect(stale);

    expect(result.freshness).toBe('stale');
    expect(result.snapshot?.samples.every((sample) => sample.freshness === 'stale')).toBe(true);
  });
});
