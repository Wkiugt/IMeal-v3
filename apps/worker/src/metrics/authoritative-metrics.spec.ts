import { describe, expect, it, vi } from 'vitest';
import type {
  MetricEvidenceMetadata,
  MetricSourceSnapshot,
} from '@imeal/observability';
import {
  authoritativeResult,
  createAuthoritativeSample,
  publishAuthoritativeSnapshot,
  type AuthoritativeMetricsResult,
  type AuthoritativeSnapshotSink,
} from './authoritative-metrics.js';
describe('authoritative metrics boundary', () => {
  it('publishes only approved authoritative snapshots through the worker sink', async () => {
    const sink: AuthoritativeSnapshotSink = {
      acceptAuthoritativeSnapshot: vi.fn(),
    };
    const snapshot: MetricSourceSnapshot = {
      source: 'postgres_authoritative',
      samples: [],
    };
    const result: AuthoritativeMetricsResult = {
      source: 'postgres_authoritative',
      freshness: 'fresh',
      snapshot,
    };

    await expect(publishAuthoritativeSnapshot(result, sink)).resolves.toEqual(result);
    expect(sink.acceptAuthoritativeSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('fails closed when a required source result has no snapshot', async () => {
    const sink: AuthoritativeSnapshotSink = {
      acceptAuthoritativeSnapshot: vi.fn(),
    };
    const result: AuthoritativeMetricsResult = {
      source: 'postgres_authoritative',
      freshness: 'collector_failure',
      reason: 'source_unavailable',
    };

    await expect(publishAuthoritativeSnapshot(result, sink)).resolves.toEqual(result);
    expect(sink.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
  });
  it('records failed source state at the worker boundary instead of retaining an old value', async () => {
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const result: AuthoritativeMetricsResult = {
      source: 'postgres_authoritative',
      freshness: 'collector_failure',
      reason: 'source_unavailable',
    };

    await expect(publishAuthoritativeSnapshot(result, sink)).resolves.toEqual(result);
    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'source_unavailable',
    );
  });
  it('deduplicates identical source series and rejects conflicting duplicates', () => {
    const observedAt = '2026-09-30T00:00:00.000Z';
    const digest = `sha256:${'a'.repeat(64)}`;
    const evidence: MetricEvidenceMetadata = {
      release: 'release-test',
      source: 'postgres_authoritative',
      observedAt,
      contractRevision: '2026-09-30',
      freshness: 'fresh',
      sha256Digest: digest,
      sourceKind: 'authoritative',
      targetFingerprint: digest,
      querySchemaRevision: 'query-schema-v1',
      queryExporterBinding: 'approved_postgres_query_or_exporter',
      sourceBinding: 'approved_postgres_source',
    };
    const sample = createAuthoritativeSample({
      metricName: 'imeal_postgres_transaction_errors_total',
      labels: {},
      value: 1,
      observedAt,
      source: 'postgres_authoritative',
      freshness: 'fresh',
      evidence,
    });

    expect(authoritativeResult('postgres_authoritative', 'fresh', [sample, sample])).toMatchObject({
      freshness: 'fresh',
      snapshot: { samples: [sample] },
    });
    expect(
      authoritativeResult('postgres_authoritative', 'fresh', [
        sample,
        { ...sample, value: 2 },
      ]),
    ).toMatchObject({
      freshness: 'collector_failure',
      reason: 'snapshot_invalid',
    });
  });
  it('rejects a result and snapshot source mismatch before invoking the sink', async () => {
    const sink: AuthoritativeSnapshotSink = {
      acceptAuthoritativeSnapshot: vi.fn(),
    };
    const result: AuthoritativeMetricsResult = {
      source: 'postgres_authoritative',
      freshness: 'fresh',
      snapshot: {
        source: 'security_boundary_evidence',
        samples: [],
      },
    };

    await expect(publishAuthoritativeSnapshot(result, sink)).resolves.toEqual({
      source: 'postgres_authoritative',
      freshness: 'collector_failure',
      reason: 'snapshot_invalid',
    });
    expect(sink.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
  });

  it('reports a rejected worker boundary without exposing the source error', async () => {
    const result: AuthoritativeMetricsResult = {
      source: 'security_boundary_evidence',
      freshness: 'fresh',
      snapshot: { source: 'security_boundary_evidence', samples: [] },
    };
    const sink: AuthoritativeSnapshotSink = {
      acceptAuthoritativeSnapshot: vi
        .fn()
        .mockRejectedValue(new Error('Bearer secret-not-output')),
    };

    await expect(publishAuthoritativeSnapshot(result, sink)).resolves.toMatchObject({
      source: 'security_boundary_evidence',
      freshness: 'collector_failure',
      reason: 'sink_rejected',
    });
    expect(JSON.stringify(await publishAuthoritativeSnapshot(result, sink))).not.toContain(
      'secret-not-output',
    );
  });
});
