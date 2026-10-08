import { chmod, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  assertNoSecrets,
  filterPostgresEnvironment,
  parseDatabaseConnection,
  requireSafeSchemaName,
  safeDiagnostic,
  sha256File,
  writeEvidence,
} from '../staging/staging-lib.mjs';

export const OPERATOR_TARGETS = Object.freeze({
  rpoHours: 24,
  rtoHours: 4,
  retentionDays: 35,
  schedule: '30 17 * * *',
  timezone: 'Asia/Ho_Chi_Minh',
  rollbackDecisionWindowHours: 4,
  measured: false,
  rehearsed: false,
});

export const RESTORE_SAFETY_FLAGS = Object.freeze({
  allowSource: 'IMEAL_BACKUP_RESTORE_ALLOW_SOURCE',
  allowProduction: 'IMEAL_BACKUP_RESTORE_ALLOW_PRODUCTION',
  operator: 'IMEAL_BACKUP_RESTORE_OPERATOR',
  approvalId: 'IMEAL_BACKUP_RESTORE_APPROVAL_ID',
});

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPERATOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;
const APPROVAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{2,62}$/;
const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const PRODUCTION_DB_PATTERN = /(?:^|[-_.])(?:prod(?:uction)?|primary|live)(?:$|[-_.])/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'minio', 'imeal_minio']);
const VOLUME_PATTERN = /minio_data|\/var\/lib\/docker\/volumes|docker\/volumes/i;

export function logEvent(stream, event, fields = {}) {
  const payload = { time: new Date().toISOString(), event, ...fields };
  assertNoSecrets(payload);
  stream.write(`${JSON.stringify(payload)}\n`);
}

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function productionMode(environment) {
  return environment.NODE_ENV === 'production' || environment.IMEAL_BACKUP_ENV === 'production';
}

export function assertOffsiteDestination({ endpoint, bucket, prefix }, environment) {
  if (!endpoint || !bucket || !prefix || String(endpoint).trim() === '' || String(bucket).trim() === '' || String(prefix).trim() === '') {
    throw new Error('backup destination is empty');
  }
  if (/^file:/i.test(endpoint) || endpoint.startsWith('/') || /^[A-Za-z]:[\\/]/.test(endpoint)) {
    throw new Error('local file destination is not an offsite backup target');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('backup destination endpoint is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('backup destination must be an S3-compatible HTTP(S) endpoint');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('backup destination endpoint must not contain credentials');
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  const local = LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.startsWith('minio.');
  const volume = VOLUME_PATTERN.test(`${endpoint} ${bucket} ${prefix}`);
  if (local || volume) {
    throw new Error('backup destination must not be local disk or the in-stack MinIO volume');
  }
  if (productionMode(environment) && parsed.protocol !== 'https:') {
    throw new Error('production backup destination must use HTTPS');
  }
  if (!BUCKET_PATTERN.test(bucket) || /public/i.test(bucket)) {
    throw new Error('backup bucket is invalid');
  }
  if (!PREFIX_PATTERN.test(prefix) || prefix.includes('..') || prefix.includes('//') || /public/i.test(prefix)) {
    throw new Error('backup destination prefix is invalid');
  }
  return {
    endpoint: parsed.origin,
    endpointForCommand: endpoint,
    bucket,
    prefix: prefix.replace(/\/+$/, ''),
  };
}

function assertCredentials(environment) {
  if (environment.IMEAL_BACKUP_S3_AUTH === 'ambient') return { mode: 'ambient' };
  const key = environment.AWS_ACCESS_KEY_ID;
  const secret = environment.AWS_SECRET_ACCESS_KEY;
  if (typeof key !== 'string' || key.trim() === '' || typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('missing S3 credentials');
  }
  return { mode: 'env' };
}

function retentionDays(environment) {
  const raw = environment.IMEAL_BACKUP_RETENTION_DAYS ?? String(OPERATOR_TARGETS.retentionDays);
  if (!/^[1-9][0-9]{0,3}$/.test(String(raw))) {
    throw new Error('backup retention days are invalid');
  }
  const days = Number(raw);
  if (days < 1 || days > 3650) throw new Error('backup retention days are invalid');
  return days;
}

export function loadBackupConfig(environment = process.env) {
  const databaseUrl = required(environment.IMEAL_BACKUP_DATABASE_URL, 'IMEAL_BACKUP_DATABASE_URL');
  const source = parseDatabaseConnection(databaseUrl);
  if (!DATABASE_PATTERN.test(source.database)) throw new Error('database name is invalid');
  const schema = requireSafeSchemaName(environment.IMEAL_BACKUP_SCHEMA);
  const releaseId = required(environment.IMEAL_BACKUP_RELEASE_ID, 'IMEAL_BACKUP_RELEASE_ID');
  if (!RELEASE_ID_PATTERN.test(releaseId)) throw new Error('backup release id is invalid');
  const backupEnv = required(environment.IMEAL_BACKUP_ENV, 'IMEAL_BACKUP_ENV');
  if (!['production', 'staging', 'rehearsal'].includes(backupEnv)) {
    throw new Error('IMEAL_BACKUP_ENV is invalid');
  }
  const recipient = required(environment.AGE_RECIPIENT, 'AGE_RECIPIENT');
  if (recipient.length > 512 || /\s/.test(recipient)) throw new Error('encryption recipient is invalid');
  const storage = assertOffsiteDestination(
    {
      endpoint: environment.IMEAL_BACKUP_S3_ENDPOINT,
      bucket: environment.IMEAL_BACKUP_S3_BUCKET,
      prefix: environment.IMEAL_BACKUP_S3_PREFIX,
    },
    environment,
  );
  assertCredentials(environment);
  return {
    databaseUrl,
    source,
    schema,
    releaseId,
    backupEnv,
    recipient,
    storage,
    retentionDays: retentionDays(environment),
    production: productionMode(environment),
  };
}

function sourceEnvironment(source) {
  const env = filterPostgresEnvironment(process.env);
  Object.assign(env, source.environment);
  if (source.password !== undefined) env.PGPASSWORD = source.password;
  return env;
}

async function runCommand(commandRunner, command, args, label, commandOptions = {}, databaseUrl) {
  let result;
  try {
    result = await commandRunner(command, args, { ...commandOptions, shell: false });
  } catch (error) {
    throw new Error(`${label} could not start: ${safeDiagnostic(error, databaseUrl)}`);
  }
  if (!result || result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${result?.exitCode ?? 'unknown'}: ${safeDiagnostic(result?.stderr || 'no diagnostics', databaseUrl)}`,
    );
  }
  return result;
}

async function psql(commandRunner, source, sql, databaseUrl) {
  return runCommand(
    commandRunner,
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      '--host',
      source.host,
      ...(source.port ? ['--port', source.port] : []),
      ...(source.username ? ['--username', source.username] : []),
      '--dbname',
      source.database,
      '--command',
      sql,
    ],
    'database connectivity',
    { env: sourceEnvironment(source) },
    databaseUrl,
  );
}

function objectives(retention) {
  return {
    ...OPERATOR_TARGETS,
    retentionDays: retention,
    measured: false,
    rehearsed: false,
  };
}

async function applyRetention(commandRunner, config) {
  const listed = await runCommand(
    commandRunner,
    'aws',
    [
      's3api',
      'list-objects-v2',
      '--bucket',
      config.storage.bucket,
      '--prefix',
      `${config.storage.prefix}/`,
      '--endpoint-url',
      config.storage.endpointForCommand,
    ],
    'retention list',
    {},
    config.databaseUrl,
  );
  const payload = JSON.parse(listed.stdout || '{"Contents":[]}');
  const contents = Array.isArray(payload.Contents) ? payload.Contents : [];
  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  const currentKey = `${config.storage.prefix}/${config.releaseId}.dump.age`;
  for (const item of contents) {
    if (typeof item.Key !== 'string' || !item.Key.endsWith('.dump.age') || item.Key === currentKey) continue;
    if (!item.Key.startsWith(`${config.storage.prefix}/`)) continue;
    const modified = Date.parse(item.LastModified);
    if (!Number.isFinite(modified) || modified >= cutoff) continue;
    await runCommand(
      commandRunner,
      'aws',
      [
        's3api',
        'delete-object',
        '--bucket',
        config.storage.bucket,
        '--key',
        item.Key,
        '--endpoint-url',
        config.storage.endpointForCommand,
      ],
      'retention delete',
      {},
      config.databaseUrl,
    );
  }
}

export async function createBackup({
  environment = process.env,
  outputDirectory,
  commandRunner,
  logger = (event, fields) => logEvent(process.stderr, event, fields),
  fileRemover = unlink,
}) {
  const config = loadBackupConfig(environment);
  const outputRoot = resolve(required(outputDirectory, 'output directory'));
  await mkdir(outputRoot, { recursive: true });
  logger('backup.start', { releaseId: config.releaseId, environment: config.backupEnv });
  const dumpPath = join(outputRoot, `${config.releaseId}.dump`);
  const encryptedPath = join(outputRoot, `${config.releaseId}.dump.age`);
  const startedAt = new Date().toISOString();
  const connected = await psql(
    commandRunner,
    config.source,
    'SELECT current_database();',
    config.databaseUrl,
  );
  if (connected.stdout.trim() !== config.source.database) {
    throw new Error('backup target database mismatch');
  }
  try {
    await runCommand(
      commandRunner,
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema',
        config.schema,
        '--file',
        dumpPath,
        '--host',
        config.source.host,
        ...(config.source.port ? ['--port', config.source.port] : []),
        ...(config.source.username ? ['--username', config.source.username] : []),
        '--dbname',
        config.source.database,
      ],
      'pg_dump',
      { env: sourceEnvironment(config.source) },
      config.databaseUrl,
    );
    await runCommand(
      commandRunner,
      'age',
      ['--encrypt', '--recipient', config.recipient, '--output', encryptedPath, dumpPath],
      'age encryption',
      {},
      config.databaseUrl,
    );
  } catch (error) {
    await fileRemover(dumpPath).catch(() => {});
    throw error;
  }
  let encryptedSha256;
  let bytes;
  try {
    bytes = (await stat(encryptedPath)).size;
    encryptedSha256 = await sha256File(encryptedPath);
  } catch (error) {
    await fileRemover(dumpPath).catch(() => {});
    throw error;
  }
  await fileRemover(dumpPath);
  const objectKey = `${config.storage.prefix}/${config.releaseId}.dump.age`;
  await runCommand(
    commandRunner,
    'aws',
    [
      's3',
      'cp',
      encryptedPath,
      `s3://${config.storage.bucket}/${objectKey}`,
      '--endpoint-url',
      config.storage.endpointForCommand,
      '--no-progress',
      '--acl',
      'private',
    ],
    'private object copy',
    {},
    config.databaseUrl,
  );
  await applyRetention(commandRunner, config);
  const manifest = {
    result: 'PASS',
    kind: 'production-backup',
    releaseId: config.releaseId,
    environment: config.backupEnv,
    target: { database: config.source.database, schema: config.schema },
    timestamps: { startedAt, completedAt: new Date().toISOString() },
    artifact: {
      encryptedFile: `${config.releaseId}.dump.age`,
      format: 'age-wrapped-postgresql-custom',
      bytes,
      sha256: encryptedSha256,
    },
    encryption: { algorithm: 'age', recipientEnv: 'AGE_RECIPIENT' },
    storage: {
      provider: 's3-compatible-private',
      endpoint: config.storage.endpoint,
      bucket: config.storage.bucket,
      key: objectKey,
    },
    retention: { days: config.retentionDays },
    objectives: objectives(config.retentionDays),
    metricsBinding: {
      collectorObservation: false,
      evidenceFile: 'backup-manifest.json',
      workerSourceEnv: 'WORKER_METRICS_BACKUP_EVIDENCE_SOURCE',
    },
  };
  await writeEvidence(join(outputRoot, 'backup-manifest.json'), manifest);
  logger('backup.complete', { releaseId: config.releaseId, sha256: encryptedSha256 });
  return manifest;
}

export async function verifyBackup({
  manifestPath,
  commandRunner,
  outputDirectory,
  logger = (event, fields) => logEvent(process.stderr, event, fields),
}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest?.result !== 'PASS' || manifest?.artifact?.sha256?.length !== 64) {
    throw new Error('backup manifest is not a verified PASS record');
  }
  const localPath = join(resolve(manifestPath, '..'), manifest.artifact.encryptedFile);
  let actual;
  try {
    actual = await sha256File(localPath);
  } catch {
    const downloadPath = join(tmpdir(), `imeal-backup-verify-${randomBytes(6).toString('hex')}.age`);
    await runCommand(
      commandRunner,
      'aws',
      [
        's3',
        'cp',
        `s3://${manifest.storage.bucket}/${manifest.storage.key}`,
        downloadPath,
        '--endpoint-url',
        manifest.storage.endpoint,
        '--no-progress',
      ],
      'backup download',
    );
    actual = await sha256File(downloadPath);
    await unlink(downloadPath).catch(() => {});
  }
  const resultPath = outputDirectory ? join(outputDirectory, 'verify-result.json') : undefined;
  if (resultPath) {
    await chmod(resultPath, 0o600).catch(() => {});
    await unlink(resultPath).catch(() => {});
  }
  if (actual !== manifest.artifact.sha256) {
    const failure = {
      result: 'FAIL',
      kind: 'production-backup-verify',
      reason: 'checksum mismatch',
      releaseId: manifest.releaseId,
    };
    if (resultPath) await writeEvidence(resultPath, failure);
    logger('backup.verify.fail', { releaseId: manifest.releaseId });
    throw new Error('backup checksum verification failed');
  }
  const report = {
    result: 'PASS',
    kind: 'production-backup-verify',
    releaseId: manifest.releaseId,
    sha256: actual,
    objectives: objectives(manifest.retention?.days ?? OPERATOR_TARGETS.retentionDays),
  };
  if (resultPath) await writeEvidence(resultPath, report);
  logger('backup.verify.pass', { releaseId: manifest.releaseId });
  return report;
}

function assertRestoreSafety({ sourceDatabase, restoreDatabase, restoreSchema, environment, rehearsal }) {
  const operator = environment[RESTORE_SAFETY_FLAGS.operator];
  const approvalId = environment[RESTORE_SAFETY_FLAGS.approvalId];
  if (!OPERATOR_PATTERN.test(operator ?? '') || !APPROVAL_PATTERN.test(approvalId ?? '')) {
    throw new Error('destructive restore requires IMEAL_BACKUP_RESTORE_OPERATOR and IMEAL_BACKUP_RESTORE_APPROVAL_ID');
  }
  if (!DATABASE_PATTERN.test(restoreDatabase)) throw new Error('restore database name is invalid');
  const schema = requireSafeSchemaName(restoreSchema);
  const sameSource = restoreDatabase === sourceDatabase;
  const productionTarget = PRODUCTION_DB_PATTERN.test(restoreDatabase) || (productionMode(environment) && sameSource);
  if (rehearsal && (sameSource || productionTarget || productionMode(environment))) {
    throw new Error('rehearsal refuses the source or production database');
  }
  if (sameSource && environment[RESTORE_SAFETY_FLAGS.allowSource] !== '1') {
    throw new Error('refusing restore onto the source database without IMEAL_BACKUP_RESTORE_ALLOW_SOURCE=1');
  }
  if (productionTarget && environment[RESTORE_SAFETY_FLAGS.allowProduction] !== '1') {
    throw new Error('refusing restore onto the production database without IMEAL_BACKUP_RESTORE_ALLOW_PRODUCTION=1');
  }
  return { operator, approvalId, schema, sameSource, productionTarget };
}

async function migrationStatus(commandRunner, source, databaseUrl) {
  const connected = await psql(commandRunner, source, 'SELECT 1;', databaseUrl);
  if (connected.stdout.trim() !== '1') throw new Error('restore connectivity check failed');
  const status = await psql(
    commandRunner,
    source,
    'SELECT count(*)::integer FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;',
    databaseUrl,
  );
  const failed = Number(status.stdout.trim());
  if (!Number.isInteger(failed)) throw new Error('migration status is invalid');
  return { connectivity: 'ok', unfinishedOrRolledBack: failed, status: failed === 0 ? 'clean' : 'failed' };
}

export async function restoreBackup({
  manifestPath,
  environment = process.env,
  outputDirectory,
  commandRunner,
  rehearsal = false,
  logger = (event, fields) => logEvent(process.stderr, event, fields),
}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const databaseUrl = required(environment.IMEAL_BACKUP_DATABASE_URL, 'IMEAL_BACKUP_DATABASE_URL');
  const source = parseDatabaseConnection(databaseUrl);
  const restoreDatabase = required(environment.IMEAL_BACKUP_RESTORE_DATABASE, 'IMEAL_BACKUP_RESTORE_DATABASE');
  const safety = assertRestoreSafety({
    sourceDatabase: source.database,
    restoreDatabase,
    restoreSchema: environment.IMEAL_BACKUP_RESTORE_SCHEMA || environment.IMEAL_BACKUP_SCHEMA,
    environment,
    rehearsal,
  });
  const identity = required(environment.IMEAL_BACKUP_AGE_IDENTITY, 'IMEAL_BACKUP_AGE_IDENTITY');
  logger(rehearsal ? 'backup.rehearsal.start' : 'backup.restore.start', {
    releaseId: manifest.releaseId,
    database: restoreDatabase,
  });
  const outputRoot = resolve(required(outputDirectory, 'output directory'));
  await mkdir(outputRoot, { recursive: true });
  const encryptedPath = join(outputRoot, manifest.artifact.encryptedFile);
  const dumpPath = join(outputRoot, `${manifest.releaseId}.restore.dump`);
  const identityPath = join(outputRoot, `.age-identity-${randomBytes(4).toString('hex')}`);
  await writeFile(identityPath, identity, { mode: 0o600 });
  try {
    if ((await sha256File(encryptedPath).catch(() => '')) !== manifest.artifact.sha256) {
      await runCommand(
        commandRunner,
        'aws',
        ['s3', 'cp', `s3://${manifest.storage.bucket}/${manifest.storage.key}`, encryptedPath, '--endpoint-url', manifest.storage.endpoint, '--no-progress'],
        'backup download',
      );
    }
    if ((await sha256File(encryptedPath)) !== manifest.artifact.sha256) {
      throw new Error('backup checksum verification failed');
    }
    await runCommand(
      commandRunner,
      'age',
      ['--decrypt', '--identity', identityPath, '--output', dumpPath, encryptedPath],
      'age decryption',
    );
    const restoreSource = { ...source, database: restoreDatabase };
    await runCommand(
      commandRunner,
      'pg_restore',
      [
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--dbname',
        restoreDatabase,
        '--host',
        source.host,
        ...(source.port ? ['--port', source.port] : []),
        ...(source.username ? ['--username', source.username] : []),
        dumpPath,
      ],
      'pg_restore',
      { env: sourceEnvironment(restoreSource) },
      databaseUrl,
    );
    const migration = await migrationStatus(commandRunner, restoreSource, databaseUrl);
    const report = {
      result: migration.status === 'clean' ? 'PASS' : 'FAIL',
      kind: rehearsal ? 'production-backup-rehearsal' : 'production-restore',
      releaseId: manifest.releaseId,
      target: { database: restoreDatabase, schema: safety.schema },
      sourceDatabase: source.database,
      operator: safety.operator,
      approvalId: safety.approvalId,
      migration,
      isolated: !safety.sameSource,
      objectives: objectives(manifest.retention?.days ?? OPERATOR_TARGETS.retentionDays),
      metricsBinding: {
        collectorObservation: false,
        evidenceFile: rehearsal ? 'restore-rehearsal.json' : 'restore-evidence.json',
        workerSourceEnv: 'WORKER_METRICS_BACKUP_EVIDENCE_SOURCE',
      },
    };
    await writeEvidence(join(outputRoot, rehearsal ? 'restore-rehearsal.json' : 'restore-evidence.json'), report);
    if (report.result !== 'PASS') throw new Error('restore migration status is not clean');
    return report;
  } finally {
    await unlink(identityPath).catch(() => {});
    await unlink(dumpPath).catch(() => {});
  }
}

export async function rehearseBackup(options) {
  if (productionMode(options.environment ?? process.env)) {
    throw new Error('rehearsal refuses production environment');
  }
  return restoreBackup({
    ...options,
    rehearsal: true,
    environment: {
      ...options.environment,
      [RESTORE_SAFETY_FLAGS.allowSource]: '',
      [RESTORE_SAFETY_FLAGS.allowProduction]: '',
    },
  });
}
