import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertReleaseManifest,
  createReleaseManifest,
} from './release-manifest.mjs';

const execFileAsync = promisify(execFile);
const DIGEST_A = `registry.example/imeal/api@sha256:${'a'.repeat(64)}`;
const DIGEST_B = `registry.example/imeal/worker@sha256:${'b'.repeat(64)}`;
const DIGEST_C = `registry.example/imeal/admin@sha256:${'c'.repeat(64)}`;

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function fixture() {
  const temporaryRepositoryPath = await mkdtemp(join(tmpdir(), 'release-manifest-'));
  await git(temporaryRepositoryPath, ['init', '--quiet']);
  const repositoryPath = await git(temporaryRepositoryPath, ['rev-parse', '--show-toplevel']);
  await git(repositoryPath, ['config', 'user.email', 'ci@example.test']);
  await git(repositoryPath, ['config', 'user.name', 'CI']);
  await writeFile(join(repositoryPath, 'yarn.lock'), 'lockfile fixture\n');
  const migrationsDirectory = join(
    repositoryPath,
    'packages/domain/prisma/migrations',
  );
  for (const name of ['20260928000000_latest', '20260924000000_first']) {
    await mkdir(join(migrationsDirectory, name), { recursive: true });
    await writeFile(
      join(migrationsDirectory, name, 'migration.sql'),
      '-- fixture\n',
    );
  }
  const stagingDirectory = join(repositoryPath, 'scripts/staging');
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(
    join(stagingDirectory, 'smoke-staging.mjs'),
    'export const smoke = true;\n',
  );
  await writeFile(
    join(stagingDirectory, 'staging-lib.mjs'),
    'export const lib = true;\n',
  );
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '--quiet', '-m', 'fixture']);
  const commit = await git(repositoryPath, ['rev-parse', 'HEAD']);
  const canonicalRepositoryPath = await git(repositoryPath, ['rev-parse', '--show-toplevel']);
  return {
    repositoryPath: canonicalRepositoryPath,
    lockfilePath: join(canonicalRepositoryPath, 'yarn.lock'),
    migrationsDirectory: join(
      canonicalRepositoryPath,
      'packages/domain/prisma/migrations',
    ),
    commit,
  };
}

function options(fixtureData, overrides = {}) {
  return {
    repositoryPath: fixtureData.repositoryPath,
    releaseId: 'imeal-20260928-001',
    commit: fixtureData.commit,
    lockfilePath: fixtureData.lockfilePath,
    imageDigests: {
      api: DIGEST_A,
      worker: DIGEST_B,
      adminWeb: DIGEST_C,
    },
    migrationsDirectory: fixtureData.migrationsDirectory,
    checkResults: {
      typecheck: 'PASS',
      lint: 'PASS',
      unit: 'PASS',
      prisma: 'PASS',
      db: 'PASS',
      compose: 'PASS',
      stagingTools: 'PASS',
      security: 'PASS',
      runtimeIntegration: 'PASS',
      stagingSmoke: 'PASS',
      sbom: 'artifacts/sbom.spdx.json',
      stagingSmokeReference: 'artifacts/staging-smoke.json',
    },
    rollbackArtifact: 'imeal-20260927-004',
    ...overrides,
  };
}

test('creates a deterministic immutable release manifest', async () => {
  const fixtureData = await fixture();
  const manifest = await createReleaseManifest(options(fixtureData));
  const lockfileSha256 = createHash('sha256')
    .update(await readFile(fixtureData.lockfilePath))
    .digest('hex');

  assert.deepEqual(manifest, {
    releaseId: 'imeal-20260928-001',
    commit: fixtureData.commit,
    lockfileSha256,
    images: {
      api: DIGEST_A,
      worker: DIGEST_B,
      adminWeb: DIGEST_C,
    },
    migrations: ['20260924000000_first', '20260928000000_latest'],
    checks: {
      typecheck: 'PASS',
      lint: 'PASS',
      unit: 'PASS',
      prisma: 'PASS',
      db: 'PASS',
      compose: 'PASS',
      stagingTools: 'PASS',
      security: 'PASS',
      runtimeIntegration: 'PASS',
      stagingSmoke: 'PASS',
    },
    sbom: 'artifacts/sbom.spdx.json',
    stagingSmoke: 'artifacts/staging-smoke.json',
    rollbackArtifact: 'imeal-20260927-004',
    stagingScripts: {
      'scripts/staging/smoke-staging.mjs': createHash('sha256')
        .update('export const smoke = true;\n')
        .digest('hex'),
      'scripts/staging/staging-lib.mjs': createHash('sha256')
        .update('export const lib = true;\n')
        .digest('hex'),
    },
  });
  assert.doesNotThrow(() => assertReleaseManifest(manifest));
  assert.deepEqual(manifest, await createReleaseManifest(options(fixtureData)));
});

test('fails closed when the worktree is dirty', async () => {
  const fixtureData = await fixture();
  await writeFile(
    join(fixtureData.repositoryPath, 'dirty.txt'),
    'not committed\n',
  );
  await assert.rejects(
    createReleaseManifest(options(fixtureData)),
    /worktree must be clean/i,
  );
});

test('rejects mutable image references and missing or failed checks', async () => {
  const fixtureData = await fixture();
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        imageDigests: { api: 'registry.example/imeal/api:latest' },
      }),
    ),
    /immutable image digest/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        checkResults: { ...options(fixtureData).checkResults, db: 'FAIL' },
      }),
    ),
    /db.*PASS/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        checkResults: {
          ...options(fixtureData).checkResults,
          security: undefined,
        },
      }),
    ),
    /security.*PASS/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        checkResults: {
          ...options(fixtureData).checkResults,
          lint: undefined,
        },
      }),
    ),
    /lint.*PASS/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        checkResults: {
          ...options(fixtureData).checkResults,
          runtimeIntegration: undefined,
        },
      }),
    ),
    /runtimeIntegration.*PASS/i,
  );
});

test('CLI writes a redacted manifest without operational credentials', async () => {
  const fixtureData = await fixture();
  const inputDirectory = await mkdtemp(join(tmpdir(), 'release-manifest-cli-'));
  const imagesPath = join(inputDirectory, 'images.json');
  const checksPath = join(inputDirectory, 'checks.json');
  const outputPath = join(inputDirectory, 'release-manifest.json');
  await writeFile(
    imagesPath,
    JSON.stringify(options(fixtureData).imageDigests),
  );
  await writeFile(
    checksPath,
    JSON.stringify(options(fixtureData).checkResults),
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      fileURLToPath(new URL('./release-manifest.mjs', import.meta.url)),
      '--release-id',
      'imeal-20260928-001',
      '--repository',
      fixtureData.repositoryPath,
      '--images-json',
      imagesPath,
      '--checks-json',
      checksPath,
      '--rollback-artifact',
      'imeal-20260927-004',
      '--output',
      outputPath,
    ],
    { cwd: fixtureData.repositoryPath },
  );
  assert.match(stdout, /imeal-20260928-001/);
  const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /password|token|secret|Bearer/i,
  );
  assert.doesNotThrow(() => assertReleaseManifest(manifest));
});

test('rejects secret-like input and tampered manifests', async () => {
  const fixtureData = await fixture();
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        releaseId: 'postgresql://user:password@db/imeal',
      }),
    ),
    /safe identifier|secret|redacted/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        imageDigests: {
          ...options(fixtureData).imageDigests,
          note: 'token: leaked',
        },
      }),
    ),
    /secret-like|redacted/i,
  );
  await assert.rejects(
    createReleaseManifest(
      options(fixtureData, {
        checkResults: {
          ...options(fixtureData).checkResults,
          db: { result: 'PASS', note: 'password: leaked' },
        },
      }),
    ),
    /secret-like|redacted/i,
  );
  const manifest = await createReleaseManifest(options(fixtureData));
  assert.throws(
    () =>
      assertReleaseManifest({
        ...manifest,
        images: { ...manifest.images, api: 'registry.example/api:latest' },
      }),
    /immutable image digest/i,
  );
  assert.throws(
    () =>
      assertReleaseManifest({
        ...manifest,
        checks: { ...manifest.checks, unit: 'FAIL' },
      }),
    /unit.*PASS/i,
  );
  assert.throws(
    () => assertReleaseManifest({ ...manifest, sbom: 'Bearer secret-token' }),
    /secret|redacted/i,
  );
});
