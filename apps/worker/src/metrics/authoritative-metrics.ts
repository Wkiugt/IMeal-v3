import {
  containsMetricSensitiveText,
  METRIC_CONTRACT,
  type MetricEvidenceMetadata,
  type MetricFreshness,
  type MetricSampleEnvelope,
  type MetricSampleValue,
  type MetricSourceSnapshot,
  validateMetricSampleEnvelope,
} from '@imeal/observability';

export type AuthoritativeSourceIdentity =
  | 'postgres_authoritative'
  | 'object_storage_authoritative'
  | 'backup_restore_evidence'
  | 'security_boundary_evidence';

export type AuthoritativeMetricsFailureReason =
  | 'configuration_missing'
  | 'source_unavailable'
  | 'source_malformed'
  | 'source_stale'
  | 'evidence_missing'
  | 'evidence_invalid'
  | 'snapshot_invalid'
  | 'sink_rejected';

export interface AuthoritativeMetricsResult {
  readonly source: AuthoritativeSourceIdentity;
  readonly freshness: MetricFreshness;
  readonly snapshot?: MetricSourceSnapshot;
  readonly reason?: AuthoritativeMetricsFailureReason;
}

export interface AuthoritativeSnapshotSink {
  acceptAuthoritativeSnapshot(
    snapshot: MetricSourceSnapshot,
  ): Promise<void> | void;
  acceptAuthoritativeFailure?(
    source: AuthoritativeSourceIdentity,
    freshness: MetricFreshness,
    reason: AuthoritativeMetricsFailureReason,
  ): Promise<void> | void;
}

const AUTHORITATIVE_SOURCES = new Set<AuthoritativeSourceIdentity>([
  'postgres_authoritative',
  'object_storage_authoritative',
  'backup_restore_evidence',
  'security_boundary_evidence',
]);

const SOURCE_BINDINGS: Readonly<Record<AuthoritativeSourceIdentity, string>> = {
  postgres_authoritative: 'approved_postgres_source',
  object_storage_authoritative: 'approved_object_storage_source',
  backup_restore_evidence: 'approved_backup_restore_evidence',
  security_boundary_evidence: 'approved_security_boundary_source',
};
const EVIDENCE_KEYS = new Set([
  'release',
  'source',
  'observedAt',
  'contractRevision',
  'freshness',
  'sha256Digest',
  'routeTaxonomyRevision',
  'bucketRevision',
  'resultTaxonomyRevision',
  'idempotencyBranchRevision',
  'retryPolicyRevision',
  'failureTaxonomyRevision',
  'jobTaxonomyRevision',
  'querySchemaRevision',
  'queryExporterBinding',
  'sourceBinding',
  'scheduleRevision',
  'sourceKind',
  'targetFingerprint',
  'capacitySourceBinding',
  'operationTaxonomyRevision',
  'manifestDigest',
  'manifestCompletionTimestamp',
  'verificationResult',
  'rehearsalDigest',
  'securityTaxonomyRevision',
  'deduplicationWindow',
  'reference',
]);

export const AUTHORITATIVE_CONTRACT_REVISION = '2026-09-30';

export function authoritativeSourceBinding(
  source: AuthoritativeSourceIdentity,
): string {
  return SOURCE_BINDINGS[source];
}

export function isAuthoritativeSource(
  source: unknown,
): source is AuthoritativeSourceIdentity {
  return typeof source === 'string' && AUTHORITATIVE_SOURCES.has(source as AuthoritativeSourceIdentity);
}

export function sourceRow(metricName: string) {
  const row = METRIC_CONTRACT.find((candidate) => candidate.name === metricName);
  if (!row || row.sourceKind !== 'authoritative') {
    throw new Error('Authoritative metric name is not approved');
  }
  return row;
}

export function createAuthoritativeSample(input: {
  readonly metricName: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: MetricSampleValue;
  readonly observedAt: string;
  readonly source: AuthoritativeSourceIdentity;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
}): MetricSampleEnvelope {
  const row = sourceRow(input.metricName);
  if (row.sourceIdentity !== input.source) {
    throw new Error('Authoritative metric source identity is not approved');
  }
  for (const [key, value] of Object.entries(input.evidence)) {
    if (!EVIDENCE_KEYS.has(key) || typeof value !== 'string' || containsMetricSensitiveText(value)) {
      throw new Error('Authoritative evidence is not safe');
    }
  }
  const evidence = Object.fromEntries(
    row.evidence.map((binding) => [binding, input.evidence[binding]]),
  );
  if (input.evidence.reference !== undefined) {
    evidence.reference = input.evidence.reference;
  }
  return validateMetricSampleEnvelope({
    metricName: row.name,
    type: row.type,
    unit: row.unit,
    labels: input.labels,
    value: input.value,
    observedAt: input.observedAt,
    source: input.source,
    freshness: input.freshness,
    evidence,
  });
}

function sampleKey(sample: MetricSampleEnvelope): string {
  const labels = Object.entries(sample.labels).sort(([first], [second]) =>
    first.localeCompare(second),
  );
  return `${sample.metricName}\u0000${JSON.stringify(labels)}`;
}

function sampleSignature(sample: MetricSampleEnvelope): string {
  return JSON.stringify({
    metricName: sample.metricName,
    type: sample.type,
    unit: sample.unit,
    labels: Object.entries(sample.labels).sort(([first], [second]) =>
      first.localeCompare(second),
    ),
    value: sample.value,
    observedAt: sample.observedAt,
    source: sample.source,
    freshness: sample.freshness,
    evidence: sample.evidence,
  });
}

export function createAuthoritativeSnapshot(input: {
  readonly source: AuthoritativeSourceIdentity;
  readonly samples: readonly MetricSampleEnvelope[];
}): MetricSourceSnapshot {
  const samplesByKey = new Map<string, MetricSampleEnvelope>();
  for (const candidate of input.samples) {
    const sample = validateMetricSampleEnvelope(candidate);
    if (sample.source !== input.source) {
      throw new Error('Authoritative snapshot source identity does not match sample');
    }
    const key = sampleKey(sample);
    const prior = samplesByKey.get(key);
    if (prior && sampleSignature(prior) !== sampleSignature(sample)) {
      throw new Error('Conflicting duplicate authoritative metric sample');
    }
    samplesByKey.set(key, sample);
  }
  return Object.freeze({
    source: input.source,
    samples: Object.freeze([...samplesByKey.values()]),
  });
}

export function authoritativeResult(
  source: AuthoritativeSourceIdentity,
  freshness: MetricFreshness,
  samples: readonly MetricSampleEnvelope[],
): AuthoritativeMetricsResult {
  try {
    const snapshot = createAuthoritativeSnapshot({ source, samples });
    if (snapshot.samples.length === 0) {
      return {
        source,
        freshness: 'collector_failure',
        reason: 'snapshot_invalid',
      };
    }
    return { source, freshness, snapshot };
  } catch {
    return {
      source,
      freshness: 'collector_failure',
      reason: 'snapshot_invalid',
    };
  }
}

export function authoritativeFailure(
  source: AuthoritativeSourceIdentity,
  freshness: MetricFreshness,
  reason: AuthoritativeMetricsFailureReason,
): AuthoritativeMetricsResult {
  return { source, freshness, reason };
}

export async function publishAuthoritativeSnapshot(
  result: AuthoritativeMetricsResult,
  sink?: AuthoritativeSnapshotSink,
): Promise<AuthoritativeMetricsResult> {
  if (!sink) return result;
  if (!result.snapshot) {
    if (!result.reason || !sink.acceptAuthoritativeFailure) return result;
    try {
      await sink.acceptAuthoritativeFailure(
        result.source,
        result.freshness,
        result.reason,
      );
      return result;
    } catch {
      return {
        source: result.source,
        freshness: 'collector_failure',
        reason: 'sink_rejected',
      };
    }
  }
  if (result.source !== result.snapshot.source) {
    return {
      source: result.source,
      freshness: 'collector_failure',
      reason: 'snapshot_invalid',
    };
  }
  if (!isAuthoritativeSource(result.snapshot.source)) {
    return {
      source: result.source,
      freshness: 'collector_failure',
      reason: 'snapshot_invalid',
    };
  }
  try {
    await sink.acceptAuthoritativeSnapshot(result.snapshot);
    return result;
  } catch {
    return {
      source: result.source,
      freshness: 'collector_failure',
      reason: 'sink_rejected',
    };
  }
}

export function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function hasOnlyKeys(
  value: object,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
