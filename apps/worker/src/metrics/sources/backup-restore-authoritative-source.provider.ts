import type { BackupRestoreMetricsInput } from './backup-restore-metrics.adapter.js';
import type { AuthoritativeMetricsSourceProvider } from '../authoritative-metrics-collector.js';
import { isCanonicalTimestamp, isSha256Digest } from '../authoritative-metrics.js';
import {
  hasExactKeys,
  isAuthoritativeEvidence,
  isFreshness,
  isNonnegativeSafeInteger,
  isRecord,
} from './authoritative-source-schema.js';
import type {
  AuthoritativeSourceSchema,
  AuthoritativeSourceTransport,
} from './authoritative-source-transport.js';

const SOURCE = 'backup_restore_evidence';
const RELEASE_PATTERN = /^release-[a-z0-9][a-z0-9.-]{0,63}$/;
const INPUT_KEYS = [
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
] as const;
const VERIFICATION_STATES = ['passed', 'failed', 'not_run', 'unknown'] as const;

export interface BackupRestoreAuthoritativeSourceProviderConfig {
  readonly transport?: AuthoritativeSourceTransport;
  readonly targetFingerprint: string;
  readonly release: string;
}

export class BackupRestoreAuthoritativeSourceProvider
  implements AuthoritativeMetricsSourceProvider<BackupRestoreMetricsInput>
{
  constructor(private readonly config?: BackupRestoreAuthoritativeSourceProviderConfig) {}

  async collect(
    reference: string,
    observedAt: string,
  ): Promise<BackupRestoreMetricsInput | undefined> {
    if (
      !this.config?.transport ||
      !isSha256Digest(this.config.targetFingerprint) ||
      !RELEASE_PATTERN.test(this.config.release)
    ) {
      return undefined;
    }
    return this.config.transport.requestJson(
      reference,
      { observedAt },
      backupRestoreInputSchema(this.config.targetFingerprint, this.config.release, observedAt),
    );
  }
}

export function createBackupRestoreAuthoritativeSourceProvider(
  config?: BackupRestoreAuthoritativeSourceProviderConfig,
): BackupRestoreAuthoritativeSourceProvider {
  return new BackupRestoreAuthoritativeSourceProvider(config);
}

function backupRestoreInputSchema(
  targetFingerprint: string,
  release: string,
  expectedObservedAt: string,
): AuthoritativeSourceSchema<BackupRestoreMetricsInput> {
  return (value: unknown): value is BackupRestoreMetricsInput => {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, INPUT_KEYS) ||
      value.observedAt !== expectedObservedAt ||
      typeof value.observedAt !== 'string' ||
      !isFreshness(value.freshness) ||
      value.targetFingerprint !== targetFingerprint ||
      value.release !== release ||
      value.retentionState !== 'retained' ||
      !isCanonicalTimestamp(value.manifestCompletionTimestamp) ||
      Date.parse(value.manifestCompletionTimestamp) > Date.parse(value.observedAt) ||
      !isAuthoritativeEvidence(
        value.evidence,
        SOURCE,
        value.observedAt,
        value.freshness,
        [
          'targetFingerprint',
          'manifestDigest',
          'manifestCompletionTimestamp',
          'verificationResult',
          'rehearsalDigest',
        ],
      )
    ) {
      return false;
    }
    if (
      value.evidence.targetFingerprint !== targetFingerprint ||
      value.evidence.manifestDigest !== value.manifestDigest ||
      value.evidence.manifestCompletionTimestamp !== value.manifestCompletionTimestamp ||
      value.evidence.rehearsalDigest !== value.rehearsalDigest ||
      typeof value.evidence.verificationResult !== 'string' ||
      value.evidence.verificationResult.length === 0 ||
      !isSha256Digest(value.manifestDigest) ||
      !isSha256Digest(value.rehearsalDigest) ||
      !VERIFICATION_STATES.includes(value.checksumVerification as (typeof VERIFICATION_STATES)[number]) ||
      !VERIFICATION_STATES.includes(value.rehearsalVerification as (typeof VERIFICATION_STATES)[number]) ||
      !isNonnegativeSafeInteger(value.checksumFailures) ||
      !isNonnegativeSafeInteger(value.restoreTestFailures)
    ) {
      return false;
    }
    return !(
      value.checksumVerification === 'failed' && value.checksumFailures === 0
    ) && !(
      value.rehearsalVerification === 'failed' && value.restoreTestFailures === 0
    );
  };
}
