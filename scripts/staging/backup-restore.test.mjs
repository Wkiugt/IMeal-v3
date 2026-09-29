import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createBackup } from './backup-staging.mjs';
import { restoreRehearsal } from './restore-rehearsal.mjs';
import { sha256File } from './staging-lib.mjs';

const databaseUrl =
  'postgresql://backup_user:super-secret@staging-db.example/imeal_staging';
const schema = 'phase0_staging_20260928';
const releaseId = 'imeal-20260928-001';

async function makeDirectory() {
  return mkdtemp(join(tmpdir(), 'staging-backup-'));
}

function commandResult(overrides = {}) {
  return { stdout: '', stderr: '', exitCode: 0, ...overrides };
}

function createCommandRunner(commands, { failCommand } = {}) {
  return async (command, args, options) => {
    commands.push({ command, args, options });
    if (failCommand === command) {
      return commandResult({ stderr: `${command} failed`, exitCode: 42 });
    }
    if (command === 'pg_dump' && args[0] === '--version') {
      return commandResult({ stdout: 'pg_dump (PostgreSQL) 16.4\n' });
    }
    if (command === 'age' && args[0] === '--version') {
      return commandResult({ stdout: 'age 1.2.0\n' });
    }
    if (command === 'aws' && args[0] === '--version') {
      return commandResult({ stdout: 'aws-cli/2.17.0\n' });
    }
    const outputPath = args[args.indexOf('--output') + 1];
    if (command === 'pg_dump') {
      await writeFile(args[args.indexOf('--file') + 1], 'custom dump bytes\n');
      return commandResult({ stdout: 'pg_dump (PostgreSQL) 16.4\n' });
    }
    if (command === 'age') {
      await writeFile(outputPath, 'encrypted dump bytes\n');
      return commandResult({ stdout: 'age 1.2.0\n' });
    }
    return commandResult({ stdout: `${command} 1.0\n` });
  };
}

function assertNoSensitiveText(value) {
  assert.doesNotMatch(value, /postgres(?:ql)?:\/\/[^\s"']+@/i);
  assert.doesNotMatch(value, /super-secret|otp|123456|alice@example\.com/i);
}

test('creates an encrypted private backup before object copy with safe commands and manifest', async () => {
  const directory = await makeDirectory();
  const commands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  try {
    const manifest = await createBackup({
      databaseUrl,
      schema,
      releaseId,
      outputDirectory: directory,
      objectStorage: {
        endpoint: 'https://minio.staging.example',
        bucket: 'imeal-staging-private',
        destination: 'backups/imeal-20260928-001',
      },
      encryptionRecipientEnv: 'AGE_RECIPIENT',
      commandRunner: createCommandRunner(commands),
    });
    assert.equal(manifest.result, 'PASS');
    assert.equal(manifest.target.database, 'imeal_staging');
    assert.equal(manifest.target.schema, schema);
    assert.equal(manifest.encryption.algorithm, 'age');
    assert.equal(manifest.objects.count, 1);
    assert.equal(manifest.storage.bucket, 'imeal-staging-private');
    assert.equal(
      commands.filter(
        ({ command, args }) =>
          command === 'pg_dump' && args.includes('--format=custom'),
      ).length,
      1,
    );
    const pgDump = commands.find(
      ({ command, args }) =>
        command === 'pg_dump' && args.includes('--format=custom'),
    );
    assert.deepEqual(
      pgDump.args.filter((arg) =>
        ['--format=custom', '--no-owner', '--no-privileges'].includes(arg),
      ),
      ['--format=custom', '--no-owner', '--no-privileges'],
    );
    assert.equal(pgDump.options.shell, false);
    const encryptionIndex = commands.findIndex(
      ({ command }) => command === 'age',
    );
    const copyIndex = commands.findIndex(
      ({ command, args }) => command === 'aws' && argsContain(args, 's3'),
    );
    assert.ok(encryptionIndex >= 0);
    assert.ok(copyIndex > encryptionIndex);
    const copy = commands.find(
      ({ command, args }) => command === 'aws' && argsContain(args, 's3'),
    );
    assert.deepEqual(copy.args.slice(-3), [
      '--no-progress',
      '--acl',
      'private',
    ]);
    for (const invocation of commands)
      assert.equal(invocation.options.shell, false);

    const manifestPath = join(directory, 'backup-manifest.json');
    assert.deepEqual(
      JSON.parse(await readFile(manifestPath, 'utf8')),
      manifest,
    );
    assertNoSensitiveText(JSON.stringify(manifest));
    assert.equal(manifest.postgres?.databaseUrl, undefined);
    assert.equal(
      await sha256File(join(directory, manifest.artifact.encryptedFile)),
      manifest.artifact.sha256,
    );
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
});

function argsContain(args, value) {
  return Array.isArray(args) && args.includes(value);
}

test('rejects production sources and missing encryption recipient before spawning commands', async () => {
  const directory = await makeDirectory();
  const commands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  delete process.env.AGE_RECIPIENT;
  try {
    await assert.rejects(
      createBackup({
        databaseUrl:
          'postgresql://user:password@production-db.example/imeal_production',
        schema,
        releaseId,
        outputDirectory: directory,
        objectStorage: {
          endpoint: 'https://minio.staging.example',
          bucket: 'imeal-staging-private',
          destination: 'backups/rejected',
        },
        encryptionRecipientEnv: 'AGE_RECIPIENT',
        commandRunner: createCommandRunner(commands),
      }),
      /production|recipient/i,
    );
    assert.equal(commands.length, 0);
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
});

test('fails closed and removes the plaintext dump when encryption fails', async () => {
  const directory = await makeDirectory();
  const commands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  const runner = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === 'pg_dump' && args.includes('--version')) {
      return commandResult({ stdout: 'pg_dump (PostgreSQL) 16.4\n' });
    }
    if (command === 'age' && args.includes('--version')) {
      return commandResult({ stdout: 'age 1.2.0\n' });
    }
    if (command === 'aws' && args.includes('--version')) {
      return commandResult({ stdout: 'aws-cli/2.17.0\n' });
    }
    if (command === 'pg_dump') {
      await writeFile(args[args.indexOf('--file') + 1], 'plaintext dump\n');
      return commandResult();
    }
    if (command === 'age') {
      return commandResult({ stderr: 'encryption failed', exitCode: 9 });
    }
    return commandResult();
  };
  try {
    await assert.rejects(
      createBackup({
        databaseUrl,
        schema,
        releaseId,
        outputDirectory: directory,
        objectStorage: {
          endpoint: 'https://minio.staging.example',
          bucket: 'imeal-staging-private',
          destination: 'backups/imeal-20260928-001',
        },
        encryptionRecipientEnv: 'AGE_RECIPIENT',
        commandRunner: runner,
      }),
      /age encryption/i,
    );
    await assert.rejects(access(join(directory, `${releaseId}.dump`)));
    await assert.rejects(access(join(directory, 'backup-manifest.json')));
    assert.equal(
      commands.some(
        ({ command, args }) => command === 'aws' && args.includes('s3'),
      ),
      false,
    );
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
});

test('rejects a production object destination before spawning commands', async () => {
  const directory = await makeDirectory();
  const commands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  try {
    await assert.rejects(
      createBackup({
        databaseUrl,
        schema,
        releaseId,
        outputDirectory: directory,
        objectStorage: {
          endpoint: 'https://minio.staging.example',
          bucket: 'imeal-production-private',
          destination: 'backups/rejected',
        },
        encryptionRecipientEnv: 'AGE_RECIPIENT',
        commandRunner: createCommandRunner(commands),
      }),
      /production|private/i,
    );
    assert.equal(commands.length, 0);
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
});

test('restores into isolated fresh targets and records checksum, readiness, smoke, RPO and RTO', async () => {
  const directory = await makeDirectory();
  const backupCommands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  let manifest;
  try {
    manifest = await createBackup({
      databaseUrl,
      schema,
      releaseId,
      outputDirectory: directory,
      objectStorage: {
        endpoint: 'https://minio.staging.example',
        bucket: 'imeal-staging-private',
        destination: 'backups/imeal-20260928-001',
      },
      encryptionRecipientEnv: 'AGE_RECIPIENT',
      commandRunner: createCommandRunner(backupCommands),
    });
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }

  const restoreCommands = [];
  const report = await restoreRehearsal({
    backupManifestPath: join(directory, 'backup-manifest.json'),
    restoreDatabase: 'imeal_restore_20260928',
    restoreBucket: 'imeal-restore-20260928',
    outputPath: join(directory, 'restore-rehearsal.json'),
    commandRunner: createCommandRunner(restoreCommands),
    readinessCheck: async () => ({
      result: 'PASS',
      detail: 'alice@example.com',
    }),
    smokeCheck: async () => ({
      result: 'PASS',
      detail: 'otp=123456',
      objectCount: 1,
    }),
  });
  assert.equal(report.result, 'PASS');
  assert.equal(report.readiness.result, 'PASS');
  assert.equal(report.smoke.result, 'PASS');
  assert.ok(Number.isFinite(report.rpoSeconds));
  assert.ok(Number.isFinite(report.rtoSeconds));
  const decryptIndex = restoreCommands.findIndex(
    ({ command, args }) => command === 'age' && args.includes('--decrypt'),
  );
  const createdbIndex = restoreCommands.findIndex(
    ({ command }) => command === 'createdb',
  );
  const restoreIndex = restoreCommands.findIndex(
    ({ command }) => command === 'pg_restore',
  );
  const objectIndex = restoreCommands.findIndex(
    ({ command }) => command === 'aws',
  );
  assert.ok(
    decryptIndex >= 0 &&
      createdbIndex > decryptIndex &&
      restoreIndex > createdbIndex &&
      objectIndex > restoreIndex,
  );
  assert.ok(restoreCommands[restoreIndex].args.includes('--exit-on-error'));
  for (const invocation of restoreCommands)
    assert.equal(invocation.options.shell, false);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(directory, 'restore-rehearsal.json'), 'utf8'),
    ),
    report,
  );
  assertNoSensitiveText(JSON.stringify(report));
  assert.equal(report.restoreDatabase, 'imeal_restore_20260928');
  assert.equal(manifest.result, 'PASS');
});

test('fails closed on checksum mismatch without creating a restore database', async () => {
  const directory = await makeDirectory();
  const manifestPath = join(directory, 'backup-manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      result: 'PASS',
      encryption: { algorithm: 'age' },
      releaseId,
      target: { database: 'imeal_staging', schema },
      artifact: {
        encryptedFile: 'missing.age',
        sha256: 'a'.repeat(64),
        bytes: 10,
      },
      storage: {
        endpoint: 'https://minio.staging.example',
        bucket: 'imeal-staging-private',
        key: 'backups/x',
      },
      timestamps: {
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        completedAt: new Date().toISOString(),
      },
    }),
    'utf8',
  );
  const commands = [];
  const outputPath = join(directory, 'restore-rehearsal.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
    }),
    /artifact|checksum|read|ENOENT/i,
  );
  assert.equal(commands.length, 0);
  const failureReport = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(failureReport.result, 'FAIL');
});

test('rejects restoring over the source database or bucket before commands', async () => {
  const directory = await makeDirectory();
  const manifestPath = join(directory, 'backup-manifest.json');
  const artifactPath = join(directory, 'encrypted.age');
  await writeFile(artifactPath, 'artifact', 'utf8');
  const checksum = await sha256File(artifactPath);
  await writeFile(
    manifestPath,
    JSON.stringify({
      result: 'PASS',
      encryption: { algorithm: 'age' },
      releaseId,
      target: { database: 'imeal_staging', schema },
      artifact: { encryptedFile: 'encrypted.age', sha256: checksum, bytes: 8 },
      storage: {
        endpoint: 'https://minio.staging.example',
        bucket: 'imeal-staging-private',
        key: 'backups/x',
      },
      timestamps: {
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        completedAt: new Date().toISOString(),
      },
    }),
    'utf8',
  );
  const commands = [];
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_staging',
      restoreBucket: 'imeal-staging-private',
      outputPath: join(directory, 'restore.json'),
      commandRunner: createCommandRunner(commands),
    }),
    /isolat|source/i,
  );
  assert.equal(commands.length, 0);
});
