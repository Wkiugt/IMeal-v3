export const METRIC_REDACTION_TOKEN = '[REDACTED]';

export const APPLICATION_OBSERVATION_INTERVAL_SECONDS = 30;
export const APPLICATION_STALE_AFTER_SECONDS = 60;
export const AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS = 60;
export const AUTHORITATIVE_STALE_AFTER_SECONDS = 120;
export const METRIC_RETENTION_DAYS = 30;

export const HISTOGRAM_BUCKETS = Object.freeze([
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
] as const);
export const HISTOGRAM_SERIES_SUFFIXES = Object.freeze([
  '_bucket',
  '_sum',
  '_count',
] as const);

export const SAMPLE_FRESHNESS_STATES = Object.freeze([
  'fresh',
  'stale',
  'unknown',
  'collector_failure',
] as const);

export type MetricFreshness = (typeof SAMPLE_FRESHNESS_STATES)[number];
export type MetricType = 'counter' | 'gauge' | 'histogram';
export type MetricSourceIdentity =
  | 'api_application'
  | 'worker_application'
  | 'postgres_authoritative'
  | 'object_storage_authoritative'
  | 'backup_restore_evidence'
  | 'security_boundary_evidence';
export type MetricSourceKind = 'application' | 'authoritative';

export const METRIC_NAMES = Object.freeze([
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
] as const);

export type MetricName = (typeof METRIC_NAMES)[number];

export type MetricUnit =
  | 'requests'
  | 'seconds'
  | 'attempts'
  | 'delivery_attempts'
  | 'retries'
  | 'terminal_failures'
  | 'confirmations'
  | 'conflicts'
  | 'runs'
  | 'unix_epoch_seconds'
  | 'ratio'
  | 'errors'
  | 'lock_waits'
  | 'bytes'
  | 'checksum_failures'
  | 'restore_test_failures'
  | 'violations';

export type MetricLabels = Readonly<Record<string, readonly string[]>>;

export type MetricFailureMapping = Readonly<{
  missing: MetricFreshness;
  invalid: MetricFreshness;
  unavailable: MetricFreshness;
}>;
export type MetricValueSemantics = Readonly<{
  nonnegative: true;
  minimum?: number;
  maximum?: number;
  negativeHandling?: 'reject' | 'clamp_to_zero';
  futureHandling?: 'reject';
}>;

export type MetricEvidenceBinding =
  | 'release'
  | 'source'
  | 'observedAt'
  | 'contractRevision'
  | 'freshness'
  | 'sha256Digest'
  | 'routeTaxonomyRevision'
  | 'bucketRevision'
  | 'resultTaxonomyRevision'
  | 'idempotencyBranchRevision'
  | 'retryPolicyRevision'
  | 'failureTaxonomyRevision'
  | 'jobTaxonomyRevision'
  | 'querySchemaRevision'
  | 'queryExporterBinding'
  | 'sourceBinding'
  | 'scheduleRevision'
  | 'sourceKind'
  | 'targetFingerprint'
  | 'capacitySourceBinding'
  | 'operationTaxonomyRevision'
  | 'manifestDigest'
  | 'manifestCompletionTimestamp'
  | 'verificationResult'
  | 'rehearsalDigest'
  | 'securityTaxonomyRevision'
  | 'deduplicationWindow';

export interface MetricContractRow {
  readonly id: `M-${number}`;
  /** Exact name consumed by the staging runtime integration, including _bucket. */
  readonly name: MetricName;
  /** OpenMetrics family name; histogram rows intentionally remove the _bucket suffix. */
  readonly familyName: string;
  readonly type: MetricType;
  readonly unit: MetricUnit;
  readonly labels: MetricLabels;
  /** Label-combination cardinality budget; zero means the metric has no labels. */
  readonly cardinalityBudget: number;
  readonly buckets: readonly number[];
  readonly histogramSeriesSuffixes: readonly string[];
  readonly valueSemantics: MetricValueSemantics;
  readonly sourceKind: MetricSourceKind;
  readonly sourceIdentity: MetricSourceIdentity;
  readonly source: string;
  readonly producer: string;
  readonly observationIntervalSeconds: number;
  readonly staleAfterSeconds: number;
  readonly failureStates: readonly ['stale', 'unknown', 'collector_failure'];
  readonly failureMapping: MetricFailureMapping;
  readonly resetBehavior: string;
  readonly retentionDays: number;
  readonly evidence: readonly MetricEvidenceBinding[];
}

const DEFAULT_FAILURE_MAPPING: MetricFailureMapping = Object.freeze({
  missing: 'collector_failure',
  invalid: 'collector_failure',
  unavailable: 'collector_failure',
});

const MISSING_EVIDENCE_FAILURE_MAPPING: MetricFailureMapping = Object.freeze({
  // Missing backup/restore evidence means the source did not establish a value.
  missing: 'unknown',
  // Invalid, mismatched, unauthorized, or unreachable evidence is a collector failure.
  invalid: 'collector_failure',
  unavailable: 'collector_failure',
});

const FAILURE_STATES = Object.freeze([
  'stale',
  'unknown',
  'collector_failure',
] as const);

const COMMON_EVIDENCE = [
  'release',
  'source',
  'observedAt',
  'contractRevision',
  'freshness',
  'sha256Digest',
] as const;

const HTTP_ROUTES = [
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
] as const;
const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
const HTTP_STATUSES = [
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
] as const;
const AUTH_RESULTS = ['success', 'failure', 'dependency_failure'] as const;
const SERVING_RESULTS = ['success', 'error', 'failure'] as const;
const WORKER_JOBS = [
  'otp_delivery',
  'notification_dispatch',
  'registration_reminder',
  'pickup_reminder',
  'cutoff_lock',
  'pickup_session_cleanup',
  'no_show',
] as const;
const WORKER_STATUSES = ['success', 'failure', 'skipped'] as const;
const SECURITY_CATEGORIES = [
  'public_private_service_exposure',
  'plaintext_bearer_transport',
  'invalid_tls',
  'unexpected_cors_origin',
  'waf_or_rate_limit_violation',
  'unexpected_public_internal_port',
] as const;

function labels(value: Record<string, readonly string[]>): MetricLabels {
  const copy: Record<string, readonly string[]> = {};
  for (const [key, enumValues] of Object.entries(value)) {
    copy[key] = Object.freeze([...enumValues]);
  }
  return Object.freeze(copy);
}

function cardinalityBudget(value: MetricLabels): number {
  const entries = Object.values(value);
  if (entries.length === 0) return 0;
  return entries.reduce(
    (product, enumValues) => product * enumValues.length,
    1,
  );
}

const SOURCE_IDENTITY_BY_PRODUCER: Record<string, MetricSourceIdentity> = {
  ApiApplicationMetricsAdapter: 'api_application',
  WorkerApplicationMetricsAdapter: 'worker_application',
  PostgresAuthoritativeMetricsAdapter: 'postgres_authoritative',
  ObjectStorageAuthoritativeMetricsAdapter: 'object_storage_authoritative',
  BackupRestoreEvidenceAdapter: 'backup_restore_evidence',
  SecurityBoundaryEvidenceAdapter: 'security_boundary_evidence',
};

function defineRow(
  value: Omit<
    MetricContractRow,
    | 'familyName'
    | 'cardinalityBudget'
    | 'histogramSeriesSuffixes'
    | 'valueSemantics'
    | 'sourceIdentity'
  > & {
    readonly familyName?: string;
    readonly valueSemantics?: MetricValueSemantics;
  },
): MetricContractRow {
  const rowLabels = labels(value.labels as Record<string, readonly string[]>);
  const familyName =
    value.familyName ??
    (value.type === 'histogram' && value.name.endsWith('_bucket')
      ? value.name.slice(0, -'_bucket'.length)
      : value.name);
  const sourceIdentity = SOURCE_IDENTITY_BY_PRODUCER[value.producer];
  if (!sourceIdentity) {
    throw new Error(`Unapproved metric producer: ${value.producer}`);
  }
  return Object.freeze({
    sourceIdentity,
    ...value,
    familyName,
    labels: rowLabels,
    cardinalityBudget: cardinalityBudget(rowLabels),
    buckets: Object.freeze([...value.buckets]),
    histogramSeriesSuffixes: Object.freeze(
      value.type === 'histogram' ? [...HISTOGRAM_SERIES_SUFFIXES] : [],
    ),
    valueSemantics: Object.freeze({
      ...DEFAULT_VALUE_SEMANTICS,
      ...value.valueSemantics,
    }),
    failureMapping: Object.freeze({ ...value.failureMapping }),
    evidence: Object.freeze([...value.evidence]),
  });
}
const DEFAULT_VALUE_SEMANTICS: MetricValueSemantics = Object.freeze({
  nonnegative: true,
});

const APPLICATION_ROW_DEFAULTS = {
  sourceKind: 'application' as const,
  observationIntervalSeconds: APPLICATION_OBSERVATION_INTERVAL_SECONDS,
  staleAfterSeconds: APPLICATION_STALE_AFTER_SECONDS,
  failureStates: FAILURE_STATES,
  failureMapping: DEFAULT_FAILURE_MAPPING,
  retentionDays: METRIC_RETENTION_DAYS,
};

const AUTHORITATIVE_ROW_DEFAULTS = {
  sourceKind: 'authoritative' as const,
  observationIntervalSeconds: AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS,
  staleAfterSeconds: AUTHORITATIVE_STALE_AFTER_SECONDS,
  failureStates: FAILURE_STATES,
  failureMapping: DEFAULT_FAILURE_MAPPING,
  retentionDays: METRIC_RETENTION_DAYS,
};

export const METRIC_CONTRACT: readonly MetricContractRow[] = Object.freeze([
  defineRow({
    id: 'M-01',
    name: 'imeal_http_requests_total',
    type: 'counter',
    unit: 'requests',
    labels: { route: HTTP_ROUTES, method: HTTP_METHODS, status: HTTP_STATUSES },
    buckets: [],
    source: 'API request finalization and normalized route/status',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior: 'Reset on API process restart; no persistence or rebasing.',
    evidence: [...COMMON_EVIDENCE, 'routeTaxonomyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-02',
    name: 'imeal_http_request_duration_seconds_bucket',
    type: 'histogram',
    unit: 'seconds',
    labels: { route: HTTP_ROUTES, method: HTTP_METHODS, status: HTTP_STATUSES },
    buckets: HISTOGRAM_BUCKETS,
    source: 'API request finalization elapsed duration',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior:
      'Reset on API process restart; bucket revision is contract-bound.',
    evidence: [...COMMON_EVIDENCE, 'routeTaxonomyRevision', 'bucketRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-03',
    name: 'imeal_auth_attempts_total',
    type: 'counter',
    unit: 'attempts',
    labels: { result: AUTH_RESULTS },
    buckets: [],
    source: 'OTP authentication verification outcome',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior:
      'Reset on API process restart; count once per verification outcome.',
    evidence: [...COMMON_EVIDENCE, 'resultTaxonomyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-04',
    name: 'imeal_otp_delivery_total',
    type: 'counter',
    unit: 'delivery_attempts',
    labels: {},
    buckets: [],
    source: 'Claimed encrypted OTP outbox delivery provider-call boundary',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Reset on worker process restart; count each real provider send attempt.',
    evidence: COMMON_EVIDENCE,
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-05',
    name: 'imeal_otp_delivery_retries_total',
    type: 'counter',
    unit: 'retries',
    labels: {},
    buckets: [],
    source: 'OTP delivery retry decision after a transient provider outcome',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Reset on worker process restart; first send is not a retry.',
    evidence: [...COMMON_EVIDENCE, 'retryPolicyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-06',
    name: 'imeal_otp_delivery_failures_total',
    type: 'counter',
    unit: 'terminal_failures',
    labels: {},
    buckets: [],
    source: 'Persisted terminal OTP delivery outcome',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Reset on worker process restart; retryable intermediate outcomes are excluded.',
    evidence: [...COMMON_EVIDENCE, 'failureTaxonomyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-07',
    name: 'imeal_otp_outbox_oldest_age_seconds',
    type: 'gauge',
    unit: 'seconds',
    labels: {},
    buckets: [],
    source: 'Real pending OTP outbox oldest-created-at query',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Replace with each valid observation; no restart carry-over.',
    evidence: [...COMMON_EVIDENCE, 'querySchemaRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-08',
    name: 'imeal_serving_confirm_total',
    type: 'counter',
    unit: 'confirmations',
    labels: { result: SERVING_RESULTS },
    buckets: [],
    source: 'Pickup confirmation transaction outcome and exact replay branch',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior:
      'Reset on API process restart; count once per confirmation outcome.',
    evidence: [...COMMON_EVIDENCE, 'resultTaxonomyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-09',
    name: 'imeal_serving_confirm_duration_seconds_bucket',
    type: 'histogram',
    unit: 'seconds',
    labels: { result: SERVING_RESULTS },
    buckets: HISTOGRAM_BUCKETS,
    source: 'Pickup confirmation transaction elapsed duration',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior:
      'Reset on API process restart; bucket revision is contract-bound.',
    evidence: [...COMMON_EVIDENCE, 'resultTaxonomyRevision', 'bucketRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-10',
    name: 'imeal_idempotency_conflicts_total',
    type: 'counter',
    unit: 'conflicts',
    labels: {},
    buckets: [],
    source: 'Persisted idempotency body/intent conflict branch',
    producer: 'ApiApplicationMetricsAdapter',
    resetBehavior:
      'Reset on API process restart; successful exact replay is excluded.',
    evidence: [
      ...COMMON_EVIDENCE,
      'resultTaxonomyRevision',
      'idempotencyBranchRevision',
    ],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-11',
    name: 'imeal_worker_runs_total',
    type: 'counter',
    unit: 'runs',
    labels: { job: WORKER_JOBS, status: WORKER_STATUSES },
    buckets: [],
    source: 'Scheduled worker job start/end/failure lifecycle',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Reset on worker process restart; count one terminal status per invocation.',
    evidence: [...COMMON_EVIDENCE, 'jobTaxonomyRevision'],
    ...APPLICATION_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-12',
    name: 'imeal_worker_job_last_success_timestamp_seconds',
    type: 'gauge',
    unit: 'unix_epoch_seconds',
    labels: { job: WORKER_JOBS },
    buckets: [],
    source: 'Latest successful job-run record for each scheduler job',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Replace with latest real successful completion; no fabricated current time.',
    evidence: [...COMMON_EVIDENCE, 'querySchemaRevision', 'scheduleRevision'],
    ...APPLICATION_ROW_DEFAULTS,
    failureMapping: {
      missing: 'unknown',
      invalid: 'collector_failure',
      unavailable: 'collector_failure',
    },
  }),
  defineRow({
    id: 'M-13',
    name: 'imeal_worker_job_lag_seconds',
    type: 'gauge',
    unit: 'seconds',
    labels: { job: WORKER_JOBS },
    buckets: [],
    valueSemantics: {
      nonnegative: true,
      negativeHandling: 'clamp_to_zero',
    },
    source: 'Real job-run completion combined with checked-in cron schedules',
    producer: 'WorkerApplicationMetricsAdapter',
    resetBehavior:
      'Replace with each valid scheduler observation; no process-state carry-over.',
    evidence: [...COMMON_EVIDENCE, 'querySchemaRevision', 'scheduleRevision'],
    ...APPLICATION_ROW_DEFAULTS,
    failureMapping: {
      missing: 'unknown',
      invalid: 'collector_failure',
      unavailable: 'collector_failure',
    },
  }),
  defineRow({
    id: 'M-14',
    name: 'imeal_postgres_connection_usage_ratio',
    type: 'gauge',
    unit: 'ratio',
    labels: { pool: ['pgbouncer_client', 'postgres_backend'] },
    buckets: [],
    valueSemantics: { nonnegative: true, minimum: 0, maximum: 1 },
    source:
      'Authoritative PostgreSQL/PgBouncer exporter or least-privilege query',
    producer: 'PostgresAuthoritativeMetricsAdapter',
    resetBehavior:
      'Replace with newest valid source value; source reset has no synthetic correction.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'queryExporterBinding',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-15',
    name: 'imeal_postgres_transaction_errors_total',
    type: 'counter',
    unit: 'errors',
    labels: {},
    buckets: [],
    source: 'Authoritative IMeal PostgreSQL transaction-error statistics',
    producer: 'PostgresAuthoritativeMetricsAdapter',
    resetBehavior:
      'Retain source counter; detected source reset is evidence-only.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'querySchemaRevision',
      'queryExporterBinding',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-16',
    name: 'imeal_postgres_lock_waits_total',
    type: 'counter',
    unit: 'lock_waits',
    labels: {},
    buckets: [],
    source: 'Authoritative PostgreSQL lock-wait statistics',
    producer: 'PostgresAuthoritativeMetricsAdapter',
    resetBehavior:
      'Retain source counter; detected source reset is evidence-only.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'querySchemaRevision',
      'queryExporterBinding',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-17',
    name: 'imeal_postgres_disk_usage_ratio',
    type: 'gauge',
    unit: 'ratio',
    labels: {},
    buckets: [],
    valueSemantics: { nonnegative: true, minimum: 0, maximum: 1 },
    source: 'Authoritative PostgreSQL data-volume/filesystem disk source',
    producer: 'PostgresAuthoritativeMetricsAdapter',
    resetBehavior:
      'Replace with newest valid source value; stale values are not zeroed.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'querySchemaRevision',
      'queryExporterBinding',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-18',
    name: 'imeal_object_storage_capacity_bytes',
    type: 'gauge',
    unit: 'bytes',
    labels: {},
    buckets: [],
    source: 'Private MinIO/storage-platform usable remaining capacity source',
    producer: 'ObjectStorageAuthoritativeMetricsAdapter',
    resetBehavior:
      'Replace with newest valid capacity; zero is a real observed value.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'capacitySourceBinding',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-19',
    name: 'imeal_object_storage_errors_total',
    type: 'counter',
    unit: 'errors',
    labels: { operation: ['health', 'read', 'write'] },
    buckets: [],
    source: 'Private MinIO/storage-platform operation error telemetry',
    producer: 'ObjectStorageAuthoritativeMetricsAdapter',
    resetBehavior:
      'Retain source counter; detected source reset is evidence-only.',
    evidence: [
      ...COMMON_EVIDENCE,
      'sourceKind',
      'targetFingerprint',
      'operationTaxonomyRevision',
      'sourceBinding',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
  defineRow({
    id: 'M-20',
    name: 'imeal_backup_age_seconds',
    type: 'gauge',
    unit: 'seconds',
    labels: {},
    buckets: [],
    valueSemantics: { nonnegative: true, futureHandling: 'reject' },
    source: 'Encrypted approved recoverable-backup manifest evidence pipeline',
    producer: 'BackupRestoreEvidenceAdapter',
    resetBehavior:
      'Replace with manifest-derived age; missing evidence is unknown, never zero.',
    evidence: [
      ...COMMON_EVIDENCE,
      'manifestDigest',
      'manifestCompletionTimestamp',
      'targetFingerprint',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
    failureMapping: MISSING_EVIDENCE_FAILURE_MAPPING,
  }),
  defineRow({
    id: 'M-21',
    name: 'imeal_backup_checksum_failures_total',
    type: 'counter',
    unit: 'checksum_failures',
    labels: {},
    buckets: [],
    source: 'Approved backup checksum verification evidence pipeline',
    producer: 'BackupRestoreEvidenceAdapter',
    resetBehavior:
      'Retain source count; missing evidence is unknown, never zero.',
    evidence: [
      ...COMMON_EVIDENCE,
      'manifestDigest',
      'targetFingerprint',
      'verificationResult',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
    failureMapping: MISSING_EVIDENCE_FAILURE_MAPPING,
  }),
  defineRow({
    id: 'M-22',
    name: 'imeal_restore_test_failures_total',
    type: 'counter',
    unit: 'restore_test_failures',
    labels: {},
    buckets: [],
    source: 'Approved isolated restore-rehearsal evidence pipeline',
    producer: 'BackupRestoreEvidenceAdapter',
    resetBehavior:
      'Retain source count; missing rehearsal evidence is unknown, never zero.',
    evidence: [
      ...COMMON_EVIDENCE,
      'rehearsalDigest',
      'targetFingerprint',
      'verificationResult',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
    failureMapping: MISSING_EVIDENCE_FAILURE_MAPPING,
  }),
  defineRow({
    id: 'M-23',
    name: 'imeal_security_boundary_violations_total',
    type: 'counter',
    unit: 'violations',
    labels: { category: SECURITY_CATEGORIES },
    buckets: [],
    source: 'Independent Caddy/WAF/TLS/scanner security observation feed',
    producer: 'SecurityBoundaryEvidenceAdapter',
    resetBehavior:
      'Retain deduplicated source count; deduplication window is evidence-bound.',
    evidence: [
      ...COMMON_EVIDENCE,
      'securityTaxonomyRevision',
      'deduplicationWindow',
    ],
    ...AUTHORITATIVE_ROW_DEFAULTS,
  }),
]);

const METRIC_BY_NAME: Record<string, MetricContractRow> = Object.create(null);
for (const row of METRIC_CONTRACT) METRIC_BY_NAME[row.name] = row;

export interface MetricEvidenceMetadata {
  readonly release: string;
  readonly source: string;
  readonly observedAt: string;
  readonly contractRevision: string;
  readonly freshness: MetricFreshness;
  readonly sha256Digest: string;
  readonly routeTaxonomyRevision?: string;
  readonly bucketRevision?: string;
  readonly resultTaxonomyRevision?: string;
  readonly idempotencyBranchRevision?: string;
  readonly retryPolicyRevision?: string;
  readonly failureTaxonomyRevision?: string;
  readonly jobTaxonomyRevision?: string;
  readonly querySchemaRevision?: string;
  readonly queryExporterBinding?: string;
  readonly sourceBinding?: string;
  readonly scheduleRevision?: string;
  readonly sourceKind?: string;
  readonly targetFingerprint?: string;
  readonly capacitySourceBinding?: string;
  readonly operationTaxonomyRevision?: string;
  readonly manifestDigest?: string;
  readonly manifestCompletionTimestamp?: string;
  readonly verificationResult?: string;
  readonly rehearsalDigest?: string;
  readonly securityTaxonomyRevision?: string;
  readonly deduplicationWindow?: string;
  readonly reference?: string;
}

export interface MetricSampleEnvelope {
  readonly metricName: MetricName;
  readonly type: MetricType;
  readonly unit: MetricUnit;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
  readonly observedAt: string;
  readonly source: string;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
}

const METRIC_SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+\S+/i,
  /(?:authorization|bearer|session(?:[-_ ]?(?:token|id))?|client(?:[-_ ]?secret)|provider(?:[-_ ]?(?:secret|api[-_ ]?key))|api[-_ ]?key|access[-_ ]?token|password|secret|signature|sig|qr(?:[-_ ]?(?:payload|token|code))?)\s*[:=]\s*\S+/i,
  /\b(?:otp|one[- ]time|verification|auth(?:entication)?)(?:\s+(?:code|password))?\s*[:=]?\s*\d{6}\b/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\//i,
  /\bhttps?:\/\/\S+/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*-?\d+(?:\.\d+)?/i,
  /\b-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/,
  /(?:request|user|employee|location|session|provider|payload|body|message|target)[-_ ]?(?:id|code|name|url)?\s*[:=]\s*\S+/i,
];

const SAMPLE_ENVELOPE_KEYS: Record<string, true> = {
  metricName: true,
  type: true,
  unit: true,
  labels: true,
  value: true,
  observedAt: true,
  source: true,
  freshness: true,
  evidence: true,
};

const EVIDENCE_KEY_ALLOWLIST: Record<string, true> = {
  release: true,
  source: true,
  observedAt: true,
  contractRevision: true,
  freshness: true,
  sha256Digest: true,
  routeTaxonomyRevision: true,
  bucketRevision: true,
  resultTaxonomyRevision: true,
  idempotencyBranchRevision: true,
  retryPolicyRevision: true,
  failureTaxonomyRevision: true,
  jobTaxonomyRevision: true,
  querySchemaRevision: true,
  queryExporterBinding: true,
  sourceBinding: true,
  scheduleRevision: true,
  sourceKind: true,
  targetFingerprint: true,
  capacitySourceBinding: true,
  operationTaxonomyRevision: true,
  manifestDigest: true,
  manifestCompletionTimestamp: true,
  verificationResult: true,
  rehearsalDigest: true,
  securityTaxonomyRevision: true,
  deduplicationWindow: true,
  reference: true,
};

const RELEASE_PATTERN = /^release-[a-z0-9][a-z0-9.-]{0,63}$/;
const CONTRACT_REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DEDUPLICATION_WINDOW_PATTERN = /^PT(?:(?:\d+H)?(?:\d+M)?(?:\d+S)?)$/;
const APPROVED_SOURCE_BINDING_BY_IDENTITY: Record<
  MetricSourceIdentity,
  string
> = {
  api_application: 'approved_api_application_source',
  worker_application: 'approved_worker_application_source',
  postgres_authoritative: 'approved_postgres_source',
  object_storage_authoritative: 'approved_object_storage_source',
  backup_restore_evidence: 'approved_backup_restore_evidence',
  security_boundary_evidence: 'approved_security_boundary_source',
};
const APPROVED_QUERY_EXPORTER_BINDING = 'approved_postgres_query_or_exporter';
const APPROVED_CAPACITY_SOURCE_BINDING =
  'approved_object_storage_capacity_source';
const APPROVED_VERIFICATION_RESULTS: Record<string, true> = {
  passed: true,
  failed: true,
  not_run: true,
  unknown: true,
};
const APPROVED_REVISION_VALUES: Record<string, string> = {
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
const REFERENCE_PATTERN = /^ref-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function containsMetricSensitiveText(value: string): boolean {
  return METRIC_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

/** Redacts diagnostic text; envelope validation rejects the original text. */
export function redactMetricText(value: string): string {
  return containsMetricSensitiveText(value) ? METRIC_REDACTION_TOKEN : value;
}

function rejectSensitiveText(value: string, field: string): void {
  if (containsMetricSensitiveText(value)) {
    throw new Error(
      `Metric sample ${field} contains forbidden secret or PII text`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireCanonicalTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Metric sample ${field} must be a canonical timestamp`);
  }
  try {
    if (new Date(value).toISOString() !== value)
      throw new Error('not canonical');
  } catch {
    throw new Error(`Metric sample ${field} must be a canonical timestamp`);
  }
  rejectSensitiveText(value, field);
}

function requireSafeString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Metric sample ${field} must be a non-empty string`);
  }
  rejectSensitiveText(value, field);
}
function requireEvidenceBindingValue(
  binding: MetricEvidenceBinding,
  value: string,
  row: MetricContractRow,
  field: string,
): void {
  switch (binding) {
    case 'release':
      if (!RELEASE_PATTERN.test(value)) {
        throw new Error(`Metric sample ${field} has an invalid release`);
      }
      return;
    case 'source':
      if (value !== row.sourceIdentity) {
        throw new Error(`Metric sample ${field} has an unapproved source`);
      }
      return;
    case 'observedAt':
    case 'manifestCompletionTimestamp':
      requireCanonicalTimestamp(value, field);
      return;
    case 'contractRevision':
      if (
        !CONTRACT_REVISION_PATTERN.test(value) ||
        new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
      ) {
        throw new Error(`Metric sample ${field} has an invalid revision`);
      }
      return;
    case 'freshness':
      if (!SAMPLE_FRESHNESS_STATES.includes(value as MetricFreshness)) {
        throw new Error(`Metric sample ${field} has an invalid freshness`);
      }
      return;
    case 'sha256Digest':
    case 'targetFingerprint':
    case 'manifestDigest':
    case 'rehearsalDigest':
      if (!DIGEST_PATTERN.test(value)) {
        throw new Error(`Metric sample ${field} has an invalid digest`);
      }
      return;
    case 'queryExporterBinding':
      if (value !== APPROVED_QUERY_EXPORTER_BINDING) {
        throw new Error(`Metric sample ${field} has an unapproved binding`);
      }
      return;
    case 'sourceBinding':
      if (value !== APPROVED_SOURCE_BINDING_BY_IDENTITY[row.sourceIdentity]) {
        throw new Error(`Metric sample ${field} has an unapproved binding`);
      }
      return;
    case 'capacitySourceBinding':
      if (value !== APPROVED_CAPACITY_SOURCE_BINDING) {
        throw new Error(`Metric sample ${field} has an unapproved binding`);
      }
      return;
    case 'sourceKind':
      if (value !== row.sourceKind) {
        throw new Error(`Metric sample ${field} has an invalid source kind`);
      }
      return;
    case 'verificationResult':
      if (APPROVED_VERIFICATION_RESULTS[value] !== true) {
        throw new Error(`Metric sample ${field} has an invalid result`);
      }
      return;
    case 'deduplicationWindow':
      if (value === 'PT' || !DEDUPLICATION_WINDOW_PATTERN.test(value)) {
        throw new Error(`Metric sample ${field} has an invalid window`);
      }
      return;
    case 'routeTaxonomyRevision':
    case 'bucketRevision':
    case 'resultTaxonomyRevision':
    case 'idempotencyBranchRevision':
    case 'retryPolicyRevision':
    case 'failureTaxonomyRevision':
    case 'jobTaxonomyRevision':
    case 'querySchemaRevision':
    case 'scheduleRevision':
    case 'operationTaxonomyRevision':
    case 'securityTaxonomyRevision':
      if (value !== APPROVED_REVISION_VALUES[binding]) {
        throw new Error(`Metric sample ${field} has an unapproved revision`);
      }
      return;
  }
}

function validateEvidence(
  value: unknown,
  row: MetricContractRow,
  sample: Omit<MetricSampleEnvelope, 'evidence'>,
): MetricEvidenceMetadata {
  if (!isRecord(value)) throw new Error('Metric sample evidence is required');
  for (const key of Object.keys(value)) {
    if (
      EVIDENCE_KEY_ALLOWLIST[key] !== true ||
      (key !== 'reference' &&
        !row.evidence.includes(key as MetricEvidenceBinding))
    ) {
      throw new Error(`Metric sample evidence.${key} is not allowlisted`);
    }
  }
  const sanitizedEvidence: Record<string, string> = {};

  for (const binding of row.evidence) {
    const entry = value[binding];
    requireSafeString(entry, `evidence.${binding}`);
    requireEvidenceBindingValue(binding, entry, row, `evidence.${binding}`);
    sanitizedEvidence[binding] = entry;
  }
  if (value.reference !== undefined) {
    requireSafeString(value.reference, 'evidence.reference');
    if (!REFERENCE_PATTERN.test(value.reference)) {
      throw new Error('Metric sample evidence.reference is not constrained');
    }
    sanitizedEvidence.reference = value.reference;
  }

  if (
    !SAMPLE_FRESHNESS_STATES.includes(
      sanitizedEvidence.freshness as MetricFreshness,
    )
  ) {
    throw new Error(
      'Metric sample evidence freshness state is not allowlisted',
    );
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(sanitizedEvidence.sha256Digest)) {
    throw new Error(
      'Metric sample evidence.sha256Digest must be a SHA-256 digest',
    );
  }
  if (
    sanitizedEvidence.source !== sample.source ||
    sanitizedEvidence.observedAt !== sample.observedAt
  ) {
    throw new Error(
      'Metric sample evidence identity does not match the sample',
    );
  }
  if (
    sanitizedEvidence.manifestCompletionTimestamp !== undefined &&
    new Date(sanitizedEvidence.manifestCompletionTimestamp).getTime() >
      new Date(sample.observedAt).getTime()
  ) {
    throw new Error(
      'Metric sample manifest completion time cannot be in the future',
    );
  }
  if (sanitizedEvidence.freshness !== sample.freshness) {
    throw new Error(
      'Metric sample evidence freshness does not match the sample',
    );
  }

  const evidenceRecord: Record<string, string> = {};
  for (const binding of row.evidence) {
    evidenceRecord[binding] = sanitizedEvidence[binding];
  }
  if (sanitizedEvidence.reference !== undefined) {
    evidenceRecord.reference = sanitizedEvidence.reference;
  }
  return evidenceRecord as unknown as MetricEvidenceMetadata;
}

export function validateMetricSampleEnvelope(
  value: unknown,
): MetricSampleEnvelope {
  if (!isRecord(value))
    throw new Error('Metric sample envelope must be an object');
  for (const key of Object.keys(value)) {
    if (SAMPLE_ENVELOPE_KEYS[key] !== true) {
      throw new Error(`Metric sample field ${key} is not allowlisted`);
    }
  }
  const row = METRIC_BY_NAME[String(value.metricName)];
  if (!row)
    throw new Error('Metric sample name is not in the approved contract');
  if (value.type !== row.type || value.unit !== row.unit) {
    throw new Error('Metric sample type or unit does not match the contract');
  }
  if (!isRecord(value.labels))
    throw new Error('Metric sample labels must be an object');
  const labelKeys = Object.keys(value.labels);
  const allowedLabelKeys = Object.keys(row.labels);
  if (
    labelKeys.length !== allowedLabelKeys.length ||
    labelKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(row.labels, key),
    )
  ) {
    throw new Error('Metric sample labels are not allowlisted');
  }
  const labels: Record<string, string> = {};
  for (const [key, labelValue] of Object.entries(value.labels)) {
    if (
      typeof labelValue !== 'string' ||
      !row.labels[key].includes(labelValue)
    ) {
      throw new Error('Metric sample label value is not in its bounded enum');
    }
    rejectSensitiveText(labelValue, `labels.${key}`);
    labels[key] = labelValue;
  }
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    throw new Error('Metric sample value must be a finite number');
  }
  let sampleValue = value.value;
  if (row.valueSemantics.nonnegative && sampleValue < 0) {
    if (row.valueSemantics.negativeHandling === 'clamp_to_zero') {
      sampleValue = 0;
    } else {
      throw new Error('Metric sample value must be nonnegative');
    }
  }
  if (
    row.valueSemantics.minimum !== undefined &&
    sampleValue < row.valueSemantics.minimum
  ) {
    throw new Error('Metric sample value is below its contract minimum');
  }
  if (
    row.valueSemantics.maximum !== undefined &&
    sampleValue > row.valueSemantics.maximum
  ) {
    throw new Error('Metric sample value is above its contract maximum');
  }
  requireCanonicalTimestamp(value.observedAt, 'observedAt');
  requireSafeString(value.source, 'source');
  if (value.source !== row.sourceIdentity) {
    throw new Error('Metric sample source identity is not allowlisted');
  }
  if (!SAMPLE_FRESHNESS_STATES.includes(value.freshness as MetricFreshness)) {
    throw new Error('Metric sample freshness state is not allowlisted');
  }
  const sample = {
    metricName: row.name,
    type: row.type,
    unit: row.unit,
    labels: Object.freeze(labels),
    value: sampleValue,
    observedAt: value.observedAt,
    source: value.source,
    freshness: value.freshness as MetricFreshness,
  };
  const evidence = validateEvidence(value.evidence, row, sample);
  return Object.freeze({ ...sample, evidence: Object.freeze(evidence) });
}

export const validateMetricSample = validateMetricSampleEnvelope;
