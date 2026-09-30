import { describe, expect, it } from 'vitest';
import type { MetricEvidenceMetadata, MetricFreshness } from '@imeal/observability';
import {
  SecurityBoundaryMetricsAdapter,
  type SecurityBoundaryMetricsConfig,
  type SecurityBoundaryMetricsInput,
} from './security-boundary-metrics.adapter.js';

const observedAt = '2026-09-30T00:00:00.000Z';
const digest = `sha256:${'f'.repeat(64)}`;
const config: SecurityBoundaryMetricsConfig = {
  sourceBinding: 'approved_security_boundary_source',
  securityTaxonomyRevision: 'security-taxonomy-v1',
  deduplicationWindow: 'PT1M',
};

function evidence(freshness: MetricFreshness = 'fresh'): MetricEvidenceMetadata {
  return {
    release: 'release-test',
    source: 'security_boundary_evidence',
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    securityTaxonomyRevision: config.securityTaxonomyRevision,
    deduplicationWindow: config.deduplicationWindow,
  };
}

function input(overrides: Partial<SecurityBoundaryMetricsInput> = {}): SecurityBoundaryMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence(),
    violations: [
      {
        category: 'invalid_tls',
        eventDigest: `sha256:${'1'.repeat(64)}`,
      },
      {
        category: 'waf_or_rate_limit_violation',
        eventDigest: `sha256:${'2'.repeat(64)}`,
      },
      {
        category: 'waf_or_rate_limit_violation',
        eventDigest: `sha256:${'2'.repeat(64)}`,
      },
    ],
    ...overrides,
  };
}

describe('SecurityBoundaryMetricsAdapter', () => {
  it('maps independent taxonomy events and deduplicates the same observation', () => {
    const result = new SecurityBoundaryMetricsAdapter(config).collect(input());

    expect(result).toMatchObject({
      source: 'security_boundary_evidence',
      freshness: 'fresh',
      snapshot: { source: 'security_boundary_evidence' },
    });
    expect(result.snapshot?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'imeal_security_boundary_violations_total',
          labels: { category: 'invalid_tls' },
          value: 1,
        }),
        expect.objectContaining({
          metricName: 'imeal_security_boundary_violations_total',
          labels: { category: 'waf_or_rate_limit_violation' },
          value: 1,
        }),
      ]),
    );
  });
  it('rejects one digest reused for different categories instead of overwriting it', () => {
    const digest = `sha256:${'9'.repeat(64)}`;
    const result = new SecurityBoundaryMetricsAdapter(config).collect(
      input({
        violations: [
          { category: 'invalid_tls', eventDigest: digest },
          { category: 'unexpected_cors_origin', eventDigest: digest },
        ],
      }),
    );

    expect(result).toMatchObject({
      freshness: 'collector_failure',
      reason: 'source_malformed',
    });
  });

  it('treats an explicitly valid empty fresh feed as real zero observations', () => {
    const result = new SecurityBoundaryMetricsAdapter(config).collect(
      input({ violations: [] }),
    );

    expect(result).toMatchObject({
      source: 'security_boundary_evidence',
      freshness: 'fresh',
      snapshot: { source: 'security_boundary_evidence' },
    });
    expect(result.snapshot?.samples).toHaveLength(6);
    expect(result.snapshot?.samples.every((sample) => sample.value === 0)).toBe(true);
  });

  it('returns collector_failure when the independent source is missing or unavailable', () => {
    expect(new SecurityBoundaryMetricsAdapter(config).collect()).toEqual({
      source: 'security_boundary_evidence',
      freshness: 'collector_failure',
      reason: 'source_unavailable',
    });
    expect(new SecurityBoundaryMetricsAdapter().collect(input())).toEqual({
      source: 'security_boundary_evidence',
      freshness: 'collector_failure',
      reason: 'configuration_missing',
    });
  });

  it('rejects application request errors, unsafe categories, and malformed event digests', () => {
    expect(
      new SecurityBoundaryMetricsAdapter(config).collect(
        input({ applicationRequestErrors: 2 } as unknown as Partial<SecurityBoundaryMetricsInput>),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
    expect(
      new SecurityBoundaryMetricsAdapter(config).collect(
        input({
          violations: [
            {
              category: 'database_timeout',
              eventDigest: `sha256:${'3'.repeat(64)}`,
            },
          ],
        } as unknown as Partial<SecurityBoundaryMetricsInput>),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
    expect(
      new SecurityBoundaryMetricsAdapter(config).collect(
        input({
          violations: [
            { category: 'invalid_tls', eventDigest: 'Bearer secret-not-output' },
          ],
        }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'source_malformed' });
  });

  it('preserves stale source state and never emits event identity labels', () => {
    const result = new SecurityBoundaryMetricsAdapter(config).collect(
      input({ freshness: 'stale', evidence: evidence('stale') }),
    );

    expect(result.freshness).toBe('stale');
    expect(result.snapshot?.samples.every((sample) => sample.freshness === 'stale')).toBe(true);
    expect(JSON.stringify(result.snapshot)).not.toContain('eventDigest');
  });
});
