import childProcess from 'node:child_process';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import {
  filterPostgresEnvironment,
  parseArgs,
  parseDatabaseConnection,
  requireSafeSchemaName,
  safeDiagnostic,
  sha256File,
  writeEvidence,
} from './staging-lib.mjs';
import { fingerprintTarget } from './phase0-preflight.mjs';

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const PRODUCTION_PATTERN =
  /(?:^|[-_.\/])(prod(?:uction)?|primary|live)(?:$|[-_.\/])/i;

function assertReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid release id');
  }
  return value;
}

function assertEnvironmentName(value) {
  if (typeof value !== 'string' || !ENV_NAME_PATTERN.test(value)) {
    throw new Error('invalid encryption recipient environment name');
  }
  return value;
}

function assertNonProduction(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (PRODUCTION_PATTERN.test(normalized)) {
    throw new Error(`${label} must not identify production`);
  }
  return value;
}

function sourceTarget(databaseUrl) {
  const source = parseDatabaseConnection(databaseUrl);
  if (!IDENTIFIER_PATTERN.test(source.database)) {
    throw new Error('database name is invalid');
  }
  assertNonProduction(source.host, 'database host');
  assertNonProduction(source.database, 'database name');
  return {
    ...source,
    username: source.username ?? '',
  };
}

function assertObjectStorage(objectStorage) {
  if (!objectStorage || typeof objectStorage !== 'object') {
    throw new Error('object storage settings are required');
  }
  const { endpoint, bucket, destination } = objectStorage;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error('object storage endpoint is required');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('object storage endpoint is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('object storage endpoint must use HTTP(S)');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('object storage endpoint must not contain credentials');
  }
  assertNonProduction(parsed.hostname, 'object storage host');
  if (
    typeof bucket !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]{2,62}$/.test(bucket)
  ) {
    throw new Error('object storage bucket is invalid');
  }
  assertNonProduction(bucket, 'object storage bucket');
  if (
    typeof destination !== 'string' ||
    !DESTINATION_PATTERN.test(destination) ||
    destination.includes('..') ||
    destination.includes('//')
  ) {
    throw new Error('object storage destination is invalid');
  }
  assertNonProduction(destination, 'object storage destination');
  if (/public/i.test(bucket) || /public/i.test(destination)) {
    throw new Error('object storage destination must be private');
  }
  return {
    endpoint: parsed.origin,
    endpointForCommand: endpoint,
    bucket,
    destination: destination.replace(/\/+$/, ''),
  };
}

export function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(command, args, {
      ...options,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) =>
      resolvePromise({ stdout, stderr, exitCode }),
    );
  });
}

async function runCommand(
  commandRunner,
  command,
  args,
  label,
  commandOptions = {},
) {
  let result;
  try {
    result = await commandRunner(command, args, {
      ...commandOptions,
      shell: false,
    });
  } catch (error) {
    throw new Error(`${label} could not start: ${safeDiagnostic(error)}`);
  }
  if (!result || result.exitCode !== 0) {
    const detail = safeDiagnostic(result?.stderr?.trim() || 'no diagnostics');
    throw new Error(
      `${label} failed with exit code ${result?.exitCode ?? 'unknown'}: ${detail}`,
    );
  }
  return result;
}

async function cleanupPlaintext(fileRemover, dumpPath) {
  try {
    await fileRemover(dumpPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error(`plaintext dump cleanup failed: ${safeDiagnostic(error)}`);
  }
}

async function toolVersion(commandRunner, command, args) {
  const result = await runCommand(
    commandRunner,
    command,
    args,
    `${command} version`,
  );
  const version = String(result.stdout || result.stderr || '')
    .trim()
    .split(/\r?\n/, 1)[0];
  return version || 'unknown';
}

function assertOutputDirectory(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('output directory is required');
  }
  return resolve(value);
}

export async function createBackup({
  databaseUrl,
  schema,
  releaseId,
  outputDirectory,
  objectStorage,
  encryptionRecipientEnv = 'AGE_RECIPIENT',
  commandRunner = defaultCommandRunner,
  environment = process.env,
  fileRemover = unlink,
}) {
  const source = sourceTarget(databaseUrl);
  const safeSchema = requireSafeSchemaName(schema);
  const safeReleaseId = assertReleaseId(releaseId);
  const outputRoot = assertOutputDirectory(outputDirectory);
  assertNonProduction(outputRoot, 'output directory');
  const storage = assertObjectStorage(objectStorage);
  const recipientEnv = assertEnvironmentName(encryptionRecipientEnv);
  const recipient = environment[recipientEnv];
  if (typeof recipient !== 'string' || recipient.trim() === '') {
    throw new Error(
      `missing encryption recipient environment variable: ${recipientEnv}`,
    );
  }
  if (recipient.length > 512 || /\s/.test(recipient)) {
    throw new Error('encryption recipient is invalid');
  }
  await mkdir(outputRoot, { recursive: true });

  const dumpPath = join(outputRoot, `${safeReleaseId}.dump`);
  const encryptedPath = join(outputRoot, `${safeReleaseId}.dump.age`);
  const startedAt = new Date().toISOString();
  const run = commandRunner;
  const targetFingerprint = await fingerprintTarget({
    databaseUrl,
    schema: safeSchema,
    commandRunner: run,
  });
  if (
    targetFingerprint.database !== source.database ||
    targetFingerprint.schema !== safeSchema
  ) {
    throw new Error('backup target fingerprint mismatch');
  }
  const toolVersions = {
    pgDump: await toolVersion(run, 'pg_dump', ['--version']),
    age: await toolVersion(run, 'age', ['--version']),
    objectStorage: await toolVersion(run, 'aws', ['--version']),
  };
  const pgDumpEnvironment = filterPostgresEnvironment(process.env);
  Object.assign(pgDumpEnvironment, source.environment);
  if (source.password !== undefined) {
    pgDumpEnvironment.PGPASSWORD = source.password;
  }
  try {
    await runCommand(
      run,
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema',
        safeSchema,
        '--file',
        dumpPath,
        '--host',
        source.host,
        ...(source.port ? ['--port', source.port] : []),
        ...(source.username ? ['--username', source.username] : []),
        '--dbname',
        source.database,
      ],
      'pg_dump',
      { env: pgDumpEnvironment },
    );
    await runCommand(
      run,
      'age',
      [
        '--encrypt',
        '--recipient',
        recipient,
        '--output',
        encryptedPath,
        dumpPath,
      ],
      'age encryption',
    );
  } catch (error) {
    await cleanupPlaintext(fileRemover, dumpPath);
    throw error;
  }
  let encryptedStats;
  let encryptedSha256;
  try {
    encryptedStats = await stat(encryptedPath);
    encryptedSha256 = await sha256File(encryptedPath);
  } catch (error) {
    await cleanupPlaintext(fileRemover, dumpPath);
    throw error;
  }
  await cleanupPlaintext(fileRemover, dumpPath);

  const objectKey = `${storage.destination}/${safeReleaseId}.dump.age`;
  await runCommand(
    run,
    'aws',
    [
      's3',
      'cp',
      encryptedPath,
      `s3://${storage.bucket}/${objectKey}`,
      '--endpoint-url',
      storage.endpointForCommand,
      '--no-progress',
      '--acl',
      'private',
    ],
    'private object copy',
  );
  const completedAt = new Date().toISOString();
  const manifest = {
    result: 'PASS',
    kind: 'staging-backup',
    releaseId: safeReleaseId,
    target: { database: source.database, schema: safeSchema },
    targetFingerprint,
    timestamps: { startedAt, completedAt },
    artifact: {
      encryptedFile: `${safeReleaseId}.dump.age`,
      format: 'age-wrapped-postgresql-custom',
      bytes: encryptedStats.size,
      sha256: encryptedSha256,
    },
    postgres: {
      format: 'custom',
      options: ['no-owner', 'no-privileges'],
    },
    objects: {
      count: 1,
      bytes: encryptedStats.size,
      sha256: encryptedSha256,
    },
    encryption: { algorithm: 'age', recipientEnv },
    storage: {
      provider: 's3-compatible-private',
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      key: objectKey,
    },
    toolVersions,
    retention: { owner: 'staging-operations', days: 35 },
  };
  const manifestPath = join(outputRoot, 'backup-manifest.json');
  await writeEvidence(manifestPath, manifest);
  return manifest;
}

const CLI_SCHEMA = {
  'database-url-env': { type: 'string', required: true },
  schema: { type: 'string', required: true },
  'release-id': { type: 'string', required: true },
  output: { type: 'string', required: true },
  'object-endpoint': { type: 'string', required: true },
  'object-bucket': { type: 'string', required: true },
  'object-destination': { type: 'string', required: true },
  'encryption-recipient-env': {
    type: 'string',
    required: false,
    default: 'AGE_RECIPIENT',
  },
};

export async function main(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  const options = parseArgs(argv, CLI_SCHEMA);
  if (!ENV_NAME_PATTERN.test(options['database-url-env'])) {
    throw new Error('invalid database URL environment variable name');
  }
  const databaseUrl = environment[options['database-url-env']];
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new Error(
      `missing database URL environment variable: ${options['database-url-env']}`,
    );
  }
  return createBackup({
    databaseUrl,
    schema: options.schema,
    releaseId: options['release-id'],
    outputDirectory: options.output,
    objectStorage: {
      endpoint: options['object-endpoint'],
      bucket: options['object-bucket'],
      destination: options['object-destination'],
    },
    encryptionRecipientEnv: options['encryption-recipient-env'],
    environment,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((manifest) =>
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`),
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
