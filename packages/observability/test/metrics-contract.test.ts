import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OBSERVATION_INTERVAL_SECONDS,
  AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS,
  HISTOGRAM_BUCKETS,
  HISTOGRAM_SERIES_SUFFIXES,
  METRIC_CONTRACT,
  METRIC_NAMES,
  SAMPLE_FRESHNESS_STATES,
  validateMetricSampleEnvelope,
  type MetricSampleEnvelope,
} from '../src/metrics-contract.js';

const expectedNames = [
  'imeal_http_requests_total',
  'imeal_http_request_duration_seconds_bucket',
  'imeal_auth_attempts_total',
  'imeal_otp_delivery_total',
  'imeal_otp_delivery_retries_total',
  'imeal_otp_delivery_failures_total',
  'imeal_otp_outbox_oldest_age_seconds',
  'imeal_serving_confirm_total',
  'imeal_serving_confirm_duration_seconds_bucket',
  'imeal_idempotency_conflicts_total',
  'imeal_worker_runs_total',
  'imeal_worker_job_last_success_timestamp_seconds',
  'imeal_worker_job_lag_seconds',
  'imeal_postgres_connection_usage_ratio',
  'imeal_postgres_transaction_errors_total',
  'imeal_postgres_lock_waits_total',
  'imeal_postgres_disk_usage_ratio',
  'imeal_object_storage_capacity_bytes',
  'imeal_object_storage_errors_total',
  'imeal_backup_age_seconds',
  'imeal_backup_checksum_failures_total',
  'imeal_restore_test_failures_total',
  'imeal_security_boundary_violations_total',
] as const;

const expectedTypeUnits: Record<
  (typeof expectedNames)[number],
  { type: 'counter' | 'gauge' | 'histogram'; unit: string }
> = {
  imeal_http_requests_total: { type: 'counter', unit: 'requests' },
  imeal_http_request_duration_seconds_bucket: {
    type: 'histogram',
    unit: 'seconds',
  },
  imeal_auth_attempts_total: { type: 'counter', unit: 'attempts' },
  imeal_otp_delivery_total: {
    type: 'counter',
    unit: 'delivery_attempts',
  },
  imeal_otp_delivery_retries_total: { type: 'counter', unit: 'retries' },
  imeal_otp_delivery_failures_total: {
    type: 'counter',
    unit: 'terminal_failures',
  },
  imeal_otp_outbox_oldest_age_seconds: { type: 'gauge', unit: 'seconds' },
  imeal_serving_confirm_total: { type: 'counter', unit: 'confirmations' },
  imeal_serving_confirm_duration_seconds_bucket: {
    type: 'histogram',
    unit: 'seconds',
  },
  imeal_idempotency_conflicts_total: { type: 'counter', unit: 'conflicts' },
  imeal_worker_runs_total: { type: 'counter', unit: 'runs' },
  imeal_worker_job_last_success_timestamp_seconds: {
    type: 'gauge',
    unit: 'unix_epoch_seconds',
  },
  imeal_worker_job_lag_seconds: { type: 'gauge', unit: 'seconds' },
  imeal_postgres_connection_usage_ratio: {
    type: 'gauge',
    unit: 'ratio',
  },
  imeal_postgres_transaction_errors_total: { type: 'counter', unit: 'errors' },
  imeal_postgres_lock_waits_total: { type: 'counter', unit: 'lock_waits' },
  imeal_postgres_disk_usage_ratio: { type: 'gauge', unit: 'ratio' },
  imeal_object_storage_capacity_bytes: { type: 'gauge', unit: 'bytes' },
  imeal_object_storage_errors_total: { type: 'counter', unit: 'errors' },
  imeal_backup_age_seconds: { type: 'gauge', unit: 'seconds' },
  imeal_backup_checksum_failures_total: {
    type: 'counter',
    unit: 'checksum_failures',
  },
  imeal_restore_test_failures_total: {
    type: 'counter',
    unit: 'restore_test_failures',
  },
  imeal_security_boundary_violations_total: {
    type: 'counter',
    unit: 'violations',
  },
};

const expectedLabels: Record<string, Record<string, readonly string[]>> = {
  imeal_http_requests_total: {
    route: [
      '/health/live',
      '/health/ready',
      'auth',
      'api',
      'serving',
      'registrations',
      'kitchen',
      'notifications',
      'delegations',
      'admin',
      'other',
    ],
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    status: [
      '200',
      '201',
      '202',
      '204',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '429',
      '500',
      '502',
      '503',
      '504',
    ],
  },
  imeal_http_request_duration_seconds_bucket: {
    route: [
      '/health/live',
      '/health/ready',
      'auth',
      'api',
      'serving',
      'registrations',
      'kitchen',
      'notifications',
      'delegations',
      'admin',
      'other',
    ],
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    status: [
      '200',
      '201',
      '202',
      '204',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '429',
      '500',
      '502',
      '503',
      '504',
    ],
  },
  imeal_auth_attempts_total: {
    result: ['success', 'failure', 'dependency_failure'],
  },
  imeal_serving_confirm_total: {
    result: ['success', 'error', 'failure'],
  },
  imeal_serving_confirm_duration_seconds_bucket: {
    result: ['success', 'error', 'failure'],
  },
  imeal_worker_runs_total: {
    job: [
      'otp_delivery',
      'notification_dispatch',
      'registration_reminder',
      'pickup_reminder',
      'cutoff_lock',
      'pickup_session_cleanup',
      'no_show',
    ],
    status: ['success', 'failure', 'skipped'],
  },
  imeal_worker_job_last_success_timestamp_seconds: {
    job: [
      'otp_delivery',
      'notification_dispatch',
      'registration_reminder',
      'pickup_reminder',
      'cutoff_lock',
      'pickup_session_cleanup',
      'no_show',
    ],
  },
  imeal_worker_job_lag_seconds: {
    job: [
      'otp_delivery',
      'notification_dispatch',
      'registration_reminder',
      'pickup_reminder',
      'cutoff_lock',
      'pickup_session_cleanup',
      'no_show',
    ],
  },
  imeal_postgres_connection_usage_ratio: {
    pool: ['pgbouncer_client', 'postgres_backend'],
  },
  imeal_object_storage_errors_total: {
    operation: ['health', 'read', 'write'],
  },
  imeal_security_boundary_violations_total: {
    category: [
      'public_private_service_exposure',
      'plaintext_bearer_transport',
      'invalid_tls',
      'unexpected_cors_origin',
      'waf_or_rate_limit_violation',
      'unexpected_public_internal_port',
    ],
  },
};

function sample(
  name: (typeof expectedNames)[number],
  labels: Record<string, string> = {},
): MetricSampleEnvelope {
  const row = METRIC_CONTRACT.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`Missing contract row for ${name}`);
  return {
    metricName: name,
    type: row.type,
    unit: row.unit,
    labels,
    value: 1,
    observedAt: '2026-09-30T00:00:00.000Z',
    source: row.source,
    freshness: 'fresh',
    evidence: {
      release: 'release-1',
      source: row.source,
      observedAt: '2026-09-30T00:00:00.000Z',
      contractRevision: '2026-09-30',
      freshness: 'fresh',
      digest: 'sha256:' + 'a'.repeat(64),
    },
  };
}

describe('metric contract', () => {
  it('contains exactly the required names and unique IDs', () => {
    expect(METRIC_NAMES).toEqual(expectedNames);
    expect(METRIC_CONTRACT.map((row) => row.name)).toEqual(expectedNames);
    expect(new Set(METRIC_CONTRACT.map((row) => row.id)).size).toBe(23);
    expect(
      METRIC_CONTRACT.filter((row) => row.type === 'histogram').map((row) => [
        row.name,
        row.familyName,
      ]),
    ).toEqual([
      [
        'imeal_http_request_duration_seconds_bucket',
        'imeal_http_request_duration_seconds',
      ],
      [
        'imeal_serving_confirm_duration_seconds_bucket',
        'imeal_serving_confirm_duration_seconds',
      ],
    ]);
  });

  it('keeps every metric type and unit consistent with the approved rows', () => {
    for (const row of METRIC_CONTRACT) {
      expect(row.type).toBe(expectedTypeUnits[row.name].type);
      expect(row.unit).toBe(expectedTypeUnits[row.name].unit);
      expect(row.retentionDays).toBe(30);
      expect(row.evidence.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.resetBehavior.length).toBeGreaterThan(0);
      expect(row.observationIntervalSeconds).toBe(
        row.sourceKind === 'application'
          ? APPLICATION_OBSERVATION_INTERVAL_SECONDS
          : AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS,
      );
    }
  });

  it('encodes the exact bounded label names and enum values', () => {
    for (const row of METRIC_CONTRACT) {
      expect(row.labels).toEqual(expectedLabels[row.name] ?? {});
      expect(row.cardinalityBudget).toBe(
        Object.keys(row.labels).length === 0
          ? 0
          : Object.values(row.labels).reduce(
              (cardinality, values) => cardinality * values.length,
              1,
            ),
      );
    }
  });

  it('includes the one-second serving threshold in fixed histogram buckets', () => {
    expect(HISTOGRAM_BUCKETS).toEqual([
      0.005,
      0.01,
      0.025,
      0.05,
      0.1,
      0.25,
      0.5,
      1,
      2.5,
      5,
      10,
      Infinity,
    ]);
    for (const row of METRIC_CONTRACT.filter(
      (candidate) => candidate.type === 'histogram',
    )) {
      expect(row.buckets).toEqual(HISTOGRAM_BUCKETS);
      expect(row.histogramSeriesSuffixes).toEqual(HISTOGRAM_SERIES_SUFFIXES);
      expect(row.histogramSeriesSuffixes).toEqual([
        '_bucket',
        '_sum',
        '_count',
      ]);
      expect(row.buckets).toContain(1);
      expect(row.buckets.at(-1)).toBe(Infinity);
    }
  });

  it('defines the common freshness states and metadata for every row', () => {
    expect(SAMPLE_FRESHNESS_STATES).toEqual([
      'fresh',
      'stale',
      'unknown',
      'collector_failure',
    ]);
    for (const row of METRIC_CONTRACT) {
      expect(row.failureStates).toEqual([
        'stale',
        'unknown',
        'collector_failure',
      ]);
      expect(row.evidence).toContain('release');
      expect(row.evidence).toContain('source');
      expect(row.evidence).toContain('observedAt');
      expect(row.evidence).toContain('contractRevision');
      expect(row.evidence).toContain('freshness');
      expect(row.evidence).toContain('sha256Digest');
    }
  });
  it('maps missing and invalid backup evidence deterministically', () => {
    expect(
      METRIC_CONTRACT.filter((row) =>
        [
          'imeal_backup_age_seconds',
          'imeal_backup_checksum_failures_total',
          'imeal_restore_test_failures_total',
        ].includes(row.name),
      ).map((row) => row.failureMapping),
    ).toEqual([
      {
        missing: 'unknown',
        invalid: 'collector_failure',
        unavailable: 'collector_failure',
      },
      {
        missing: 'unknown',
        invalid: 'collector_failure',
        unavailable: 'collector_failure',
      },
      {
        missing: 'unknown',
        invalid: 'collector_failure',
        unavailable: 'collector_failure',
      },
    ]);
  });

  it('accepts a complete bounded sample envelope', () => {
    expect(
      validateMetricSampleEnvelope(
        sample('imeal_http_requests_total', {
          route: 'api',
          method: 'GET',
          status: '200',
        }),
      ),
    ).toEqual(
      expect.objectContaining({ metricName: 'imeal_http_requests_total' }),
    );
  });

  it.each([
    ['unknown route', { route: '/v1/users/123', method: 'GET', status: '200' }],
    ['unknown method', { route: 'api', method: 'TRACE', status: '200' }],
    ['unknown status', { route: 'api', method: 'GET', status: '418' }],
    [
      'extra label',
      { route: 'api', method: 'GET', status: '200', userId: '42' },
    ],
  ])('rejects %s from a sample envelope', (_description, labels) => {
    expect(() =>
      validateMetricSampleEnvelope(sample('imeal_http_requests_total', labels)),
    ).toThrow();
  });

  it.each([
    ['bearer token', 'Bearer opaque-token-value'],
    ['OTP', 'otp=123456'],
    ['email address', 'employee@example.com'],
    ['database URL', 'postgresql://user:password@db.internal/imeal'],
    ['GPS coordinates', '10.7769,106.7009'],
    ['provider payload', 'payload={"body":"secret-provider-payload"}'],
  ])('rejects %s from labels and evidence text', (_description, secret) => {
    expect(() =>
      validateMetricSampleEnvelope(
        sample('imeal_auth_attempts_total', { result: secret }),
      ),
    ).toThrow();

    const baseSample = sample('imeal_auth_attempts_total', {
      result: 'success',
    });
    const unsafeSample = {
      ...baseSample,
      evidence: { ...baseSample.evidence, reference: secret },
    };
    expect(() => validateMetricSampleEnvelope(unsafeSample)).toThrow();
  });
});
