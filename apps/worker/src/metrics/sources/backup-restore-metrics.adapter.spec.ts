import { describe, expect, it } from 'vitest';
import type { MetricEvidenceMetadata, MetricFreshness } from '@imeal/observability';
import {
  BackupRestoreMetricsAdapter,
  type BackupRestoreMetricsConfig,
  type BackupRestoreMetricsInput,
} from './backup-restore-metrics.adapter.js';

const observedAt = '2026-09-30T01:00:00.000Z';
const completion = '2026-09-29T23:00:00.000Z';
const digest = `sha256:${'c'.repeat(64)}`;
const rehearsalDigest = `sha256:${'d'.repeat(64)}`;
const config: BackupRestoreMetricsConfig = {
  sourceBinding: 'approved_backup_restore_evidence',
  targetFingerprint: digest,
  release: 'release-test',
};

function evidence(freshness: MetricFreshness = 'fresh'): MetricEvidenceMetadata {
  return {
    release: 'release-test',
    source: 'backup_restore_evidence',
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    manifestDigest: digest,
    manifestCompletionTimestamp: completion,
    targetFingerprint: digest,
    verificationResult: 'passed',
    rehearsalDigest,
  };
}

function input(overrides: Partial<BackupRestoreMetricsInput> = {}): BackupRestoreMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence(),
    targetFingerprint: digest,
    release: 'release-test',
    manifestDigest: digest,
    manifestCompletionTimestamp: completion,
    retentionState: 'retained',
    checksumVerification: 'passed',
    checksumFailures: 0,
    rehearsalDigest,
    rehearsalVerification: 'passed',
    restoreTestFailures: 0,
    ...overrides,
  };
}

describe('BackupRestoreMetricsAdapter', () => {
  it('maps target-bound manifest, checksum, and rehearsal evidence to M20-M22', () => {
    const result = new BackupRestoreMetricsAdapter(config).collect(input());

    expect(result).toMatchObject({
      source: 'backup_restore_evidence',
      freshness: 'fresh',
      snapshot: { source: 'backup_restore_evidence' },
    });
    expect(result.snapshot?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricName: 'imeal_backup_age_seconds', value: 7200 }),
        expect.objectContaining({ metricName: 'imeal_backup_checksum_failures_total', value: 0 }),
        expect.objectContaining({ metricName: 'imeal_restore_test_failures_total', value: 0 }),
      ]),
    );
  });

  it('returns unknown without a manifest or rehearsal instead of PASS or zero', () => {
    expect(new BackupRestoreMetricsAdapter(config).collect()).toEqual({
      source: 'backup_restore_evidence',
      freshness: 'unknown',
      reason: 'evidence_missing',
    });
    expect(
      new BackupRestoreMetricsAdapter(config).collect(
        input({ rehearsalDigest: undefined, rehearsalVerification: undefined }),
      ),
    ).toMatchObject({ freshness: 'unknown', reason: 'evidence_missing' });
  });

  it('returns unknown without numeric samples for unrun or unknown evidence states', () => {
    for (const status of ['not_run', 'unknown'] as const) {
      expect(
        new BackupRestoreMetricsAdapter(config).collect(
          input({
            checksumVerification: status,
            rehearsalVerification: status,
          }),
        ),
      ).toEqual({
        source: 'backup_restore_evidence',
        freshness: 'unknown',
        reason: 'evidence_missing',
      });
    }
  });

  it('accepts explicit failed verification only with a positive real failure count', () => {
    const result = new BackupRestoreMetricsAdapter(config).collect(
      input({
        checksumVerification: 'failed',
        checksumFailures: 2,
        evidence: { ...evidence(), verificationResult: 'failed' },
      }),
    );

    expect(result.freshness).toBe('fresh');
    expect(result.snapshot?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'imeal_backup_checksum_failures_total',
          value: 2,
        }),
      ]),
    );
  });

  it('rejects target, release, retention, checksum, and future timestamp mismatches', () => {
    for (const override of [
      { targetFingerprint: `sha256:${'e'.repeat(64)}` },
      { release: 'release-other' },
      { retentionState: 'expired' as const },
      { checksumVerification: 'failed' as const },
      { manifestCompletionTimestamp: '2026-09-30T02:00:00.000Z' },
    ]) {
      expect(new BackupRestoreMetricsAdapter(config).collect(input(override))).toMatchObject({
        freshness: 'collector_failure',
        reason: 'evidence_invalid',
      });
    }
  });

  it('rejects application backup attempts and stale evidence remains non-fresh', () => {
    expect(
      new BackupRestoreMetricsAdapter(config).collect(
        input({ applicationBackupAttempt: true } as unknown as Partial<BackupRestoreMetricsInput>),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'evidence_invalid' });

    const result = new BackupRestoreMetricsAdapter(config).collect(
      input({ freshness: 'stale', evidence: evidence('stale') }),
    );
    expect(result.freshness).toBe('stale');
    expect(result.snapshot?.samples.every((sample) => sample.freshness === 'stale')).toBe(true);
  });

  it('fails closed on malformed digest and sensitive evidence text', () => {
    expect(
      new BackupRestoreMetricsAdapter(config).collect(
        input({ manifestDigest: 'not-a-digest' }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'evidence_invalid' });
    expect(
      new BackupRestoreMetricsAdapter(config).collect(
        input({
          evidence: {
            ...evidence(),
            reference: 'Bearer secret-not-output',
          },
        }),
      ),
    ).toMatchObject({ freshness: 'collector_failure', reason: 'evidence_invalid' });
  });
});
