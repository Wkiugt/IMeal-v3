import { describe, expect, it } from 'vitest';
import {
  METRIC_CONTRACT,
  METRIC_NAMES,
  MetricRegistry,
  escapeMetricLabelValue,
  type MetricSampleEnvelope,
  validateMetricSampleEnvelope,
} from '../src/index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const observedAt = '2026-09-30T00:00:00.000Z';

const revisionValues: Record<string, string> = {
  routeTaxonomyRevision: 'route-taxonomy-v1',
  bucketRevision: 'bucket-v1',
  resultTaxonomyRevision: 'result-taxonomy-v1',
  idempotencyBranchRevision: 'idempotency-branch-v1',
  retryPolicyRevision: 'retry-policy-v1',
  failureTaxonomyRevision: 'failure-taxonomy-v1',
  jobTaxonomyRevision: 'job-taxonomy-v1',
  querySchemaRevision: 'query-schema-v1',
  scheduleRevision: 'schedule-v1',
  operationTaxonomyRevision: 'operation-taxonomy-v1',
  securityTaxonomyRevision: 'security-taxonomy-v1',
};

const sourceBindings: Record<string, string> = {
  api_application: 'approved_api_application_source',
  worker_application: 'approved_worker_application_source',
  postgres_authoritative: 'approved_postgres_source',
  object_storage_authoritative: 'approved_object_storage_source',
  backup_restore_evidence: 'approved_backup_restore_evidence',
  security_boundary_evidence: 'approved_security_boundary_source',
};

function sample(
  metricName: (typeof METRIC_NAMES)[number],
  freshness: 'fresh' | 'stale' | 'unknown' | 'collector_failure',
  value: number,
): MetricSampleEnvelope {
  const row = METRIC_CONTRACT.find((entry) => entry.name === metricName);
  if (!row) throw new Error(`Unknown test metric ${metricName}`);
  const labels: Record<string, string> = {};
  for (const [key, values] of Object.entries(row.labels))
    labels[key] = values[0];
  const evidence: Record<string, string> = {};
  for (const binding of row.evidence) {
    switch (binding) {
      case 'release':
        evidence[binding] = 'release-test';
        break;
      case 'source':
        evidence[binding] = row.sourceIdentity;
        break;
      case 'observedAt':
      case 'manifestCompletionTimestamp':
        evidence[binding] = observedAt;
        break;
      case 'contractRevision':
        evidence[binding] = '2026-09-30';
        break;
      case 'freshness':
        evidence[binding] = freshness;
        break;
      case 'sha256Digest':
      case 'targetFingerprint':
      case 'manifestDigest':
      case 'rehearsalDigest':
        evidence[binding] = digest;
        break;
      case 'queryExporterBinding':
        evidence[binding] = 'approved_postgres_query_or_exporter';
        break;
      case 'sourceBinding':
        evidence[binding] = sourceBindings[row.sourceIdentity];
        break;
      case 'capacitySourceBinding':
        evidence[binding] = 'approved_object_storage_capacity_source';
        break;
      case 'sourceKind':
        evidence[binding] = row.sourceKind;
        break;
      case 'verificationResult':
        evidence[binding] = 'not_run';
        break;
      case 'deduplicationWindow':
        evidence[binding] = 'PT5M';
        break;
      default:
        evidence[binding] = revisionValues[binding];
    }
  }
  return validateMetricSampleEnvelope({
    metricName,
    type: row.type,
    unit: row.unit,
    labels,
    value,
    observedAt,
    source: row.sourceIdentity,
    freshness,
    evidence,
  });
}

describe('MetricRegistry', () => {
  it('increments counters and replaces gauges without emitting untouched zeros', () => {
    const registry = new MetricRegistry();

    registry.increment('imeal_auth_attempts_total', { result: 'success' });
    registry.increment('imeal_auth_attempts_total', { result: 'success' }, 2);
    registry.setGauge('imeal_otp_outbox_oldest_age_seconds', {}, 7);
    registry.setGauge('imeal_otp_outbox_oldest_age_seconds', {}, 3);

    const output = registry.serialize();
    expect(output).toContain('imeal_auth_attempts_total{result="success"} 3');
    expect(output).toContain('imeal_otp_outbox_oldest_age_seconds 3');
    expect(output).not.toContain('imeal_auth_attempts_total{result="invalid"}');
    expect(output).not.toContain('imeal_postgres_transaction_errors_total 0');
  });

  it('serializes fixed histogram buckets, cumulative counts, sum, and count', () => {
    const registry = new MetricRegistry();
    registry.observeHistogram(
      'imeal_http_request_duration_seconds_bucket',
      { route: 'api', method: 'GET', status: '200' },
      0.01,
    );
    registry.observeHistogram(
      'imeal_http_request_duration_seconds_bucket',
      { route: 'api', method: 'GET', status: '200' },
      3,
    );

    const output = registry.serialize();
    expect(output).toContain(
      '# TYPE imeal_http_request_duration_seconds histogram',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_bucket{method="GET",route="api",status="200",le="0.01"} 1',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_bucket{method="GET",route="api",status="200",le="+Inf"} 2',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_sum{method="GET",route="api",status="200"} 3.01',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_count{method="GET",route="api",status="200"} 2',
    );
  });

  it('produces deterministic output and escapes OpenMetrics label text', () => {
    const first = new MetricRegistry();
    first.increment('imeal_http_requests_total', {
      status: '200',
      route: 'api',
      method: 'GET',
    });
    const second = new MetricRegistry();
    second.increment('imeal_http_requests_total', {
      method: 'GET',
      route: 'api',
      status: '200',
    });

    expect(first.serialize()).toBe(second.serialize());
    expect(escapeMetricLabelValue('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
  });

  it('rejects unknown names, labels, units, invalid values, and sensitive text', () => {
    const registry = new MetricRegistry();
    expect(() => registry.increment('not-approved' as never, {}, 1)).toThrow();
    expect(() =>
      registry.increment('imeal_auth_attempts_total', {
        result: 'success',
        email: 'employee@example.com',
      } as never),
    ).toThrow();
    expect(() =>
      registry.increment(
        'imeal_auth_attempts_total',
        { result: 'success' },
        1,
        'bad-unit' as never,
      ),
    ).toThrow();
    expect(() =>
      registry.setGauge('imeal_postgres_disk_usage_ratio', {}, Number.NaN),
    ).toThrow();
    expect(() =>
      registry.setGauge('imeal_postgres_disk_usage_ratio', {}, 2),
    ).toThrow();
    expect(() =>
      registry.observeHistogram(
        'imeal_http_request_duration_seconds_bucket',
        { route: 'api', method: 'GET', status: '200' },
        -1,
      ),
    ).toThrow();
  });

  it('resets process-local application state when a new registry is constructed', () => {
    const running = new MetricRegistry();
    running.increment('imeal_otp_delivery_total');
    expect(running.serialize()).toContain('imeal_otp_delivery_total 1');

    const restarted = new MetricRegistry();
    expect(restarted.serialize()).not.toContain('imeal_otp_delivery_total');
  });

  it('merges and replaces source snapshots while preserving freshness states', () => {
    const registry = new MetricRegistry();
    const stale = sample('imeal_postgres_disk_usage_ratio', 'stale', 0.4);
    const unknown = sample(
      'imeal_postgres_transaction_errors_total',
      'unknown',
      0,
    );
    const failed = sample(
      'imeal_postgres_lock_waits_total',
      'collector_failure',
      1,
    );
    registry.replaceSourceSnapshot({
      source: 'postgres_authoritative',
      samples: [stale, unknown, failed],
    });

    expect(registry.getSourceSnapshot('postgres_authoritative')).toEqual([
      stale,
      failed,
      unknown,
    ]);
    const fresh = sample('imeal_postgres_disk_usage_ratio', 'fresh', 0.5);
    registry.replaceSourceSnapshot({
      source: 'postgres_authoritative',
      samples: [fresh],
    });
    expect(registry.getSourceSnapshot('postgres_authoritative')).toEqual([
      fresh,
    ]);
    expect(registry.getSourceSnapshot('postgres_authoritative')).not.toContain(
      unknown,
    );
  });

  it('rejects conflicting duplicate samples and zero replacement of a non-fresh source', () => {
    const registry = new MetricRegistry();
    const stale = sample('imeal_postgres_disk_usage_ratio', 'stale', 0.4);
    registry.mergeSourceSnapshot({
      source: 'postgres_authoritative',
      samples: [stale],
    });
    expect(() =>
      registry.mergeSourceSnapshot({
        source: 'postgres_authoritative',
        samples: [sample('imeal_postgres_disk_usage_ratio', 'stale', 0.6)],
      }),
    ).toThrow();
    expect(() =>
      registry.replaceSourceSnapshot({
        source: 'postgres_authoritative',
        samples: [sample('imeal_postgres_disk_usage_ratio', 'fresh', 0)],
      }),
    ).toThrow();
    expect(registry.getSourceSnapshot('postgres_authoritative')).toEqual([
      stale,
    ]);
    const freshRegistry = new MetricRegistry();
    freshRegistry.replaceSourceSnapshot({
      source: 'postgres_authoritative',
      samples: [sample('imeal_postgres_disk_usage_ratio', 'fresh', 0.4)],
    });
    expect(() =>
      freshRegistry.replaceSourceSnapshot({
        source: 'postgres_authoritative',
        samples: [sample('imeal_postgres_disk_usage_ratio', 'stale', 0)],
      }),
    ).toThrow();
  });
});
