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
  type MetricEvidenceMetadata,
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
const expectedIdToName = [
  ['M-01', 'imeal_http_requests_total'],
  ['M-02', 'imeal_http_request_duration_seconds_bucket'],
  ['M-03', 'imeal_auth_attempts_total'],
  ['M-04', 'imeal_otp_delivery_total'],
  ['M-05', 'imeal_otp_delivery_retries_total'],
  ['M-06', 'imeal_otp_delivery_failures_total'],
  ['M-07', 'imeal_otp_outbox_oldest_age_seconds'],
  ['M-08', 'imeal_serving_confirm_total'],
  ['M-09', 'imeal_serving_confirm_duration_seconds_bucket'],
  ['M-10', 'imeal_idempotency_conflicts_total'],
  ['M-11', 'imeal_worker_runs_total'],
  ['M-12', 'imeal_worker_job_last_success_timestamp_seconds'],
  ['M-13', 'imeal_worker_job_lag_seconds'],
  ['M-14', 'imeal_postgres_connection_usage_ratio'],
  ['M-15', 'imeal_postgres_transaction_errors_total'],
  ['M-16', 'imeal_postgres_lock_waits_total'],
  ['M-17', 'imeal_postgres_disk_usage_ratio'],
  ['M-18', 'imeal_object_storage_capacity_bytes'],
  ['M-19', 'imeal_object_storage_errors_total'],
  ['M-20', 'imeal_backup_age_seconds'],
  ['M-21', 'imeal_backup_checksum_failures_total'],
  ['M-22', 'imeal_restore_test_failures_total'],
  ['M-23', 'imeal_security_boundary_violations_total'],
] as const;
const expectedSources: Record<string, string> = {
  imeal_http_requests_total:
    'API request finalization and normalized route/status',
  imeal_http_request_duration_seconds_bucket:
    'API request finalization elapsed duration',
  imeal_auth_attempts_total: 'OTP authentication verification outcome',
  imeal_otp_delivery_total:
    'Claimed encrypted OTP outbox delivery provider-call boundary',
  imeal_otp_delivery_retries_total:
    'OTP delivery retry decision after a transient provider outcome',
  imeal_otp_delivery_failures_total: 'Persisted terminal OTP delivery outcome',
  imeal_otp_outbox_oldest_age_seconds:
    'Real pending OTP outbox oldest-created-at query',
  imeal_serving_confirm_total:
    'Pickup confirmation transaction outcome and exact replay branch',
  imeal_serving_confirm_duration_seconds_bucket:
    'Pickup confirmation transaction elapsed duration',
  imeal_idempotency_conflicts_total:
    'Persisted idempotency body/intent conflict branch',
  imeal_worker_runs_total: 'Scheduled worker job start/end/failure lifecycle',
  imeal_worker_job_last_success_timestamp_seconds:
    'Latest successful job-run record for each scheduler job',
  imeal_worker_job_lag_seconds:
    'Real job-run completion combined with checked-in cron schedules',
  imeal_postgres_connection_usage_ratio:
    'Authoritative PostgreSQL/PgBouncer exporter or least-privilege query',
  imeal_postgres_transaction_errors_total:
    'Authoritative IMeal PostgreSQL transaction-error statistics',
  imeal_postgres_lock_waits_total:
    'Authoritative PostgreSQL lock-wait statistics',
  imeal_postgres_disk_usage_ratio:
    'Authoritative PostgreSQL data-volume/filesystem disk source',
  imeal_object_storage_capacity_bytes:
    'Private MinIO/storage-platform usable remaining capacity source',
  imeal_object_storage_errors_total:
    'Private MinIO/storage-platform operation error telemetry',
  imeal_backup_age_seconds:
    'Encrypted approved recoverable-backup manifest evidence pipeline',
  imeal_backup_checksum_failures_total:
    'Approved backup checksum verification evidence pipeline',
  imeal_restore_test_failures_total:
    'Approved isolated restore-rehearsal evidence pipeline',
  imeal_security_boundary_violations_total:
    'Independent Caddy/WAF/TLS/scanner security observation feed',
};

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
  value = 1,
): MetricSampleEnvelope {
  const row = METRIC_CONTRACT.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`Missing contract row for ${name}`);
  const observedAt = '2026-09-30T00:00:00.000Z';
  const evidence: Record<string, string> = {
    release: 'release-1',
    source: row.source,
    observedAt,
    contractRevision: '2026-09-30',
    freshness: 'fresh',
    sha256Digest: 'sha256:' + 'a'.repeat(64),
  };
  for (const binding of row.evidence) {
    if (!(binding in evidence)) {
      evidence[binding] =
        binding === 'manifestCompletionTimestamp'
          ? observedAt
          : `${binding}-v1`;
    }
  }
  return {
    metricName: name,
    type: row.type,
    unit: row.unit,
    labels,
    value,
    observedAt,
    source: row.source,
    freshness: 'fresh',
    evidence: evidence as MetricEvidenceMetadata,
  };
}

describe('metric contract', () => {
  it('matches every exact M-01 through M-23 ID to its required name', () => {
    expect(METRIC_CONTRACT.map((row) => [row.id, row.name])).toEqual(
      expectedIdToName,
    );
  });
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
  it('binds exact producer and freshness metadata to application and source rows', () => {
    const expectedProducers: Record<string, string> = {
      imeal_http_requests_total: 'ApiApplicationMetricsAdapter',
      imeal_http_request_duration_seconds_bucket:
        'ApiApplicationMetricsAdapter',
      imeal_auth_attempts_total: 'ApiApplicationMetricsAdapter',
      imeal_otp_delivery_total: 'WorkerApplicationMetricsAdapter',
      imeal_otp_delivery_retries_total: 'WorkerApplicationMetricsAdapter',
      imeal_otp_delivery_failures_total: 'WorkerApplicationMetricsAdapter',
      imeal_otp_outbox_oldest_age_seconds: 'WorkerApplicationMetricsAdapter',
      imeal_serving_confirm_total: 'ApiApplicationMetricsAdapter',
      imeal_serving_confirm_duration_seconds_bucket:
        'ApiApplicationMetricsAdapter',
      imeal_idempotency_conflicts_total: 'ApiApplicationMetricsAdapter',
      imeal_worker_runs_total: 'WorkerApplicationMetricsAdapter',
      imeal_worker_job_last_success_timestamp_seconds:
        'WorkerApplicationMetricsAdapter',
      imeal_worker_job_lag_seconds: 'WorkerApplicationMetricsAdapter',
      imeal_postgres_connection_usage_ratio:
        'PostgresAuthoritativeMetricsAdapter',
      imeal_postgres_transaction_errors_total:
        'PostgresAuthoritativeMetricsAdapter',
      imeal_postgres_lock_waits_total: 'PostgresAuthoritativeMetricsAdapter',
      imeal_postgres_disk_usage_ratio: 'PostgresAuthoritativeMetricsAdapter',
      imeal_object_storage_capacity_bytes:
        'ObjectStorageAuthoritativeMetricsAdapter',
      imeal_object_storage_errors_total:
        'ObjectStorageAuthoritativeMetricsAdapter',
      imeal_backup_age_seconds: 'BackupRestoreEvidenceAdapter',
      imeal_backup_checksum_failures_total: 'BackupRestoreEvidenceAdapter',
      imeal_restore_test_failures_total: 'BackupRestoreEvidenceAdapter',
      imeal_security_boundary_violations_total:
        'SecurityBoundaryEvidenceAdapter',
    };
    expect(
      Object.fromEntries(
        METRIC_CONTRACT.map((row) => [row.name, row.producer]),
      ),
    ).toEqual(expectedProducers);
    expect(
      Object.fromEntries(METRIC_CONTRACT.map((row) => [row.name, row.source])),
    ).toEqual(expectedSources);
    expect(
      METRIC_CONTRACT.slice(0, 13).every(
        (row) => row.sourceKind === 'application',
      ),
    ).toBe(true);
    expect(
      METRIC_CONTRACT.slice(13).every(
        (row) => row.sourceKind === 'authoritative',
      ),
    ).toBe(true);
    for (const row of METRIC_CONTRACT) {
      expect(row.staleAfterSeconds).toBe(
        row.sourceKind === 'application' ? 60 : 120,
      );
      expect(row.observationIntervalSeconds).toBe(
        row.sourceKind === 'application' ? 30 : 60,
      );
    }
  });

  it('encodes machine-checkable value semantics and freezes nested metadata', () => {
    for (const row of METRIC_CONTRACT) {
      expect(row.valueSemantics.nonnegative).toBe(true);
      expect(Object.isFrozen(row.evidence)).toBe(true);
      expect(Object.isFrozen(row.failureMapping)).toBe(true);
    }
    expect(
      METRIC_CONTRACT.find(
        (row) => row.name === 'imeal_postgres_connection_usage_ratio',
      )?.valueSemantics,
    ).toEqual({ nonnegative: true, minimum: 0, maximum: 1 });
    expect(
      METRIC_CONTRACT.find(
        (row) => row.name === 'imeal_postgres_disk_usage_ratio',
      )?.valueSemantics,
    ).toEqual({ nonnegative: true, minimum: 0, maximum: 1 });
    expect(
      METRIC_CONTRACT.find((row) => row.name === 'imeal_worker_job_lag_seconds')
        ?.valueSemantics.negativeHandling,
    ).toBe('clamp_to_zero');
    expect(
      METRIC_CONTRACT.find((row) => row.name === 'imeal_backup_age_seconds')
        ?.valueSemantics.futureHandling,
    ).toBe('reject');
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
  it('binds approved job, database, and backup evidence metadata', () => {
    const row = (name: string) =>
      METRIC_CONTRACT.find((candidate) => candidate.name === name);
    expect(row('imeal_worker_runs_total')?.evidence).toContain(
      'jobTaxonomyRevision',
    );
    for (const name of [
      'imeal_postgres_connection_usage_ratio',
      'imeal_postgres_transaction_errors_total',
      'imeal_postgres_lock_waits_total',
      'imeal_postgres_disk_usage_ratio',
    ]) {
      expect(row(name)?.evidence).toEqual(
        expect.arrayContaining(['queryExporterBinding', 'sourceBinding']),
      );
    }
    expect(row('imeal_backup_age_seconds')?.evidence).toEqual(
      expect.arrayContaining(['manifestCompletionTimestamp']),
    );
    expect(row('imeal_backup_checksum_failures_total')?.evidence).toEqual(
      expect.arrayContaining(['manifestCompletionTimestamp']),
    );
    expect(row('imeal_restore_test_failures_total')?.evidence).toContain(
      'manifestCompletionTimestamp',
    );
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
  it('rejects unknown names, types, and units', () => {
    const baseSample = sample('imeal_http_requests_total', {
      route: 'api',
      method: 'GET',
      status: '200',
    });
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        metricName: 'imeal_unknown_total',
      } as unknown),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        type: 'gauge',
      } as unknown),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        unit: 'seconds',
      } as unknown),
    ).toThrow();
  });

  it('rejects unknown top-level and evidence keys', () => {
    const baseSample = sample('imeal_auth_attempts_total', {
      result: 'success',
    });
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        unexpected: 'value',
      } as unknown),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        evidence: { ...baseSample.evidence, unexpected: 'value' },
      } as unknown),
    ).toThrow();
    const valid = validateMetricSampleEnvelope({
      ...baseSample,
      evidence: { ...baseSample.evidence, reference: 'snapshot-20260930' },
    });
    expect(valid.evidence.reference).toBe('snapshot-20260930');
    expect(valid.evidence).not.toHaveProperty('unexpected');
  });

  it('rejects invalid digest, timestamp, and freshness/evidence mismatches', () => {
    const baseSample = sample('imeal_auth_attempts_total', {
      result: 'success',
    });
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        evidence: { ...baseSample.evidence, sha256Digest: 'not-a-digest' },
      }),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        observedAt: '2026-09-30',
      }),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        freshness: 'stale',
      } as unknown),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope({
        ...baseSample,
        freshness: 'stale',
        evidence: { ...baseSample.evidence, freshness: 'fresh' },
      } as unknown),
    ).toThrow();
  });

  it('preserves distinct stale, unknown, and collector_failure states', () => {
    const baseSample = sample('imeal_auth_attempts_total', {
      result: 'success',
    });
    for (const freshness of [
      'stale',
      'unknown',
      'collector_failure',
    ] as const) {
      const result = validateMetricSampleEnvelope({
        ...baseSample,
        freshness,
        evidence: { ...baseSample.evidence, freshness },
      });
      expect(result.freshness).toBe(freshness);
      expect(result.evidence.freshness).toBe(freshness);
    }
  });

  it('rejects /metrics as an HTTP route sample', () => {
    expect(() =>
      validateMetricSampleEnvelope(
        sample('imeal_http_requests_total', {
          route: '/metrics',
          method: 'GET',
          status: '200',
        }),
      ),
    ).toThrow();
  });

  it('enforces row-specific ranges and clamps only approved worker lag', () => {
    const duration = sample(
      'imeal_http_request_duration_seconds_bucket',
      { route: 'api', method: 'GET', status: '200' },
      -0.001,
    );
    expect(() => validateMetricSampleEnvelope(duration)).toThrow();
    expect(
      validateMetricSampleEnvelope(
        sample('imeal_worker_job_lag_seconds', { job: 'no_show' }, -1),
      ).value,
    ).toBe(0);
    expect(() =>
      validateMetricSampleEnvelope(
        sample(
          'imeal_postgres_connection_usage_ratio',
          { pool: 'pgbouncer_client' },
          -0.001,
        ),
      ),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope(
        sample(
          'imeal_postgres_connection_usage_ratio',
          { pool: 'pgbouncer_client' },
          1.001,
        ),
      ),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope(
        sample('imeal_postgres_disk_usage_ratio', {}, 1.001),
      ),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope(sample('imeal_backup_age_seconds', {}, -1)),
    ).toThrow();
    const futureManifest = sample('imeal_backup_age_seconds', {}, 0);
    expect(() =>
      validateMetricSampleEnvelope({
        ...futureManifest,
        evidence: {
          ...futureManifest.evidence,
          manifestCompletionTimestamp: '2026-10-01T00:00:00.000Z',
        },
      }),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope(
        sample('imeal_object_storage_capacity_bytes', {}, -1),
      ),
    ).toThrow();
    expect(() =>
      validateMetricSampleEnvelope(
        sample('imeal_auth_attempts_total', { result: 'success' }, Infinity),
      ),
    ).toThrow();
  });

  it('accepts valid zero and ratio boundaries without fallback substitution', () => {
    for (const [name, labels] of [
      ['imeal_otp_outbox_oldest_age_seconds', {}],
      ['imeal_object_storage_capacity_bytes', {}],
      ['imeal_backup_age_seconds', {}],
      ['imeal_postgres_connection_usage_ratio', { pool: 'pgbouncer_client' }],
      ['imeal_postgres_disk_usage_ratio', {}],
    ] as const) {
      const result = validateMetricSampleEnvelope(sample(name, labels, 0));
      expect(result.value).toBe(0);
    }
    expect(
      validateMetricSampleEnvelope(
        sample(
          'imeal_postgres_connection_usage_ratio',
          { pool: 'postgres_backend' },
          1,
        ),
      ).value,
    ).toBe(1);
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
    for (const field of ['release', 'contractRevision', 'reference'] as const) {
      const validSample = sample('imeal_auth_attempts_total', {
        result: 'success',
      });
      const unsafeSample = {
        ...validSample,
        evidence: { ...validSample.evidence, [field]: secret },
      };
      expect(() => validateMetricSampleEnvelope(unsafeSample)).toThrow();
    }
  });
});
