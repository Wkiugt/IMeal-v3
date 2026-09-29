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
  mutableImage = false,
  rollback = true,
  writeChecksum = true,
  rollbackReference = 'rollback/imeal-20260927-004.tar',
  rollbackFile = true,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'staging-evidence-'));
  const image = mutableImage
    ? 'registry.example/api:staging'
    : `registry.example/api@sha256:${digest}`;
  const releaseManifest = {
    releaseId,
    commitSha: 'b'.repeat(40),
    images: {
      api: image,
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
    `${JSON.stringify({ target })}\n`,
  );
  for (const name of jsonNames) {
    const payload =
      name === 'approval.json'
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
  if (writeChecksum) await writeChecksums({ artifactDirectory: directory });
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
  const mutableDirectory = await makeEvidenceDirectory({ mutableImage: true });
  await assert.rejects(
    createEvidenceManifest({
      releaseId,
      target,
      artifactDirectory: mutableDirectory,
    }),
    /immutable image digest/,
  );
  const rollbackDirectory = await makeEvidenceDirectory({ rollback: false });
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
    createEvidenceManifest({ releaseId, target, artifactDirectory: directory }),
    /smoke-worker\.json must have result PASS/,
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
