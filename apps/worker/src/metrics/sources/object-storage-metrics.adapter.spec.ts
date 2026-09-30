import { describe, expect, it } from 'vitest';
import type { MetricEvidenceMetadata, MetricFreshness } from '@imeal/observability';
import {
  ObjectStorageMetricsAdapter,
  type ObjectStorageMetricsConfig,
  type ObjectStorageMetricsInput,
} from './object-storage-metrics.adapter.js';

const observedAt = '2026-09-30T00:00:00.000Z';
const digest = `sha256:${'b'.repeat(64)}`;
const config: ObjectStorageMetricsConfig = {
  sourceBinding: 'approved_object_storage_source',
  capacitySourceBinding: 'approved_object_storage_capacity_source',
  targetFingerprint: digest,
};

function evidence(freshness: MetricFreshness = 'fresh'): MetricEvidenceMetadata {
  return {
    release: 'release-test',
    source: 'object_storage_authoritative',
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    targetFingerprint: digest,
    sourceBinding: config.sourceBinding,
    capacitySourceBinding: config.capacitySourceBinding,
    operationTaxonomyRevision: 'operation-taxonomy-v1',
  };
}

function input(overrides: Partial<ObjectStorageMetricsInput> = {}): ObjectStorageMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence(),
    targetScope: 'imeal_private_storage',
    usableCapacityBytes: 4096,
    operationErrors: [
      { operation: 'health', count: 1 },
      { operation: 'read', count: 2 },
      { operation: 'write', count: 3 },
    ],
    ...overrides,
  };
}

describe('ObjectStorageMetricsAdapter', () => {
  it('maps private capacity and bounded operation telemetry without upload substitution', () => {
    const result = new ObjectStorageMetricsAdapter(config).collect(input());

    expect(result).toMatchObject({
      source: 'object_storage_authoritative',
      freshness: 'fresh',
      snapshot: { source: 'object_storage_authoritative' },
    });
    expect(result.snapshot?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'imeal_object_storage_capacity_bytes',
          value: 4096,
          labels: {},
        }),
        expect.objectContaining({
          metricName: 'imeal_object_storage_errors_total',
          labels: { operation: 'health' },
          value: 1,
        }),
        expect.objectContaining({
          metricName: 'imeal_object_storage_errors_total',
          labels: { operation: 'write' },
          value: 3,
        }),
      ]),
    );
  });

  it('returns collector_failure for missing configuration or source records', () => {
    expect(new ObjectStorageMetricsAdapter().collect(input())).toEqual({
      source: 'object_storage_authoritative',
      freshness: 'collector_failure',
      reason: 'configuration_missing',
    });
    expect(new ObjectStorageMetricsAdapter(config).collect()).toMatchObject({
      source: 'object_storage_authoritative',
      freshness: 'collector_failure',
      reason: 'source_unavailable',
    });
  });

  it('accepts zero capacity as a real source value but rejects negative and unbounded errors', () => {
    expect(
      new ObjectStorageMetricsAdapter(config).collect(input({ usableCapacityBytes: 0 })),
    ).toMatchObject({ freshness: 'fresh', snapshot: expect.any(Object) });
    expect(
      new ObjectStorageMetricsAdapter(config).collect(input({ usableCapacityBytes: -1 })),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
    expect(
      new ObjectStorageMetricsAdapter(config).collect(
        input({ operationErrors: [{ operation: 'write', count: Number.POSITIVE_INFINITY }] }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
  });

  it('rejects API upload outcomes and public endpoint-like records', () => {
    const result = new ObjectStorageMetricsAdapter(config).collect(
      input({
        apiUploadResult: 'success',
        publicEndpoint: 'https://public-storage.invalid',
      } as unknown as Partial<ObjectStorageMetricsInput>),
    );

    expect(result).toMatchObject({
      freshness: 'collector_failure',
      reason: 'source_malformed',
    });
  });

  it('preserves stale freshness on valid private source observations', () => {
    const result = new ObjectStorageMetricsAdapter(config).collect(
      input({ freshness: 'stale', evidence: evidence('stale') }),
    );

    expect(result.freshness).toBe('stale');
    expect(result.snapshot?.samples.every((sample) => sample.freshness === 'stale')).toBe(true);
  });
});
