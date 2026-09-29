import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_EVIDENCE,
  assertEvidenceComplete,
  createEvidenceManifest,
  writeChecksums,
} from './evidence.mjs';

const releaseId = 'imeal-20260928-001';
const target = { database: 'imeal_staging', schema: 'phase0_staging_20260928' };
const digest = 'a'.repeat(64);

async function makeEvidenceDirectory({
  mutableImage = false,
  rollback = true,
  writeChecksum = true,
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
    ...(rollback
      ? { rollbackArtifact: 'rollback/imeal-20260927-004.tar' }
      : {}),
  };
  const jsonNames = REQUIRED_EVIDENCE.filter(
    (name) => name.endsWith('.json') && name !== 'release-manifest.json',
  );
  await writeFile(
    join(directory, 'release-manifest.json'),
    `${JSON.stringify(releaseManifest)}\n`,
  );
  for (const name of jsonNames) {
    await writeFile(
      join(directory, name),
      `${JSON.stringify({ result: 'PASS', releaseId, target })}\n`,
    );
  }
  await writeFile(
    join(directory, 'migration-status.txt'),
    'migrations=clean\n',
  );
  await writeFile(
    join(directory, 'signoff.json'),
    `${JSON.stringify({ result: 'PASS', releaseId, target, decision: 'REVIEWED' })}\n`,
  );
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
  assert.match(
    await readFile(join(directory, 'checksums.txt'), 'utf8'),
    /release-manifest\.json/,
  );
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
