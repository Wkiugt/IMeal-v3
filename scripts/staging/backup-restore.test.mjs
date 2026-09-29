import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createBackup } from './backup-staging.mjs';
import { restoreRehearsal } from './restore-rehearsal.mjs';
import { safeDiagnostic, sha256File } from './staging-lib.mjs';

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

function targetFingerprintOutput() {
  return 'phase0-target:{"database":"imeal_staging","schema":"phase0_staging_20260928","serverVersion":"PostgreSQL 16.4"}\n';
}

const migrationFingerprintOutput = 'phase0-migrations:[]\n';

function createCommandRunner(commands, { failCommand } = {}) {
  return async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === 'psql') {
      const sql = args[args.indexOf('--command') + 1] ?? '';
      if (sql.includes('phase0-target:')) {
        return commandResult({ stdout: targetFingerprintOutput() });
      }
      if (sql.includes('phase0-migrations:')) {
        return commandResult({ stdout: migrationFingerprintOutput });
      }
      if (sql.includes('_prisma_migrations')) {
        return commandResult({ stdout: '0\n' });
      }
      return commandResult({ stdout: '1\n' });
    }
    if (command === 'aws' && args[0] === 's3api' && args[1] === 'head-object') {
      return commandResult({
        stdout: JSON.stringify({ ContentLength: 21 }),
      });
    }
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
async function writeRestoreFixture(
  directory,
  { bytes = 21, omitBytes = false } = {},
) {
  const artifactPath = join(directory, 'encrypted.age');
  const artifactContents = 'encrypted dump bytes\n';
  await writeFile(artifactPath, artifactContents, 'utf8');
  const manifestPath = join(directory, 'backup-manifest.json');
  const artifact = {
    encryptedFile: 'encrypted.age',
    sha256: await sha256File(artifactPath),
  };
  if (!omitBytes) artifact.bytes = bytes;
  await writeFile(
    manifestPath,
    JSON.stringify({
      result: 'PASS',
      encryption: { algorithm: 'age' },
      releaseId,
      target: { database: 'imeal_staging', schema },
      targetFingerprint: {
        database: 'imeal_staging',
        schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
      artifact,
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
  return manifestPath;
}

function assertNoSensitiveText(value) {
  assert.doesNotMatch(value, /postgres(?:ql)?:\/\/[^\s"']+@/i);
  assert.doesNotMatch(value, /super-secret|otp|123456|alice@example\.com/i);
}

test('redacts JSON secrets, Bearer diagnostics and private keys', () => {
  const diagnostic = safeDiagnostic(
    '{"password":"super-secret","provider_payload":{"otp":"123456"}} Bearer bearer-token -----BEGIN PRIVATE KEY-----\nsecret',
  );
  assert.doesNotMatch(
    diagnostic,
    /super-secret|123456|bearer-token|BEGIN PRIVATE KEY/i,
  );
  assert.match(diagnostic, /<redacted>/i);
});

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
    assert.deepEqual(manifest.targetFingerprint, {
      database: 'imeal_staging',
      schema,
      serverVersion: 'PostgreSQL 16.4',
      migrationRows: [],
    });
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
    assert.equal(pgDump.args.includes(databaseUrl), false);
    assert.equal(pgDump.args.includes('super-secret'), false);
    assert.equal(pgDump.options.env.PGPASSWORD, 'super-secret');
    assert.equal(pgDump.args.includes('imeal_staging'), true);
    const psqlInvocations = commands.filter(
      ({ command }) => command === 'psql',
    );
    assert.equal(psqlInvocations.length, 2);
    assert.ok(
      psqlInvocations[0].options.env.PGOPTIONS.includes(
        'statement_timeout=30000',
      ),
    );
    assert.ok(commands.indexOf(psqlInvocations[1]) < commands.indexOf(pgDump));
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
    if (command === 'psql') {
      const sql = args[args.indexOf('--command') + 1] ?? '';
      if (sql.includes('phase0-target:')) {
        return commandResult({ stdout: targetFingerprintOutput() });
      }
      if (sql.includes('phase0-migrations:')) {
        return commandResult({ stdout: migrationFingerprintOutput });
      }
    }
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

test('fails closed when plaintext cleanup is denied before copy or PASS manifest', async () => {
  const directory = await makeDirectory();
  const commands = [];
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  const fileRemover = async (path) => {
    if (path.endsWith('.dump')) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
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
        commandRunner: createCommandRunner(commands),
        fileRemover,
      }),
      /plaintext dump cleanup|permission denied/i,
    );
    await access(join(directory, `${releaseId}.dump`));
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
  assert.equal(report.migration.result, 'PASS');
  assert.equal(report.smoke.result, 'PASS');
  assert.equal(report.objects.result, 'PASS');
  assert.equal(report.objects.bytes, 21);
  assert.equal(report.objects.checksumVerified, 'NOT_RETURNED');
  assert.equal(report.database.result, 'PASS');
  assert.equal(report.database.rows, 1);
  assert.equal(report.database.count, 1);
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
  const databaseIndex = restoreCommands.findIndex(
    ({ command, args }) =>
      command === 'psql' &&
      args.some((arg) => arg.includes('count(*)::bigint')),
  );
  const bucketCreateIndex = restoreCommands.findIndex(
    ({ command, args }) => command === 'aws' && args.includes('create-bucket'),
  );
  const objectIndex = restoreCommands.findIndex(
    ({ command, args }) => command === 'aws' && args.includes('cp'),
  );
  const objectVerificationIndex = restoreCommands.findIndex(
    ({ command, args }) => command === 'aws' && args.includes('head-object'),
  );
  const migrationIndex = restoreCommands.findIndex(
    ({ command, args }) =>
      command === 'psql' &&
      args.some((arg) => arg.includes('_prisma_migrations')),
  );
  assert.ok(
    decryptIndex >= 0 &&
      createdbIndex > decryptIndex &&
      restoreIndex > createdbIndex &&
      databaseIndex > restoreIndex &&
      bucketCreateIndex > databaseIndex &&
      objectIndex > bucketCreateIndex &&
      objectVerificationIndex > objectIndex &&
      migrationIndex > objectVerificationIndex,
  );
  assert.ok(restoreCommands[restoreIndex].args.includes('--exit-on-error'));
  assert.equal(
    restoreCommands[databaseIndex].options.env.PGOPTIONS,
    '-c statement_timeout=30000',
  );
  assert.deepEqual(restoreCommands[databaseIndex].args.slice(0, 2), [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
  ]);
  assert.deepEqual(restoreCommands[migrationIndex].args.slice(0, 2), [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
  ]);
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
test('records callback database row-count verification before later gates', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  const report = await restoreRehearsal({
    backupManifestPath: manifestPath,
    restoreDatabase: 'imeal_restore_20260928',
    restoreBucket: 'imeal-restore-20260928',
    outputPath: join(directory, 'database-callback.json'),
    commandRunner: createCommandRunner(commands),
    databaseCheck: async ({
      database: targetDatabase,
      schema: targetSchema,
    }) => {
      assert.equal(targetDatabase, 'imeal_restore_20260928');
      assert.equal(targetSchema, schema);
      return { result: 'PASS', rows: 7 };
    },
  });
  assert.deepEqual(report.database, {
    restored: 'PASS',
    result: 'PASS',
    rows: 7,
    count: 7,
  });
  assert.equal(
    commands.some(
      ({ command, args }) =>
        command === 'psql' &&
        args.some((arg) => arg.includes('count(*)::bigint')),
    ),
    false,
  );
  const migrationInvocation = commands.find(
    ({ command, args }) =>
      command === 'psql' &&
      args.some((arg) => arg.includes('_prisma_migrations')),
  );
  const smokeInvocation = commands.find(
    ({ command, args }) => command === 'psql' && args.includes('SELECT 1;'),
  );
  for (const invocation of [migrationInvocation, smokeInvocation]) {
    assert.ok(invocation);
    assert.deepEqual(invocation.args.slice(0, 2), [
      '--no-psqlrc',
      '--set=ON_ERROR_STOP=1',
    ]);
  }
});

test('fails closed on invalid database row-count verification', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  const outputPath = join(directory, 'database-count-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
      databaseCheck: async () => ({ result: 'PASS', rows: -1 }),
      readinessCheck: async () => ({ result: 'PASS' }),
      smokeCheck: async () => ({ result: 'PASS' }),
    }),
    /database row count is invalid/i,
  );
  assert.equal(
    commands.some(
      ({ command, args }) =>
        command === 'aws' && args.includes('create-bucket'),
    ),
    false,
  );
  assert.equal(
    commands.some(
      ({ command, args }) =>
        command === 'psql' &&
        args.some((arg) => arg.includes('_prisma_migrations')),
    ),
    false,
  );
  const failure = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.deepEqual(failure.database, { result: 'FAIL' });
});
test('requires explicit PASS from database row-count callbacks', async () => {
  for (const [name, result] of [
    ['missing-result', { rows: 1 }],
    ['unknown-result', { result: 'UNKNOWN', rows: 1 }],
  ]) {
    const directory = await makeDirectory();
    const manifestPath = await writeRestoreFixture(directory);
    const commands = [];
    let readinessCalled = false;
    let smokeCalled = false;
    const outputPath = join(directory, `${name}-failure.json`);
    await assert.rejects(
      restoreRehearsal({
        backupManifestPath: manifestPath,
        restoreDatabase: 'imeal_restore_20260928',
        restoreBucket: 'imeal-restore-20260928',
        outputPath,
        commandRunner: createCommandRunner(commands),
        databaseCheck: async () => result,
        readinessCheck: async () => {
          readinessCalled = true;
          return { result: 'PASS' };
        },
        smokeCheck: async () => {
          smokeCalled = true;
          return { result: 'PASS' };
        },
      }),
      /restore database row count failed/i,
    );
    assert.equal(readinessCalled, false);
    assert.equal(smokeCalled, false);
    assert.equal(
      commands.some(
        ({ command, args }) =>
          command === 'aws' && args.includes('create-bucket'),
      ),
      false,
    );
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')).database, {
      result: 'FAIL',
    });
  }
});

test('fails closed on invalid readiness callback results before smoke', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  let smokeCalled = false;
  const outputPath = join(directory, 'readiness-invalid.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
      readinessCheck: async () => ({ result: 'UNKNOWN' }),
      smokeCheck: async () => {
        smokeCalled = true;
        return { result: 'PASS' };
      },
    }),
    /readiness check failed/i,
  );
  assert.equal(smokeCalled, false);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).result, 'FAIL');
});

test('fails closed on undefined smoke callback results', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  let readinessCalled = false;
  const outputPath = join(directory, 'smoke-undefined.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
      readinessCheck: async () => {
        readinessCalled = true;
        return { result: 'PASS' };
      },
      smokeCheck: async () => undefined,
    }),
    /smoke check failed/i,
  );
  assert.equal(readinessCalled, true);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).result, 'FAIL');
});
test('requires explicit PASS and zero unfinished migrations from callbacks', async () => {
  for (const [name, result] of [
    ['missing-result', { unfinished: 0 }],
    ['unknown-result', { result: 'UNKNOWN', unfinished: 0 }],
    ['unfinished', { result: 'PASS', unfinished: 1 }],
  ]) {
    const directory = await makeDirectory();
    const manifestPath = await writeRestoreFixture(directory);
    const commands = [];
    let readinessCalled = false;
    let smokeCalled = false;
    const outputPath = join(directory, `${name}-migration-failure.json`);
    await assert.rejects(
      restoreRehearsal({
        backupManifestPath: manifestPath,
        restoreDatabase: 'imeal_restore_20260928',
        restoreBucket: 'imeal-restore-20260928',
        outputPath,
        commandRunner: createCommandRunner(commands),
        migrationCheck: async () => result,
        readinessCheck: async () => {
          readinessCalled = true;
          return { result: 'PASS' };
        },
        smokeCheck: async () => {
          smokeCalled = true;
          return { result: 'PASS' };
        },
      }),
      /restore migration status failed/i,
    );
    assert.equal(readinessCalled, false);
    assert.equal(smokeCalled, false);
    assert.equal(
      commands.some(
        ({ command, args }) =>
          command === 'psql' &&
          args.some((arg) => arg.includes('_prisma_migrations')),
      ),
      false,
    );
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')).migration, {
      result: 'FAIL',
    });
  }
});

test('fails before migration checks when restored object size mismatches', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  const baseRunner = createCommandRunner(commands);
  const failingRunner = async (command, args, options) => {
    if (command === 'aws' && args.includes('head-object')) {
      commands.push({ command, args, options });
      return commandResult({
        stdout: JSON.stringify({ ContentLength: 20 }),
      });
    }
    return baseRunner(command, args, options);
  };
  let readinessCalled = false;
  const outputPath = join(directory, 'object-size-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: failingRunner,
      readinessCheck: async () => {
        readinessCalled = true;
        return { result: 'PASS' };
      },
      smokeCheck: async () => ({ result: 'PASS' }),
    }),
    /restore object byte count mismatch/i,
  );
  assert.equal(readinessCalled, false);
  assert.equal(
    commands.some(
      ({ command, args }) =>
        command === 'psql' &&
        args.some((arg) => arg.includes('_prisma_migrations')),
    ),
    false,
  );
  const failure = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(failure.result, 'FAIL');
  assert.deepEqual(failure.objects, { result: 'FAIL' });
});
test('fails before migration checks when restored object checksum mismatches', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  const baseRunner = createCommandRunner(commands);
  const failingRunner = async (command, args, options) => {
    if (command === 'aws' && args.includes('head-object')) {
      commands.push({ command, args, options });
      return commandResult({
        stdout: JSON.stringify({
          ContentLength: 21,
          ChecksumSHA256: 'invalid-checksum',
        }),
      });
    }
    return baseRunner(command, args, options);
  };
  const outputPath = join(directory, 'object-checksum-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: failingRunner,
    }),
    /restore object checksum mismatch/i,
  );
  assert.equal(
    commands.some(
      ({ command, args }) =>
        command === 'psql' &&
        args.some((arg) => arg.includes('_prisma_migrations')),
    ),
    false,
  );
});

test('fails the RTO gate after checks before writing PASS', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory);
  const commands = [];
  let now = Date.now();
  let smokeCalled = false;
  const outputPath = join(directory, 'rto-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
      clock: () => new Date(now),
      readinessCheck: async () => ({ result: 'PASS' }),
      smokeCheck: async () => {
        smokeCalled = true;
        now += 3_600_001 * 1000;
        return { result: 'PASS' };
      },
    }),
    /RTO exceeds/i,
  );
  assert.equal(smokeCalled, true);
  const failure = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(failure.result, 'FAIL');
  assert.ok(failure.rtoSeconds > 3_600);
});

test('rejects a restore manifest with missing artifact bytes before commands', async () => {
  const directory = await makeDirectory();
  const manifestPath = await writeRestoreFixture(directory, {
    omitBytes: true,
  });
  const commands = [];
  const outputPath = join(directory, 'missing-bytes-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
    }),
    /artifact byte count is invalid/i,
  );
  assert.equal(commands.length, 0);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).result, 'FAIL');
});
test('surfaces failure report write errors with the original failure', async () => {
  const directory = await makeDirectory();
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: join(directory, 'missing-manifest.json'),
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath: directory,
      commandRunner: createCommandRunner([]),
    }),
    (error) =>
      /failure report write failed/i.test(error.message) &&
      /backup manifest cannot be read/i.test(error.message),
  );
});

test('aborts before object copy when the fresh restore bucket cannot be created', async () => {
  const directory = await makeDirectory();
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  try {
    await createBackup({
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
      commandRunner: createCommandRunner([]),
    });
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
  const commands = [];
  const baseRunner = createCommandRunner(commands);
  const failingRunner = async (command, args, options) => {
    if (command === 'aws' && args.includes('create-bucket')) {
      commands.push({ command, args, options });
      return commandResult({ stderr: 'bucket already exists', exitCode: 409 });
    }
    return baseRunner(command, args, options);
  };
  const outputPath = join(directory, 'restore-bucket-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: join(directory, 'backup-manifest.json'),
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: failingRunner,
    }),
    /fresh restore bucket creation|already exists/i,
  );
  assert.equal(
    commands.some(
      ({ command, args }) => command === 'aws' && args.includes('cp'),
    ),
    false,
  );
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).result, 'FAIL');
});

test('fails the migration-status gate before readiness and smoke', async () => {
  const directory = await makeDirectory();
  const previousRecipient = process.env.AGE_RECIPIENT;
  process.env.AGE_RECIPIENT = 'age1stagingrecipient';
  try {
    await createBackup({
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
      commandRunner: createCommandRunner([]),
    });
  } finally {
    if (previousRecipient === undefined) delete process.env.AGE_RECIPIENT;
    else process.env.AGE_RECIPIENT = previousRecipient;
  }
  const commands = [];
  let readinessCalled = false;
  const outputPath = join(directory, 'migration-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: join(directory, 'backup-manifest.json'),
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
      migrationCheck: async () => ({ result: 'FAIL', unfinished: 1 }),
      readinessCheck: async () => {
        readinessCalled = true;
        return { result: 'PASS' };
      },
      smokeCheck: async () => ({ result: 'PASS' }),
    }),
    /migration status failed/i,
  );
  assert.equal(readinessCalled, false);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).result, 'FAIL');
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
      targetFingerprint: {
        database: 'imeal_staging',
        schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
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

test('fails the RPO gate before decrypt or restore commands', async () => {
  const directory = await makeDirectory();
  const artifactPath = join(directory, 'old.age');
  await writeFile(artifactPath, 'encrypted artifact', 'utf8');
  const checksum = await sha256File(artifactPath);
  const oldCompletedAt = new Date(Date.now() - 90_000_000).toISOString();
  const manifestPath = join(directory, 'backup-manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      result: 'PASS',
      encryption: { algorithm: 'age' },
      releaseId,
      target: { database: 'imeal_staging', schema },
      targetFingerprint: {
        database: 'imeal_staging',
        schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
      artifact: {
        encryptedFile: 'old.age',
        sha256: checksum,
        bytes: Buffer.byteLength('encrypted artifact'),
      },
      storage: {
        endpoint: 'https://minio.staging.example',
        bucket: 'imeal-staging-private',
        key: 'backups/x',
      },
      timestamps: {
        startedAt: new Date(Date.now() - 90_001_000).toISOString(),
        completedAt: oldCompletedAt,
      },
    }),
    'utf8',
  );
  const commands = [];
  const outputPath = join(directory, 'rpo-failure.json');
  await assert.rejects(
    restoreRehearsal({
      backupManifestPath: manifestPath,
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath,
      commandRunner: createCommandRunner(commands),
    }),
    /RPO exceeds/i,
  );
  assert.equal(commands.length, 0);
  const failure = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(failure.result, 'FAIL');
  assert.ok(failure.rpoSeconds > 86_400);
});
test('rejects a restore manifest with an inconsistent target fingerprint before commands', async () => {
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
      targetFingerprint: {
        database: 'unexpected_database',
        schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
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
      restoreDatabase: 'imeal_restore_20260928',
      restoreBucket: 'imeal-restore-20260928',
      outputPath: join(directory, 'restore.json'),
      commandRunner: createCommandRunner(commands),
    }),
    /target fingerprint mismatch/i,
  );
  assert.equal(commands.length, 0);
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
      targetFingerprint: {
        database: 'imeal_staging',
        schema,
        serverVersion: 'PostgreSQL 16.4',
        migrationRows: [],
      },
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
