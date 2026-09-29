import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { assertNoSecrets, parseArgs, sha256File } from './staging-lib.mjs';

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/i;
const IMAGE_DIGEST_PATTERN = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$/;
const REQUIRED_CHECKS = ['typecheck', 'unit', 'db', 'security'];
const REQUIRED_MANIFEST_KEYS = [
  'releaseId',
  'commit',
  'lockfileSha256',
  'images',
  'migrations',
  'checks',
  'sbom',
  'stagingSmoke',
  'rollbackArtifact',
  'stagingScripts',
];
const SENSITIVE_TEXT_PATTERN =
  /(?:postgres(?:ql)?:\/\/[^\s<]+@|\bBearer\s+(?!<redacted>)[^\s]+|\b(?:password|token|secret|api[_-]?key|otp)\b\s*[:=]\s*(?!<redacted>)[^\s,}\]]+)/i;

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
}

function assertReleaseId(value) {
  const releaseId = assertString(value, 'release ID');
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error('release ID must contain only safe identifier characters');
  }
  return releaseId;
}

function assertCommit(value) {
  const commit = assertString(value, 'commit');
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error('commit must be a hexadecimal git commit');
  }
  return commit;
}

function assertReference(value, label) {
  const reference = assertString(value, label);
  if (!REFERENCE_PATTERN.test(reference)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  if (SENSITIVE_TEXT_PATTERN.test(reference)) {
    throw new Error(`${label} must be redacted`);
  }
  if (/(^|[:/@])latest(?:$|[^A-Za-z0-9])/i.test(reference)) {
    throw new Error(`${label} must not use a mutable latest reference`);
  }
  return reference;
}

function assertSha256(value, label) {
  const digest = assertString(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return digest.toLowerCase();
}

function assertImmutableImage(value, label) {
  const image = assertString(value, label);
  if (image !== image.trim() || !IMAGE_DIGEST_PATTERN.test(image)) {
    throw new Error(`${label} must use an immutable image digest`);
  }
  if (/:latest(?:@|$)/i.test(image)) {
    throw new Error(`${label} must not use a mutable tag`);
  }
  return image;
}

function assertSafeManifestText(manifest) {
  try {
    assertNoSecrets(manifest);
  } catch {
    throw new Error('release manifest contains secret-like values');
  }
  if (SENSITIVE_TEXT_PATTERN.test(JSON.stringify(manifest))) {
    throw new Error('release manifest contains unredacted values');
  }
}

function canonicalImages(images) {
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new Error('release manifest images are required');
  }
  try {
    assertNoSecrets(images);
  } catch {
    throw new Error('release image references contain secret-like values');
  }
  if (SENSITIVE_TEXT_PATTERN.test(JSON.stringify(images))) {
    throw new Error('release image references contain unredacted values');
  }
  const allowed = new Set(['api', 'worker', 'adminWeb', 'admin-web']);
  if (Object.keys(images).some((key) => !allowed.has(key))) {
    throw new Error('release images contain unsupported fields');
  }
  const adminWeb = images.adminWeb ?? images['admin-web'];
  return {
    api: assertImmutableImage(images.api, 'api image'),
    worker: assertImmutableImage(images.worker, 'worker image'),
    adminWeb: assertImmutableImage(adminWeb, 'admin web image'),
  };
}

function canonicalChecks(checkResults) {
  if (
    !checkResults ||
    typeof checkResults !== 'object' ||
    Array.isArray(checkResults)
  ) {
    throw new Error('release check results are required');
  }
  try {
    assertNoSecrets(checkResults);
  } catch {
    throw new Error('release check results contain secret-like values');
  }
  if (SENSITIVE_TEXT_PATTERN.test(JSON.stringify(checkResults))) {
    throw new Error('release check results contain unredacted values');
  }
  const checks = {};
  for (const name of REQUIRED_CHECKS) {
    const value = checkResults[name];
    const result =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? value.result
          : undefined;
    if (result !== 'PASS') {
      throw new Error(`${name} check must be PASS`);
    }
    checks[name] = 'PASS';
  }
  return checks;
}

function canonicalMigrations(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error('release migrations are required');
  }
  const names = migrations.map((name) => {
    const migration = assertString(name, 'migration name');
    if (
      migration.includes('/') ||
      migration.includes('\\') ||
      migration === '.' ||
      migration === '..'
    ) {
      throw new Error('migration names must be directory names');
    }
    return migration;
  });
  const sorted = [...new Set(names)].sort();
  if (
    sorted.length !== names.length ||
    sorted.some((name, index) => name !== names[index])
  ) {
    throw new Error('migrations must be unique and lexicographically ordered');
  }
  return sorted;
}

function canonicalStagingScripts(stagingScripts) {
  if (
    !stagingScripts ||
    typeof stagingScripts !== 'object' ||
    Array.isArray(stagingScripts) ||
    Object.keys(stagingScripts).length === 0
  ) {
    throw new Error('checked-in staging script hashes are required');
  }
  const names = Object.keys(stagingScripts).sort();
  const result = {};
  for (const name of names) {
    if (!name.startsWith('scripts/staging/') || name.endsWith('/')) {
      throw new Error('staging script paths are invalid');
    }
    result[name] = assertSha256(
      stagingScripts[name],
      `staging script hash: ${name}`,
    );
  }
  return result;
}

export function assertReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('release manifest must be an object');
  }
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (!Object.hasOwn(manifest, key)) {
      throw new Error(`release manifest is missing ${key}`);
    }
  }
  if (
    Object.keys(manifest).some((key) => !REQUIRED_MANIFEST_KEYS.includes(key))
  ) {
    throw new Error('release manifest contains unsupported fields');
  }
  assertSafeManifestText(manifest);
  assertReleaseId(manifest.releaseId);
  assertCommit(manifest.commit);
  assertSha256(manifest.lockfileSha256, 'lockfile SHA-256');
  canonicalImages(manifest.images);
  canonicalMigrations(manifest.migrations);
  const checks = canonicalChecks(manifest.checks);
  if (
    Object.keys(manifest.checks).some((key) => !REQUIRED_CHECKS.includes(key))
  ) {
    throw new Error('release checks contain unsupported fields');
  }
  if (JSON.stringify(checks) !== JSON.stringify(manifest.checks)) {
    throw new Error('release checks must contain only PASS results');
  }
  assertReference(manifest.sbom, 'SBOM reference');
  assertReference(manifest.stagingSmoke, 'staging smoke reference');
  assertReference(manifest.rollbackArtifact, 'rollback artifact');
  canonicalStagingScripts(manifest.stagingScripts);
  return true;
}

async function runGit(repositoryPath, args) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repositoryPath, ...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    throw new Error('git repository inspection failed');
  }
}

async function assertCleanRepository(repositoryPath, commit) {
  const topLevel = resolve(
    await runGit(repositoryPath, ['rev-parse', '--show-toplevel']),
  );
  if (topLevel !== resolve(repositoryPath)) {
    throw new Error('repository path must be the git worktree root');
  }
  const status = await runGit(repositoryPath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (status !== '') {
    throw new Error('git worktree must be clean');
  }
  const head = await runGit(repositoryPath, ['rev-parse', 'HEAD']);
  const requestedCommit = assertCommit(commit);
  if (!head.startsWith(requestedCommit)) {
    throw new Error('manifest commit must match HEAD');
  }
}

function assertInsideRepository(repositoryPath, filePath, label) {
  const absolute = resolve(filePath);
  const relativePath = relative(repositoryPath, absolute);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolute;
}

async function assertRegularFile(filePath, label) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new Error(`${label} is missing`);
  }
  if (!metadata.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

async function readMigrationNames(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error('migrations directory is missing');
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return canonicalMigrations(names);
}

async function readStagingScripts(repositoryPath) {
  const output = await runGit(repositoryPath, [
    'ls-files',
    '-z',
    '--',
    'scripts/staging',
  ]);
  const names = output ? output.split('\0').filter(Boolean).sort() : [];
  if (names.length === 0) {
    throw new Error('no checked-in staging scripts found');
  }
  const hashes = {};
  for (const name of names) {
    const filePath = resolve(repositoryPath, name);
    await assertRegularFile(filePath, `staging script ${name}`);
    hashes[name] = await sha256File(filePath);
  }
  return hashes;
}

export async function createReleaseManifest({
  releaseId,
  commit,
  lockfilePath,
  imageDigests,
  migrationsDirectory,
  checkResults,
  rollbackArtifact,
  repositoryPath = process.cwd(),
}) {
  const repository = resolve(assertString(repositoryPath, 'repository path'));
  const normalizedReleaseId = assertReleaseId(releaseId);
  const normalizedCommit = assertCommit(commit);
  await assertCleanRepository(repository, normalizedCommit);

  const lockfile = assertInsideRepository(
    repository,
    assertString(lockfilePath, 'lockfile path'),
    'lockfile',
  );
  await assertRegularFile(lockfile, 'lockfile');
  const migrationsDirectoryPath = assertInsideRepository(
    repository,
    assertString(migrationsDirectory, 'migrations directory'),
    'migrations directory',
  );
  const migrationMetadata = await lstat(migrationsDirectoryPath).catch(
    () => undefined,
  );
  if (!migrationMetadata?.isDirectory()) {
    throw new Error('migrations directory is missing');
  }

  const checks = canonicalChecks(checkResults);
  const sbom = assertReference(
    checkResults.sbom ?? checkResults.sbomReference,
    'SBOM reference',
  );
  const stagingSmoke = assertReference(
    checkResults.stagingSmoke ?? checkResults.stagingSmokeReference,
    'staging smoke reference',
  );
  const manifest = {
    releaseId: normalizedReleaseId,
    commit: normalizedCommit,
    lockfileSha256: await sha256File(lockfile),
    images: canonicalImages(imageDigests),
    migrations: await readMigrationNames(migrationsDirectoryPath),
    checks,
    sbom,
    stagingSmoke,
    rollbackArtifact: assertReference(rollbackArtifact, 'rollback artifact'),
    stagingScripts: await readStagingScripts(repository),
  };
  assertReleaseManifest(manifest);
  return manifest;
}

async function readJsonFile(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

async function writeManifest(outputPath, manifest) {
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    await writeFile(path, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o440,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('manifest output already exists');
    }
    throw error;
  }
}

async function main(argv) {
  const args = parseArgs(argv, {
    'release-id': { type: 'string', required: true },
    commit: { type: 'string' },
    'lockfile-path': { type: 'string', default: 'yarn.lock' },
    'images-json': { type: 'string', required: true },
    'checks-json': { type: 'string', required: true },
    'migrations-directory': {
      type: 'string',
      default: 'packages/domain/prisma/migrations',
    },
    'rollback-artifact': { type: 'string', required: true },
    output: { type: 'string', default: 'artifacts/release-manifest.json' },
    repository: { type: 'string', default: process.cwd() },
  });
  const repository = resolve(args.repository);
  const commit =
    args.commit ?? (await runGit(repository, ['rev-parse', 'HEAD']));
  const imageDigests = await readJsonFile(args['images-json'], 'image digests');
  const checkResults = await readJsonFile(args['checks-json'], 'check results');
  const manifest = await createReleaseManifest({
    releaseId: args['release-id'],
    commit,
    lockfilePath: resolve(repository, args['lockfile-path']),
    imageDigests,
    migrationsDirectory: resolve(repository, args['migrations-directory']),
    checkResults,
    rollbackArtifact: args['rollback-artifact'],
    repositoryPath: repository,
  });
  await writeManifest(args.output, manifest);
  process.stdout.write(
    `${JSON.stringify({ releaseId: manifest.releaseId, output: resolve(args.output) })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || 'release manifest failed'}\n`);
    process.exitCode = 1;
  });
}
