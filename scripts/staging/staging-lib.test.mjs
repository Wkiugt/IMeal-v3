import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';

import {
  assertNoSecrets,
  assertTargetFingerprint,
  parseArgs,
  redactDatabaseUrl,
  requireSafeSchemaName,
  runPsql,
  sha256File,
  sha256Text,
  writeEvidence,
} from './staging-lib.mjs';

test('accepts only simple approved schema identifiers', () => {
  assert.equal(
    requireSafeSchemaName('phase0_staging_20260928'),
    'phase0_staging_20260928',
  );
  for (const invalid of [
    '',
    'public; DROP SCHEMA public',
    'phase0 staging',
    'phase0"staging',
    'phase0\nstaging',
  ]) {
    assert.throws(() => requireSafeSchemaName(invalid), /schema/i);
  }
});

test('redacts credentials from database URLs without changing public URLs', () => {
  assert.equal(
    redactDatabaseUrl('postgresql://admin:password@db.example/imeal'),
    'postgresql://<redacted>@db.example/imeal',
  );
  assert.equal(
    redactDatabaseUrl('postgresql://db.example/imeal?schema=phase0_staging'),
    'postgresql://db.example/imeal?schema=phase0_staging',
  );
  assert.equal(redactDatabaseUrl('not-a-url'), 'not-a-url');
});

test('parses typed long options and rejects unknown or malformed values', () => {
  assert.deepEqual(
    parseArgs(['--schema', 'phase0_staging', '--read-only', '--timeout=12'], {
      schema: { type: 'string', required: true },
      'read-only': { type: 'boolean' },
      timeout: { type: 'string', default: '30' },
    }),
    { schema: 'phase0_staging', 'read-only': true, timeout: '12' },
  );
  assert.throws(
    () => parseArgs(['--unknown', 'x'], { schema: 'string' }),
    /unknown/i,
  );
  assert.throws(() => parseArgs(['--schema'], { schema: 'string' }), /value/i);
  assert.throws(
    () => parseArgs(['--read-only=false'], { 'read-only': 'boolean' }),
    /boolean/i,
  );
});

test('hashes text and files deterministically with SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staging-lib-'));
  const filePath = join(directory, 'payload.txt');
  const value = 'phase-0\n';
  await writeFile(filePath, value, 'utf8');
  const expected = createHash('sha256').update(value).digest('hex');
  assert.equal(sha256Text(value), expected);
  assert.equal(await sha256File(filePath), expected);
});

test('reports target fingerprint mismatches without leaking unrelated values', () => {
  assert.doesNotThrow(() =>
    assertTargetFingerprint(
      { database: 'imeal_staging', schema: 'phase0_staging' },
      { database: 'imeal_staging', schema: 'phase0_staging' },
    ),
  );
  assert.throws(
    () =>
      assertTargetFingerprint(
        { database: 'imeal_other', schema: 'phase0_staging' },
        { database: 'imeal_staging', schema: 'phase0_staging' },
      ),
    /target fingerprint mismatch.*database/i,
  );
});

test('rejects secret-like keys and bounded assignment values before evidence serialization', () => {
  for (const value of [
    { password: 'do-not-write' },
    { accessToken: 'do-not-write' },
    { nested: { clientSecret: 'do-not-write' } },
    { connection: 'postgresql://user:password@db.example/imeal' },
    { authorization: 'Bearer eyJhbGciOiJub25lIn0.secret' },
    'password=actual',
    'password="actual secret"; next=ok',
    'token=token-value',
    'apiKey=api-value',
    'otp=123456',
    'providerPayload={"secret":"provider-value"}',
    { providerPayload: { message: 'provider value' } },
    '{"password":"actual","token":"abc"}',
    '{"providerPayload":{"message":"provider value","nested":{"otp":"123456"}}}',
  ]) {
    assert.throws(() => assertNoSecrets(value), /secret/i);
  }
  assert.doesNotThrow(() =>
    assertNoSecrets({
      databaseUrl: 'postgresql://<redacted>@db.example/imeal',
    }),
  );
  assert.doesNotThrow(() =>
    assertNoSecrets(
      'safe check text: password authentication failed passwordless=allowed tokenized=allowed',
    ),
  );
});

test('rejects bounded assignment values when writing evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staging-evidence-secret-'));
  for (const diagnostic of [
    'password=actual',
    'password="actual secret"; next=ok',
    'token=token-value',
    'apiKey=api-value',
    'otp=123456',
    'provider_payload={"payload":"provider-value"}',
    '{"password":"actual","token":"abc"}',
    '{"providerPayload":{"nested":{"apiKey":"provider-value","otp":"123456"}}}',
  ]) {
    await assert.rejects(
      writeEvidence(join(directory, 'evidence.json'), { diagnostic }),
      /secret/i,
    );
  }
});

test('writes redacted evidence atomically and leaves no temporary file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staging-evidence-'));
  const filePath = join(directory, 'evidence.json');
  await writeEvidence(filePath, {
    result: 'PASS',
    target: { schema: 'phase0_staging' },
  });
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    result: 'PASS',
    target: { schema: 'phase0_staging' },
  });
  assert.equal((await stat(filePath)).mode & 0o222, 0);
  assert.deepEqual(
    (await (await import('node:fs/promises')).readdir(directory)).sort(),
    ['evidence.json'],
  );
  await assert.rejects(
    writeEvidence(filePath, { approvalToken: 'forbidden' }),
    /secret/i,
  );
});

test('runs psql with shell disabled, validated target search path, timeout and read-only mode', async () => {
  const originalSpawn = childProcess.spawn;
  const readOnlyPrelude = [
    'BEGIN;',
    'SET TRANSACTION READ ONLY;',
    "SET LOCAL statement_timeout = '7000ms';",
    'SET LOCAL search_path TO phase0_staging, pg_catalog;',
  ].join('\n');
  let invocation;
  childProcess.spawn = (command, argv, options) => {
    invocation = { command, argv, options };
    const listeners = new Map();
    const child = {
      stdout: {
        on(event, handler) {
          listeners.set(`stdout:${event}`, handler);
        },
      },
      stderr: {
        on(event, handler) {
          listeners.set(`stderr:${event}`, handler);
        },
      },
      on(event, handler) {
        listeners.set(event, handler);
        return child;
      },
    };
    queueMicrotask(() => {
      listeners.get('stdout:data')?.(Buffer.from('ok\n'));
      listeners.get('stderr:data')?.(
        Buffer.from(
          'password=actual token=token-value apiKey=api-value otp=123456 providerPayload={"payload":"provider-value"} passwordless=allowed tokenized=allowed safe check=password authentication failed {"password":"actual","token":"abc","providerPayload":{"message":"provider payload", "nested":{"apiKey":"value","otp":"123456"}}}\n',
        ),
      );
      listeners.get('close')?.(0);
    });
    return child;
  };
  try {
    const result = await runPsql({
      databaseUrl: 'postgresql://admin:password@db.example/imeal',
      schema: 'phase0_staging',
      sql: 'select 1',
      readOnly: true,
      statementTimeoutSeconds: 7,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ok\n');
    assert.equal(
      result.stderr,
      'password=<redacted> token=<redacted> apiKey=<redacted> otp=<redacted> providerPayload=<redacted> passwordless=allowed tokenized=allowed safe check=password authentication failed {"password":"<redacted>","token":"<redacted>","providerPayload":"<redacted>"}\n',
    );
    assert.deepEqual(result.argv, [
      '--no-psqlrc',
      '--set=ON_ERROR_STOP=1',
      '--dbname',
      'postgresql://<redacted>@db.example/imeal',
      '--command',
      `${readOnlyPrelude}\nselect 1\nCOMMIT;`,
    ]);
    assert.equal(invocation.command, 'psql');
    assert.equal(invocation.options.shell, false);
    assert.equal(
      invocation.options.env.PGOPTIONS,
      '-c search_path=phase0_staging,pg_catalog -c statement_timeout=7000 -c default_transaction_read_only=on',
    );
    assert.ok(
      invocation.argv
        .join('\u0000')
        .includes('postgresql://admin:password@db.example/imeal'),
    );
    assert.doesNotMatch(result.argv.join('\u0000'), /admin:password@/);
    assert.doesNotMatch(
      result.stderr,
      /actual|token-value|api-value|123456|provider-value/,
    );
  } finally {
    childProcess.spawn = originalSpawn;
  }
});
test('starts read-only psql sessions before read-write overrides and trusted transactions', async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (_command, argv, options) => {
    invocations.push({ argv, options });
    const listeners = new Map();
    const child = {
      stdout: {
        on(event, handler) {
          listeners.set(`stdout:${event}`, handler);
        },
      },
      stderr: {
        on(event, handler) {
          listeners.set(`stderr:${event}`, handler);
        },
      },
      on(event, handler) {
        listeners.set(event, handler);
        return child;
      },
    };
    queueMicrotask(() => listeners.get('close')?.(0));
    return child;
  };
  try {
    await assert.rejects(
      runPsql({
        databaseUrl: 'postgresql://admin:password@db.example/imeal',
        schema: 'phase0_staging',
        sql: 'SET TRANSACTION READ WRITE; INSERT INTO protected_table VALUES (1);',
        readOnly: true,
        statementTimeoutSeconds: 5,
      }),
      /read-only transaction control/i,
    );
    await runPsql({
      databaseUrl: 'postgresql://admin:password@db.example/imeal',
      schema: 'phase0_staging',
      sql: 'BEGIN;\nSELECT 1;\nCOMMIT;',
      readOnly: true,
      statementTimeoutSeconds: 5,
    });
    for (const invocation of invocations) {
      const joined = invocation.argv.join('\n');
      const preludeIndex = joined.indexOf('SET TRANSACTION READ ONLY;');
      const requestedSqlIndex = joined.indexOf('SET TRANSACTION READ WRITE;');
      assert.ok(preludeIndex >= 0);
      if (requestedSqlIndex >= 0) {
        assert.ok(preludeIndex < requestedSqlIndex);
      }
      assert.match(
        invocation.options.env.PGOPTIONS,
        /default_transaction_read_only=on/,
      );
    }
    assert.match(
      invocations[0].argv.join('\n'),
      /SET LOCAL search_path TO phase0_staging, pg_catalog;\nSELECT 1;\nCOMMIT;/,
    );
  } finally {
    childProcess.spawn = originalSpawn;
  }
});
test('loads read-only SQL files into one command and rejects transaction overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staging-psql-'));
  const sqlFile = join(directory, 'preflight.sql');
  await writeFile(sqlFile, 'BEGIN;\nSELECT 1;\nCOMMIT;\n', 'utf8');
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (_command, argv, options) => {
    invocations.push({ argv, options });
    const listeners = new Map();
    const child = {
      stdout: {
        on(event, handler) {
          listeners.set(`stdout:${event}`, handler);
        },
      },
      stderr: {
        on(event, handler) {
          listeners.set(`stderr:${event}`, handler);
        },
      },
      on(event, handler) {
        listeners.set(event, handler);
        return child;
      },
    };
    queueMicrotask(() => listeners.get('close')?.(0));
    return child;
  };
  try {
    const readOnlyResult = await runPsql({
      databaseUrl: 'postgresql://admin:password@db.example/imeal',
      schema: 'phase0_staging',
      sqlFile,
      readOnly: true,
      statementTimeoutSeconds: 5,
    });
    assert.equal(readOnlyResult.exitCode, 0);
    const readOnlyArgs = invocations[0].argv;
    assert.equal(
      readOnlyArgs.filter((argument) => argument === '--command').length,
      1,
    );
    assert.equal(
      readOnlyArgs[readOnlyArgs.indexOf('--command') + 1],
      [
        'BEGIN;',
        'SET TRANSACTION READ ONLY;',
        "SET LOCAL statement_timeout = '5000ms';",
        'SET LOCAL search_path TO phase0_staging, pg_catalog;',
        'SELECT 1;',
        'COMMIT;',
      ].join('\n'),
    );

    for (const sql of [
      'SET TRANSACTION READ WRITE;',
      'SET default_transaction_read_only = off;',
      'COMMIT;',
      'ROLLBACK;',
    ]) {
      await assert.rejects(
        runPsql({
          databaseUrl: 'postgresql://admin:password@db.example/imeal',
          schema: 'phase0_staging',
          sql,
          readOnly: true,
          statementTimeoutSeconds: 5,
        }),
        /read-only transaction control/i,
      );
    }

    const readWriteResult = await runPsql({
      databaseUrl: 'postgresql://admin:password@db.example/imeal',
      schema: 'phase0_staging',
      sqlFile,
      readOnly: false,
      statementTimeoutSeconds: 5,
    });
    assert.equal(readWriteResult.exitCode, 0);
    const readWriteArgs = invocations[1].argv;
    assert.equal(readWriteArgs.includes('--file'), true);
    assert.equal(readWriteArgs.includes(sqlFile), true);
    assert.equal(readWriteArgs.includes('--command'), false);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('returns redacted diagnostics and child exit codes on failed psql', async () => {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (_command, _argv, _options) => {
    const listeners = new Map();
    const child = {
      stdout: {
        on(event, handler) {
          listeners.set(`stdout:${event}`, handler);
        },
      },
      stderr: {
        on(event, handler) {
          listeners.set(`stderr:${event}`, handler);
        },
      },
      on(event, handler) {
        listeners.set(event, handler);
        return child;
      },
    };
    queueMicrotask(() => {
      listeners.get('stderr:data')?.(
        Buffer.from(
          'connect postgresql://admin:password@db.example/imeal failed\n',
        ),
      );
      listeners.get('close')?.(3);
    });
    return child;
  };
  try {
    const result = await runPsql({
      databaseUrl: 'postgresql://admin:password@db.example/imeal',
      schema: 'phase0_staging',
      sql: 'select 1',
      readOnly: false,
      statementTimeoutSeconds: 3,
    });
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /postgresql:\/\/<redacted>@db\.example/);
    assert.doesNotMatch(result.stderr, /password/);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});
