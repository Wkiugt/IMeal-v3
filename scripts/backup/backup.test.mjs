import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { sha256File } from '../staging/staging-lib.mjs';
import {
  assertOffsiteDestination,
  createBackup,
  loadBackupConfig,
  rehearseBackup,
  restoreBackup,
  verifyBackup,
} from './lib.mjs';
import { runCli } from './cli.mjs';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
const password = 'super-secret-backup';
const databaseUrl = `postgresql://backup_user:${password}@backup.example/imeal_staging`;
const identity = 'AGE-SECRET-KEY-1TESTONLY';

function environment(overrides = {}) {
  return {
    NODE_ENV: 'production',
    IMEAL_BACKUP_ENV: 'production',
    IMEAL_BACKUP_DATABASE_URL: databaseUrl,
    IMEAL_BACKUP_SCHEMA: 'public',
    IMEAL_BACKUP_RELEASE_ID: 'imeal-backup-001',
    AGE_RECIPIENT: 'age1testrecipient',
    IMEAL_BACKUP_S3_ENDPOINT: 'https://backup.example',
    IMEAL_BACKUP_S3_BUCKET: 'imeal-offsite',
    IMEAL_BACKUP_S3_PREFIX: 'daily',
    IMEAL_BACKUP_RETENTION_DAYS: '35',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-value',
    AWS_DEFAULT_REGION: 'ap-southeast-1',
    ...overrides,
  };
}

function runner(commands, { failCommand } = {}) {
  return async (command, args) => {
    commands.push({ command, args: [...args] });
    if (failCommand === command) return { stdout: '', stderr: `${command} failed`, exitCode: 42 };
    if (command === 'psql') {
      const sql = args[args.indexOf('--command') + 1] ?? '';
      if (sql.includes('_prisma_migrations')) return { stdout: '0\n', stderr: '', exitCode: 0 };
      if (sql.includes('SELECT 1')) return { stdout: '1\n', stderr: '', exitCode: 0 };
      return { stdout: 'imeal_staging\n', stderr: '', exitCode: 0 };
    }
    if (command === 'pg_dump') {
      await writeFile(args[args.indexOf('--file') + 1], 'custom dump bytes\n');
    }
    if (command === 'age' && args.includes('--encrypt')) {
      await writeFile(args[args.indexOf('--output') + 1], 'encrypted dump bytes\n');
    }
    if (command === 'age' && args.includes('--decrypt')) {
      await writeFile(args[args.indexOf('--output') + 1], 'restored dump bytes\n');
    }
    if (command === 'aws' && args[0] === 's3api' && args[1] === 'list-objects-v2') {
      return { stdout: '{"Contents":[]}\n', stderr: '', exitCode: 0 };
    }
    return { stdout: `${command} ok\n`, stderr: '', exitCode: 0 };
  };
}

test('config validation rejects missing credentials and invalid retention', () => {
  assert.throws(() => loadBackupConfig(environment({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' })), /missing S3 credentials/);
  assert.throws(() => loadBackupConfig(environment({ IMEAL_BACKUP_RETENTION_DAYS: '0' })), /retention/);
  assert.throws(() => loadBackupConfig(environment({ AGE_RECIPIENT: '' })), /AGE_RECIPIENT/);
});

test('production destination rejects empty, local, and in-stack MinIO targets', () => {
  const env = environment();
  for (const destination of [
    { endpoint: '', bucket: 'imeal-offsite', prefix: 'daily' },
    { endpoint: 'file:///var/lib/docker/volumes/minio_data/_data', bucket: 'imeal-offsite', prefix: 'daily' },
    { endpoint: 'http://minio:9000', bucket: 'imeal-offsite', prefix: 'daily' },
    { endpoint: 'http://127.0.0.1:9000', bucket: 'imeal-offsite', prefix: 'daily' },
    { endpoint: 'https://backup.example', bucket: 'imeal-offsite', prefix: 'minio_data/daily' },
    { endpoint: 'http://backup.example', bucket: 'imeal-offsite', prefix: 'daily' },
  ]) {
    assert.throws(() => assertOffsiteDestination(destination, env), /destination|empty|HTTPS|MinIO|local/i);
  }
});

test('backup requires encryption before offsite write and fails closed on encryption failure', async () => {
  const commands = [];
  await assert.rejects(
    createBackup({
      environment: environment({ AGE_RECIPIENT: '' }),
      outputDirectory: await mkdtemp(join(tmpdir(), 'imeal-backup-')),
      commandRunner: runner(commands),
    }),
    /AGE_RECIPIENT/,
  );
  assert.equal(commands.length, 0);

  const failed = [];
  await assert.rejects(
    createBackup({
      environment: environment(),
      outputDirectory: await mkdtemp(join(tmpdir(), 'imeal-backup-')),
      commandRunner: runner(failed, { failCommand: 'age' }),
    }),
    /age encryption/i,
  );
  assert.equal(failed.some((call) => call.command === 'aws' && call.args[0] === 's3'), false);
});

test('backup writes redacted evidence and verify fails on checksum mismatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-backup-'));
  const commands = [];
  const logs = [];
  const manifest = await createBackup({
    environment: environment(),
    outputDirectory: directory,
    commandRunner: runner(commands),
    logger: (event, fields) => logs.push({ event, fields }),
  });
  const text = await readFile(join(directory, 'backup-manifest.json'), 'utf8');
  assert.equal(manifest.result, 'PASS');
  assert.equal(manifest.encryption.algorithm, 'age');
  assert.equal(manifest.metricsBinding.collectorObservation, false);
  assert.equal(text.includes(password), false);
  assert.equal(text.includes(databaseUrl), false);
  assert.equal(JSON.stringify(logs).includes(password), false);
  await verifyBackup({
    manifestPath: join(directory, 'backup-manifest.json'),
    outputDirectory: directory,
    commandRunner: runner([]),
  });
  manifest.artifact.sha256 = 'b'.repeat(64);
  await chmod(join(directory, 'backup-manifest.json'), 0o600);
  await writeFile(join(directory, 'backup-manifest.json'), `${JSON.stringify(manifest)}\n`);
  const code = await runCli(
    ['verify', '--manifest', join(directory, 'backup-manifest.json'), '--output', directory],
    environment(),
    { commandRunner: runner([]), logger: () => {} },
  );
  assert.equal(code, 1);
  const failure = JSON.parse(await readFile(join(directory, 'verify-result.json'), 'utf8'));
  assert.equal(failure.result, 'FAIL');
  assert.equal(failure.reason, 'checksum mismatch');
});

test('restore refuses source and production targets unless named safety flags are set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-restore-'));
  const encrypted = join(directory, 'imeal-backup-001.dump.age');
  await writeFile(encrypted, 'encrypted dump bytes\n');
  const manifest = {
    result: 'PASS',
    releaseId: 'imeal-backup-001',
    artifact: { encryptedFile: 'imeal-backup-001.dump.age', sha256: await sha256File(encrypted) },
    storage: { bucket: 'imeal-offsite', key: 'daily/imeal-backup-001.dump.age', endpoint: 'https://backup.example' },
    retention: { days: 35 },
  };
  await writeFile(join(directory, 'backup-manifest.json'), `${JSON.stringify(manifest)}\n`);
  const base = {
    manifestPath: join(directory, 'backup-manifest.json'),
    outputDirectory: directory,
    commandRunner: runner([]),
  };
  await assert.rejects(
    restoreBackup({ ...base, environment: environment({ IMEAL_BACKUP_RESTORE_DATABASE: 'imeal_restore' }) }),
    /OPERATOR/,
  );
  await assert.rejects(
    restoreBackup({
      ...base,
      environment: environment({
        IMEAL_BACKUP_RESTORE_DATABASE: 'imeal_staging',
        IMEAL_BACKUP_RESTORE_OPERATOR: 'operator.one',
        IMEAL_BACKUP_RESTORE_APPROVAL_ID: 'approval-1',
      }),
    }),
    /ALLOW_SOURCE/,
  );
  await assert.rejects(
    restoreBackup({
      ...base,
      environment: environment({
        IMEAL_BACKUP_RESTORE_DATABASE: 'imeal_production',
        IMEAL_BACKUP_RESTORE_OPERATOR: 'operator.one',
        IMEAL_BACKUP_RESTORE_APPROVAL_ID: 'approval-1',
        IMEAL_BACKUP_RESTORE_ALLOW_SOURCE: '1',
      }),
    }),
    /ALLOW_PRODUCTION/,
  );
  await assert.rejects(
    rehearseBackup({
      ...base,
      environment: environment({
        NODE_ENV: 'test',
        IMEAL_BACKUP_ENV: 'staging',
        IMEAL_BACKUP_RESTORE_DATABASE: 'imeal_staging',
        IMEAL_BACKUP_RESTORE_OPERATOR: 'operator.one',
        IMEAL_BACKUP_RESTORE_APPROVAL_ID: 'approval-1',
        IMEAL_BACKUP_RESTORE_ALLOW_SOURCE: '1',
        IMEAL_BACKUP_RESTORE_ALLOW_PRODUCTION: '1',
      }),
    }),
    /rehearsal refuses/,
  );
});

test('isolated restore writes redacted evidence and does not record the age identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-restore-ok-'));
  const encrypted = join(directory, 'imeal-backup-001.dump.age');
  await writeFile(encrypted, 'encrypted dump bytes\n');
  await writeFile(
    join(directory, 'backup-manifest.json'),
    `${JSON.stringify({
      result: 'PASS',
      releaseId: 'imeal-backup-001',
      artifact: { encryptedFile: 'imeal-backup-001.dump.age', sha256: await sha256File(encrypted) },
      storage: { bucket: 'imeal-offsite', key: 'daily/imeal-backup-001.dump.age', endpoint: 'https://backup.example' },
      retention: { days: 35 },
    })}\n`,
  );
  const report = await restoreBackup({
    manifestPath: join(directory, 'backup-manifest.json'),
    outputDirectory: directory,
    commandRunner: runner([]),
    environment: environment({
      NODE_ENV: 'test',
      IMEAL_BACKUP_ENV: 'staging',
      IMEAL_BACKUP_RESTORE_DATABASE: 'imeal_restore',
      IMEAL_BACKUP_RESTORE_SCHEMA: 'public',
      IMEAL_BACKUP_RESTORE_OPERATOR: 'operator.one',
      IMEAL_BACKUP_RESTORE_APPROVAL_ID: 'approval-1',
      IMEAL_BACKUP_AGE_IDENTITY: identity,
    }),
  });
  const text = await readFile(join(directory, 'restore-evidence.json'), 'utf8');
  assert.equal(report.result, 'PASS');
  assert.equal(report.migration.connectivity, 'ok');
  assert.equal(text.includes(identity), false);
  assert.equal(text.includes(password), false);
});

test('backup overlay publishes no ports and is not started by the base compose files', () => {
  const overlay = parse(readFileSync(new URL('../../docker-compose.backup.yml', import.meta.url), 'utf8'));
  assert.equal(overlay.services.backup.ports, undefined);
  assert.deepEqual(overlay.services.backup.profiles, ['backup']);
  assert.equal(JSON.stringify(overlay).includes('latest'), false);
  assert.equal(JSON.stringify(overlay).includes('super-secret'), false);
  for (const file of ['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.staging.yml']) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.equal(text.includes('docker-compose.backup.yml'), false);
  }
});
