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

export interface BackupRestoreMetricsConfig {
  readonly sourceBinding: string;
  readonly targetFingerprint: string;
  readonly release: string;
}

export interface BackupRestoreMetricsInput {
  readonly observedAt: string;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
  readonly targetFingerprint?: string;
  readonly release?: string;
  readonly manifestDigest?: string;
  readonly manifestCompletionTimestamp?: string;
  readonly retentionState?: 'retained' | 'expired';
  readonly checksumVerification?: 'passed' | 'failed' | 'not_run' | 'unknown';
  readonly checksumFailures?: number;
  readonly rehearsalDigest?: string;
  readonly rehearsalVerification?: 'passed' | 'failed' | 'not_run' | 'unknown';
  readonly restoreTestFailures?: number;
}

const SOURCE = 'backup_restore_evidence' as const;
const SOURCE_BINDING = 'approved_backup_restore_evidence';

export class BackupRestoreMetricsAdapter {
  constructor(private readonly config?: BackupRestoreMetricsConfig) {}

  collect(input?: BackupRestoreMetricsInput): AuthoritativeMetricsResult {
    if (!this.validConfig()) {
      return authoritativeFailure(SOURCE, 'collector_failure', 'configuration_missing');
    }
    if (!input) {
      return authoritativeFailure(SOURCE, 'unknown', 'evidence_missing');
    }
    if (this.missingEvidence(input)) {
      return authoritativeFailure(SOURCE, 'unknown', 'evidence_missing');
    }
    try {
      this.validateInput(input);
      if (input.freshness === 'unknown' || input.freshness === 'collector_failure') {
        return authoritativeFailure(SOURCE, input.freshness, 'evidence_invalid');
      }
      const completionMilliseconds = Date.parse(input.manifestCompletionTimestamp!);
      const observedMilliseconds = Date.parse(input.observedAt);
      const samples = [
        createAuthoritativeSample({
          metricName: 'imeal_backup_age_seconds',
          labels: {},
          value: (observedMilliseconds - completionMilliseconds) / 1000,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
        createAuthoritativeSample({
          metricName: 'imeal_backup_checksum_failures_total',
          labels: {},
          value: input.checksumFailures!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: {
            ...input.evidence,
            verificationResult: input.checksumVerification,
          },
        }),
        createAuthoritativeSample({
          metricName: 'imeal_restore_test_failures_total',
          labels: {},
          value: input.restoreTestFailures!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: {
            ...input.evidence,
            rehearsalDigest: input.rehearsalDigest,
            verificationResult: input.rehearsalVerification,
          },
        }),
      ];
      return authoritativeResult(SOURCE, input.freshness, samples);
    } catch {
      return authoritativeFailure(SOURCE, 'collector_failure', 'evidence_invalid');
    }
  }

  private validConfig(): boolean {
    const config = this.config;
    return Boolean(
      config &&
        config.sourceBinding === SOURCE_BINDING &&
        isSha256Digest(config.targetFingerprint) &&
        /^release-[a-z0-9][a-z0-9.-]{0,63}$/.test(config.release),
    );
  }

  private missingEvidence(input: BackupRestoreMetricsInput): boolean {
    return (
      !input.targetFingerprint ||
      !input.release ||
      !input.manifestDigest ||
      !input.manifestCompletionTimestamp ||
      !input.retentionState ||
      !input.checksumVerification ||
      input.checksumVerification === 'not_run' ||
      input.checksumVerification === 'unknown' ||
      input.checksumFailures === undefined ||
      !input.rehearsalDigest ||
      !input.rehearsalVerification ||
      input.rehearsalVerification === 'not_run' ||
      input.rehearsalVerification === 'unknown' ||
      input.restoreTestFailures === undefined
    );
  }

  private validateInput(input: BackupRestoreMetricsInput): void {
    if (
      !hasOnlyKeys(input, [
        'observedAt',
        'freshness',
        'evidence',
        'targetFingerprint',
        'release',
        'manifestDigest',
        'manifestCompletionTimestamp',
        'retentionState',
        'checksumVerification',
        'checksumFailures',
        'rehearsalDigest',
        'rehearsalVerification',
        'restoreTestFailures',
      ]) ||
      !isCanonicalTimestamp(input.observedAt) ||
      !isCanonicalTimestamp(input.manifestCompletionTimestamp) ||
      Date.parse(input.manifestCompletionTimestamp) > Date.parse(input.observedAt) ||
      input.targetFingerprint !== this.config?.targetFingerprint ||
      input.release !== this.config?.release ||
      input.retentionState !== 'retained' ||
      !isSha256Digest(input.manifestDigest) ||
      !isSha256Digest(input.rehearsalDigest) ||
      !['fresh', 'stale', 'unknown', 'collector_failure'].includes(input.freshness) ||
      !['passed', 'failed', 'not_run', 'unknown'].includes(input.checksumVerification ?? '') ||
      !['passed', 'failed', 'not_run', 'unknown'].includes(input.rehearsalVerification ?? '') ||
      !isFiniteNonnegative(input.checksumFailures) ||
      !Number.isSafeInteger(input.checksumFailures) ||
      !isFiniteNonnegative(input.restoreTestFailures) ||
      !Number.isSafeInteger(input.restoreTestFailures) ||
      (input.checksumVerification === 'failed' && input.checksumFailures === 0) ||
      (input.rehearsalVerification === 'failed' && input.restoreTestFailures === 0) ||
      !input.evidence ||
      input.evidence.source !== SOURCE ||
      input.evidence.observedAt !== input.observedAt ||
      input.evidence.freshness !== input.freshness ||
      input.evidence.contractRevision !== AUTHORITATIVE_CONTRACT_REVISION ||
      input.evidence.sourceKind !== 'authoritative' ||
      input.evidence.release !== input.release ||
      input.evidence.targetFingerprint !== input.targetFingerprint ||
      input.evidence.manifestDigest !== input.manifestDigest ||
      input.evidence.manifestCompletionTimestamp !== input.manifestCompletionTimestamp ||
      input.evidence.rehearsalDigest !== input.rehearsalDigest
    ) {
      throw new Error('backup evidence is malformed');
    }
  }
}
