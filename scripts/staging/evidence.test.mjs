import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_EVIDENCE,
  assertEvidenceComplete,
  createEvidenceManifest,
  resolveEvidenceTarget,
  writeChecksums,
} from './evidence.mjs';

const releaseId = 'imeal-20260928-001';
const target = { database: 'imeal_staging', schema: 'phase0_staging_20260928' };
const digest = 'a'.repeat(64);

async function makeEvidenceDirectory({
  rollback = true,
  writeChecksum = true,
  rollbackReference = 'rollback/imeal-20260927-004.tar',
  rollbackFile = true,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'staging-evidence-'));
  const releaseManifest = {
    releaseId,
    target,
    commitSha: 'b'.repeat(40),
    images: {
      api: `registry.example/api@sha256:${digest}`,
      worker: `registry.example/worker@sha256:${digest}`,
      adminWeb: `registry.example/admin@sha256:${digest}`,
    },
    migrations: ['20260928000000_phase0_domain_correctness'],
    ...(rollback ? { rollbackArtifact: rollbackReference } : {}),
  };
  const jsonNames = REQUIRED_EVIDENCE.filter(
    (name) => name.endsWith('.json') && name !== 'release-manifest.json',
  );
  await writeFile(
    join(directory, 'release-manifest.json'),
    `${JSON.stringify(releaseManifest)}\n`,
  );
  await writeFile(
    join(directory, 'target-fingerprint.json'),
    `${JSON.stringify({
      releaseId,
      target,
      targetFingerprint: {
        database: target.database,
        schema: target.schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
    })}\n`,
  );
  for (const name of jsonNames) {
    const payload =
      name === 'target-fingerprint.json'
        ? {
            releaseId,
            target,
            targetFingerprint: {
              database: target.database,
              schema: target.schema,
              serverVersion: 'PostgreSQL 16.4',
              migrationRows: [],
            },
          }
        : name === 'approval.json'
          ? {
              result: 'PASS',
              releaseId,
              target,
              approvalId: 'approval-20260928-001',
              decision: 'APPROVED_FOR_EXACT_BACKFILL',
              approver: 'data-owner',
              rollbackAuthority: 'release-manager',
              rollbackDecisionWindow: '24h',
            }
          : name === 'smoke-business.json'
            ? {
                result: 'PASS',
                releaseId,
                target,
                command: 'yarn test:unit',
                operator: 'qa-operator',
              }
            : name === 'observability-alert-test.json'
              ? {
                  result: 'PASS',
                  releaseId,
                  target,
                  source: {
                    identity: 'prometheus',
                    freshness: 'fresh',
                    snapshotDigest: digest,
                  },
                  acknowledgement: {
                    acknowledged: true,
                    route: 'alert-test-route',
                    destination: 'staging-on-call',
                    observedAt: '2026-09-28T12:00:00.000Z',
                  },
                }
              : { result: 'PASS', releaseId, target };
    await writeFile(join(directory, name), `${JSON.stringify(payload)}\n`);
  }
  await writeFile(
    join(directory, 'migration-status.txt'),
    'migrations=clean\n',
  );
  await writeFile(
    join(directory, 'signoff.json'),
    `${JSON.stringify({
      result: 'PASS',
      releaseId,
      target,
      operator: 'release-operator',
      reviewer: 'independent-reviewer',
      decision: 'REVIEWED',
      signedAt: '2026-09-28T12:00:00.000Z',
    })}\n`,
  );
  if (rollback && rollbackFile) {
    await mkdir(join(directory, 'rollback'), { recursive: true });
    await writeFile(join(directory, rollbackReference), 'rollback artifact\n');
  }
  if (writeChecksum && rollback && rollbackFile) {
    await writeChecksums({ artifactDirectory: directory });
  }
  return directory;
}

test('exposes the exact required evidence artifact list', () => {
  assert.deepEqual(REQUIRED_EVIDENCE, [
    'release-manifest.json',
    'target-fingerprint.json',
    'migration-status.txt',
    'preflight-before.json',
    'backup-manifest.json',
    'approval.json',
    'backfill-result.json',
    'preflight-after.json',
    'constraint-validation.json',
    'restore-rehearsal.json',
    'smoke-infrastructure.json',
    'smoke-auth-rbac.json',
    'smoke-business.json',
    'smoke-mobile-admin.json',
    'smoke-worker.json',
    'observability-alert-test.json',
    'runtime-integration.json',
    'staging-smoke.json',
    'checksums.txt',
    'signoff.json',
  ]);
});

test('fails closed when a required artifact is missing', async () => {
  const directory = await makeEvidenceDirectory();
  await import('node:fs/promises').then(({ unlink }) =>
    unlink(join(directory, 'smoke-worker.json')),
  );
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /missing required evidence artifact: smoke-worker\.json/,
  );
});

test('computes deterministic artifact hashes and does not overwrite artifacts', async () => {
  const directory = await makeEvidenceDirectory();
  const manifest = await createEvidenceManifest({
    releaseId,
    target,
    artifactDirectory: directory,
  });
  const repeated = await createEvidenceManifest({
    releaseId,
    target,
    artifactDirectory: directory,
  });
  assert.deepEqual(manifest.artifacts, repeated.artifacts);
  assertEvidenceComplete(manifest);
  await assert.rejects(
    writeChecksums({ artifactDirectory: directory }),
    /checksums\.txt already exists/,
  );
  const checksums = await readFile(join(directory, 'checksums.txt'), 'utf8');
  assert.match(checksums, /release-manifest\.json/);
  assert.match(checksums, /rollback\/imeal-20260927-004\.tar/);
});

test('writes checksums only through the explicit checksum command', async () => {
  const directory = await makeEvidenceDirectory({ writeChecksum: false });
  const result = await writeChecksums({ artifactDirectory: directory });
  assert.equal(result.path, join(directory, 'checksums.txt'));
  assert.match(await readFile(result.path, 'utf8'), /release-manifest\.json/);
});

test('rejects mutable image tags and missing rollback references', async () => {
  const mutableDirectory = await makeEvidenceDirectory();
  const mutableManifest = JSON.parse(
    await readFile(join(mutableDirectory, 'release-manifest.json'), 'utf8'),
  );
  mutableManifest.images.api = 'registry.example/api:staging';
  await writeFile(
    join(mutableDirectory, 'release-manifest.json'),
    JSON.stringify(mutableManifest),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: mutableDirectory,
    }),
    /immutable image digest/,
  );
  const rollbackDirectory = await makeEvidenceDirectory();
  const rollbackManifest = JSON.parse(
    await readFile(join(rollbackDirectory, 'release-manifest.json'), 'utf8'),
  );
  delete rollbackManifest.rollbackArtifact;
  await writeFile(
    join(rollbackDirectory, 'release-manifest.json'),
    JSON.stringify(rollbackManifest),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: rollbackDirectory,
    }),
    /rollback artifact reference/,
  );
});

test('rejects secret-bearing artifact content', async () => {
  const directory = await makeEvidenceDirectory();
  await writeFile(
    join(directory, 'smoke-worker.json'),
    JSON.stringify({ result: 'PASS', bearer: 'Bearer do-not-store' }),
  );
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /secret|redact/i,
  );
});

test('rejects artifacts from a different target', async () => {
  const directory = await makeEvidenceDirectory();
  await writeFile(
    join(directory, 'target-fingerprint.json'),
    JSON.stringify({
      result: 'PASS',
      releaseId,
      target: { database: 'other_staging', schema: target.schema },
    }),
  );
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /evidence target mismatch/,
  );
});

test('requires exact release and target bindings on every JSON artifact', async () => {
  const releaseDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(releaseDirectory, 'backup-manifest.json'),
    JSON.stringify({ result: 'PASS' }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: releaseDirectory,
    }),
    /evidence release binding is required: backup-manifest\.json/,
  );

  const targetDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(targetDirectory, 'preflight-before.json'),
    JSON.stringify({ result: 'PASS', releaseId }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: targetDirectory,
    }),
    /evidence target binding is required: preflight-before\.json/,
  );
});

test('binds every release-bearing artifact to the exact release', async () => {
  const directory = await makeEvidenceDirectory();
  await writeFile(
    join(directory, 'smoke-worker.json'),
    JSON.stringify({
      result: 'PASS',
      releaseId: 'imeal-20260928-002',
      target,
    }),
  );
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /evidence release mismatch: smoke-worker\.json/,
  );
});

test('rejects failed smoke and observability artifacts', async () => {
  const directory = await makeEvidenceDirectory();
  await writeFile(
    join(directory, 'smoke-worker.json'),
    JSON.stringify({ result: 'FAIL', releaseId, target }),
  );
  await assert.rejects(
    writeChecksums({ artifactDirectory: directory }),
    /smoke-worker\.json must have result PASS/,
  );
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /smoke-worker\.json must have result PASS/,
  );
});

test('requires fresh target-bound alert evidence without manufacturing acknowledgement', async () => {
  const missingAck = await makeEvidenceDirectory();
  const alertPath = join(missingAck, 'observability-alert-test.json');
  const alert = JSON.parse(await readFile(alertPath, 'utf8'));
  delete alert.acknowledgement;
  await writeFile(alertPath, JSON.stringify(alert));
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: missingAck }),
    /acknowledgement is required/,
  );

  for (const freshness of ['stale', 'unknown', 'collector_failure']) {
    const directory = await makeEvidenceDirectory();
    const evidencePath = join(directory, 'observability-alert-test.json');
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    evidence.source.freshness = freshness;
    await writeFile(evidencePath, JSON.stringify(evidence));
    await assert.rejects(
      createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
      /freshness is not fresh/,
    );
  }

  const unsafeRoute = await makeEvidenceDirectory();
  const unsafePath = join(unsafeRoute, 'observability-alert-test.json');
  const unsafe = JSON.parse(await readFile(unsafePath, 'utf8'));
  unsafe.acknowledgement.route = 'https://alerts.example.test/route';
  await writeFile(unsafePath, JSON.stringify(unsafe));
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: unsafeRoute }),
    /route is unsafe/,
  );

  const conflicting = await makeEvidenceDirectory();
  const conflictingPath = join(conflicting, 'observability-alert-test.json');
  const conflictingEvidence = JSON.parse(
    await readFile(conflictingPath, 'utf8'),
  );
  conflictingEvidence.source.conflict = { freshness: 'stale' };
  await writeFile(conflictingPath, JSON.stringify(conflictingEvidence));
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: conflicting }),
    /source evidence is required/,
  );
});

test('binds runtime and smoke artifacts and rejects incomplete phase evidence', async () => {
  const missingRuntime = await makeEvidenceDirectory();
  await unlink(join(missingRuntime, 'runtime-integration.json'));
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: missingRuntime,
    }),
    /missing required evidence artifact: runtime-integration\.json/,
  );

  const runtimeMismatch = await makeEvidenceDirectory();
  await writeFile(
    join(runtimeMismatch, 'runtime-integration.json'),
    JSON.stringify({ result: 'PASS', releaseId: 'other-release', target }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: runtimeMismatch,
    }),
    /evidence release mismatch: runtime-integration\.json/,
  );

  const smokeMismatch = await makeEvidenceDirectory();
  await writeFile(
    join(smokeMismatch, 'staging-smoke.json'),
    JSON.stringify({
      result: 'PASS',
      releaseId,
      target: { database: 'other_staging', schema: target.schema },
    }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: smokeMismatch,
    }),
    /evidence target mismatch: staging-smoke\.json/,
  );

  const failedPhase = await makeEvidenceDirectory();
  await writeFile(
    join(failedPhase, 'preflight-before.json'),
    JSON.stringify({ result: 'UNKNOWN', releaseId, target }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: failedPhase,
    }),
    /preflight-before\.json must have result PASS/,
  );

  const dirtyMigrations = await makeEvidenceDirectory();
  await writeFile(
    join(dirtyMigrations, 'migration-status.txt'),
    'migrations=pending\n',
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: dirtyMigrations,
    }),
    /migration-status\.txt must report migrations=clean/,
  );

  const badFingerprint = await makeEvidenceDirectory();
  await writeFile(
    join(badFingerprint, 'target-fingerprint.json'),
    JSON.stringify({ releaseId, target }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: badFingerprint,
    }),
    /target fingerprint structure or digest is invalid/,
  );
  const badDigest = await makeEvidenceDirectory();
  const fingerprintPath = join(badDigest, 'target-fingerprint.json');
  const fingerprintEvidence = JSON.parse(
    await readFile(fingerprintPath, 'utf8'),
  );
  fingerprintEvidence.targetFingerprint.digest = 'not-a-sha256';
  await writeFile(fingerprintPath, JSON.stringify(fingerprintEvidence));
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: badDigest,
    }),
    /target fingerprint structure or digest is invalid/,
  );
});

test('requires exact approval and independent signoff metadata', async () => {
  const approvalDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(approvalDirectory, 'approval.json'),
    JSON.stringify({
      result: 'PASS',
      releaseId,
      target,
      approvalId: 'approval-20260928-001',
      decision: 'REJECTED',
      approver: 'data-owner',
      rollbackAuthority: 'release-manager',
      rollbackDecisionWindow: '24h',
    }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: approvalDirectory,
    }),
    /approval decision is not exact backfill approval/,
  );

  const signoffDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(signoffDirectory, 'signoff.json'),
    JSON.stringify({
      result: 'PASS',
      releaseId,
      target,
      operator: 'same-person',
      reviewer: 'same-person',
      decision: 'REVIEWED',
      signedAt: '2026-09-28T12:00:00.000Z',
    }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: signoffDirectory,
    }),
    /signoff operator and reviewer must be distinct/,
  );
});

test('requires a local rollback file and covers it with a checksum', async () => {
  const tamperedDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(tamperedDirectory, 'rollback/imeal-20260927-004.tar'),
    'tampered rollback artifact\n',
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: tamperedDirectory,
    }),
    /checksums\.txt mismatch: rollback artifact/,
  );

  const directory = await makeEvidenceDirectory();
  await unlink(join(directory, 'rollback/imeal-20260927-004.tar'));
  await assert.rejects(
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /rollback artifact is missing/,
  );

  const traversalDirectory = await makeEvidenceDirectory();
  await writeFile(
    join(traversalDirectory, 'release-manifest.json'),
    JSON.stringify({
      releaseId,
      target,
      commitSha: 'b'.repeat(40),
      images: {
        api: `registry.example/api@sha256:${digest}`,
        worker: `registry.example/worker@sha256:${digest}`,
        adminWeb: `registry.example/admin@sha256:${digest}`,
      },
      migrations: ['20260928000000_phase0_domain_correctness'],
      rollbackArtifact: '../outside.tar',
    }),
  );
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: traversalDirectory,
    }),
    /rollback artifact must be a local bundle file/,
  );
});

test('requires a target fingerprint and rejects database overrides', () => {
  assert.deepEqual(
    resolveEvidenceTarget({
      targetId: target.schema,
      targetFingerprint: { target },
    }),
    target,
  );
  assert.throws(
    () =>
      resolveEvidenceTarget({
        targetId: target.schema,
        targetFingerprint: { target },
        targetDatabaseOverride: 'other_staging',
      }),
    /TARGET_DATABASE_NAME does not match target fingerprint/,
  );
  assert.throws(
    () =>
      resolveEvidenceTarget({
        targetId: target.schema,
        targetFingerprint: { target: { schema: target.schema } },
      }),
    /target fingerprint does not match --target/,
  );
});
