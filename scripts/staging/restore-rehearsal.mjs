import { readFile, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { defaultCommandRunner } from './backup-staging.mjs';
import { parseArgs, sha256File, writeEvidence } from './staging-lib.mjs';

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{2,62}$/;
const PRODUCTION_PATTERN =
  /(?:^|[-_.\/])(prod(?:uction)?|primary|live)(?:$|[-_.\/])/i;
const URL_CREDENTIAL_PATTERN = /\/\/[^/\s@]+@/;

function assertReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid release id');
  }
  return value;
}

function assertRestoreDatabase(value, sourceDatabase) {
  if (typeof value !== 'string' || !DATABASE_PATTERN.test(value)) {
    throw new Error('restore database is invalid');
  }
  if (
    PRODUCTION_PATTERN.test(value) ||
    !/(restore|rehearsal|recovery)/i.test(value)
  ) {
    throw new Error('restore database must be an isolated restore target');
  }
  if (value === sourceDatabase) {
    throw new Error('restore database must differ from source database');
  }
  return value;
}

function assertRestoreBucket(value, sourceBucket) {
  if (typeof value !== 'string' || !BUCKET_PATTERN.test(value)) {
    throw new Error('restore bucket is invalid');
  }
  if (
    PRODUCTION_PATTERN.test(value) ||
    /public/i.test(value) ||
    !/(restore|rehearsal|recovery)/i.test(value)
  ) {
    throw new Error('restore bucket must be an isolated private target');
  }
  if (value === sourceBucket) {
    throw new Error('restore bucket must differ from source bucket');
  }
  return value;
}

function scrubDiagnostic(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://<redacted>')
    .replace(
      /\b(password|token|secret|api[_-]?key|otp)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=<redacted>',
    );
}

async function readManifest(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `backup manifest cannot be read: ${scrubDiagnostic(error)}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new Error('backup manifest is invalid JSON');
  }
  if (!manifest || typeof manifest !== 'object' || manifest.result !== 'PASS') {
    throw new Error('backup manifest must be a PASS artifact');
  }
  return manifest;
}

function assertStorageReference(storage) {
  if (!storage || typeof storage !== 'object') {
    throw new Error('backup storage reference is missing');
  }
  const { endpoint, bucket, key } = storage;
  if (typeof endpoint !== 'string' || URL_CREDENTIAL_PATTERN.test(endpoint)) {
    throw new Error('backup storage endpoint is invalid');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('backup storage endpoint is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('backup storage endpoint must use HTTP(S)');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('backup storage endpoint must not contain credentials');
  }
  if (PRODUCTION_PATTERN.test(parsed.hostname)) {
    throw new Error('backup storage endpoint must not identify production');
  }
  if (typeof bucket !== 'string' || !BUCKET_PATTERN.test(bucket)) {
    throw new Error('backup storage bucket is invalid');
  }
  if (PRODUCTION_PATTERN.test(bucket) || /public/i.test(bucket)) {
    throw new Error('backup storage bucket must be private staging');
  }
  if (typeof key !== 'string' || key.length === 0 || key.includes('..')) {
    throw new Error('backup storage key is invalid');
  }
  return { endpoint, bucket, key };
}

function assertArtifact(manifest, manifestPath) {
  const artifact = manifest.artifact;
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('backup artifact metadata is missing');
  }
  if (
    typeof artifact.encryptedFile !== 'string' ||
    artifact.encryptedFile.length === 0 ||
    artifact.encryptedFile !== basename(artifact.encryptedFile) ||
    !/^[A-Za-z0-9._-]+$/.test(artifact.encryptedFile)
  ) {
    throw new Error('backup artifact path is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error('backup artifact checksum is invalid');
  }
  const root = dirname(resolve(manifestPath));
  return {
    ...artifact,
    path: join(root, artifact.encryptedFile),
    sha256: artifact.sha256.toLowerCase(),
  };
}

function assertCheckResult(value, label) {
  if (value === false || (value && value.result === 'FAIL')) {
    throw new Error(`${label} failed`);
  }
  return { result: 'PASS' };
}

async function runCommand(commandRunner, command, args, label) {
  let result;
  try {
    result = await commandRunner(command, args, { shell: false });
  } catch (error) {
    throw new Error(`${label} could not start: ${scrubDiagnostic(error)}`);
  }
  if (!result || result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${result?.exitCode ?? 'unknown'}: ${scrubDiagnostic(result?.stderr?.trim() || 'no diagnostics')}`,
    );
  }
  return result;
}

function assertOutputPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('output path is required');
  }
  return value;
}

function basename(value) {
  return value.split(/[\\/]/).at(-1);
}

export async function restoreRehearsal({
  backupManifestPath,
  restoreDatabase,
  restoreBucket,
  outputPath,
  commandRunner = defaultCommandRunner,
  readinessCheck,
  smokeCheck,
}) {
  assertOutputPath(outputPath);
  if (
    typeof backupManifestPath !== 'string' ||
    backupManifestPath.length === 0
  ) {
    throw new Error('backup manifest path is required');
  }
  const startedAt = new Date().toISOString();
  let manifest;
  let safeRestoreDatabase;
  let safeRestoreBucket;
  let restoreDumpPath;
  try {
    manifest = await readManifest(backupManifestPath);
    if (manifest.encryption?.algorithm !== 'age') {
      throw new Error('backup encryption algorithm must be age');
    }
    const releaseId = assertReleaseId(manifest.releaseId);
    const sourceDatabase = manifest.target?.database;
    if (
      typeof sourceDatabase !== 'string' ||
      !DATABASE_PATTERN.test(sourceDatabase)
    ) {
      throw new Error('backup source database is invalid');
    }
    const storage = assertStorageReference(manifest.storage);
    safeRestoreDatabase = assertRestoreDatabase(
      restoreDatabase,
      sourceDatabase,
    );
    safeRestoreBucket = assertRestoreBucket(restoreBucket, storage.bucket);
    const artifact = assertArtifact(manifest, backupManifestPath);
    const actualSha256 = await sha256File(artifact.path);
    if (actualSha256 !== artifact.sha256) {
      throw new Error('backup artifact checksum mismatch');
    }
    const artifactStats = await stat(artifact.path);
    if (
      Number.isInteger(artifact.bytes) &&
      artifactStats.size !== artifact.bytes
    ) {
      throw new Error('backup artifact byte count mismatch');
    }
    restoreDumpPath = join(
      dirname(resolve(backupManifestPath)),
      `${releaseId}.restore.dump`,
    );
    await runCommand(
      commandRunner,
      'age',
      ['--decrypt', '--output', restoreDumpPath, artifact.path],
      'age decryption',
    );

    await runCommand(
      commandRunner,
      'createdb',
      ['--maintenance-db=postgres', safeRestoreDatabase],
      'isolated restore database creation',
    );
    await runCommand(
      commandRunner,
      'pg_restore',
      [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        safeRestoreDatabase,
        restoreDumpPath,
      ],
      'isolated PostgreSQL restore',
    );
    await unlink(restoreDumpPath).catch(() => {});
    await runCommand(
      commandRunner,
      'aws',
      [
        's3',
        'cp',
        `s3://${storage.bucket}/${storage.key}`,
        `s3://${safeRestoreBucket}/${storage.key}`,
        '--endpoint-url',
        storage.endpoint,
        '--no-progress',
        '--acl',
        'private',
      ],
      'isolated object restore',
    );

    const readiness = readinessCheck
      ? assertCheckResult(
          await readinessCheck({
            database: safeRestoreDatabase,
            bucket: safeRestoreBucket,
          }),
          'readiness check',
        )
      : { result: 'PASS', command: 'pg_isready' };
    if (!readinessCheck) {
      await runCommand(
        commandRunner,
        'pg_isready',
        ['--dbname', safeRestoreDatabase],
        'restore readiness check',
      );
    }
    const smoke = smokeCheck
      ? assertCheckResult(
          await smokeCheck({
            database: safeRestoreDatabase,
            bucket: safeRestoreBucket,
          }),
          'smoke check',
        )
      : { result: 'PASS', command: 'psql' };
    if (!smokeCheck) {
      await runCommand(
        commandRunner,
        'psql',
        ['--dbname', safeRestoreDatabase, '--command', 'SELECT 1;'],
        'restore smoke check',
      );
    }
    const completedAt = new Date().toISOString();
    const backupCompleted = Date.parse(manifest.timestamps?.completedAt);
    const restoreStarted = Date.parse(startedAt);
    const rpoSeconds = Number.isFinite(backupCompleted)
      ? Math.max(0, (restoreStarted - backupCompleted) / 1000)
      : null;
    const rtoSeconds = Math.max(
      0,
      (Date.parse(completedAt) - restoreStarted) / 1000,
    );
    const report = {
      result: 'PASS',
      kind: 'restore-rehearsal',
      releaseId,
      restoreDatabase: safeRestoreDatabase,
      restoreBucket: safeRestoreBucket,
      timestamps: { startedAt, completedAt },
      rpoSeconds,
      rtoSeconds,
      checksums: { artifact: 'PASS', sha256: artifact.sha256 },
      database: { restored: 'PASS' },
      objects: { restored: 'PASS', count: manifest.objects?.count ?? 1 },
      readiness,
      smoke,
    };
    await writeEvidence(outputPath, report);
    return report;
  } catch (error) {
    if (restoreDumpPath) await unlink(restoreDumpPath).catch(() => {});
    const completedAt = new Date().toISOString();
    const failureReport = {
      result: 'FAIL',
      kind: 'restore-rehearsal',
      releaseId:
        typeof manifest?.releaseId === 'string'
          ? manifest.releaseId
          : 'unknown',
      restoreDatabase: safeRestoreDatabase ?? restoreDatabase,
      restoreBucket: safeRestoreBucket ?? restoreBucket,
      timestamps: { startedAt, completedAt },
      rpoSeconds: null,
      rtoSeconds: null,
      failure: scrubDiagnostic(error instanceof Error ? error.message : error),
    };
    await writeEvidence(outputPath, failureReport).catch(() => {});
    throw error;
  }
}

const CLI_SCHEMA = {
  manifest: { type: 'string', required: true },
  'restore-database': { type: 'string', required: true },
  'restore-bucket': { type: 'string', required: true },
  output: { type: 'string', required: true },
};

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, CLI_SCHEMA);
  return restoreRehearsal({
    backupManifestPath: options.manifest,
    restoreDatabase: options['restore-database'],
    restoreBucket: options['restore-bucket'],
    outputPath: options.output,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((report) =>
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
