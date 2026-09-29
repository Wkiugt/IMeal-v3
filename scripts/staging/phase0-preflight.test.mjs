import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { sha256Text } from './staging-lib.mjs';
import { readFile, mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertPreflightPass,
  fingerprintTarget,
  main,
  parsePreflightOutput,
  runPreflight,
} from './phase0-preflight.mjs';

const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const readFixture = (name) => readFile(fixtureUrl(name), 'utf8');
const databaseUrl = 'postgresql://admin:password@db.example/imeal';
const schema = 'phase0_staging';
const target = { database: 'imeal_staging', schema };

async function makeOutputPath() {
  const directory = await mkdtemp(join(tmpdir(), 'phase0-preflight-'));
  return join(directory, 'preflight-before.json');
}

function installSpawn(responses, invocations = []) {
  const originalSpawn = childProcess.spawn;
  let responseIndex = 0;
  childProcess.spawn = (command, argv, options) => {
    const response = responses[responseIndex++];
    if (!response) throw new Error('unexpected psql invocation');
    invocations.push({ command, argv, options });
    assert.doesNotMatch(argv.join('\u0000'), /postgres(?:ql)?:\/\/|password/i);
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
      if (response.stdout) {
        listeners.get('stdout:data')?.(Buffer.from(response.stdout));
      }
      if (response.stderr) {
        listeners.get('stderr:data')?.(Buffer.from(response.stderr));
      }
      listeners.get('close')?.(response.exitCode ?? 0);
    });
    return child;
  };
  return () => {
    childProcess.spawn = originalSpawn;
  };
}

function targetOutput({
  database = 'imeal_staging',
  schemaName = schema,
} = {}) {
  return `phase0-target:{"database":"${database}","schema":"${schemaName}","serverVersion":"PostgreSQL 16.4"}\n`;
}

const migrationsOutput =
  'phase0-migrations:[{"migration_name":"20260928000000_phase0_domain_correctness","finished_at":"2026-09-28T00:00:00.000Z","rolled_back_at":null,"applied_steps_count":1}]\n';
function commandBody(invocation) {
  const commandIndex = invocation.argv.indexOf('--command');
  assert.notEqual(commandIndex, -1);
  return invocation.argv[commandIndex + 1];
}

test('parses every named check and status count from the clean fixture', async () => {
  const report = parsePreflightOutput(await readFixture('preflight-clean.txt'));
  assert.deepEqual(
    report.checks.map(({ name, affectedCount, sampleIds }) => ({
      name,
      affectedCount,
      sampleIds,
    })),
    [
      {
        name: 'registration_snapshot_incomplete',
        affectedCount: 0,
        sampleIds: [],
      },
      {
        name: 'registration_serving_mismatch',
        affectedCount: 0,
        sampleIds: [],
      },
      { name: 'roster_assignment_ambiguous', affectedCount: 0, sampleIds: [] },
      { name: 'menu_revision_incomplete', affectedCount: 0, sampleIds: [] },
      {
        name: 'penalty_registration_mapping_ambiguous',
        affectedCount: 0,
        sampleIds: [],
      },
      {
        name: 'penalty_registration_duplicate_candidate',
        affectedCount: 0,
        sampleIds: [],
      },
      {
        name: 'future_active_snapshot_incomplete',
        affectedCount: 0,
        sampleIds: [],
      },
    ],
  );
  assert.deepEqual(report.statusCounts, [
    { status: 'ACTIVE', count: 3 },
    { status: 'CANCELLED', count: 1 },
    { status: 'SERVED', count: 2 },
    { status: 'NO_SHOW', count: 0 },
  ]);
  assert.doesNotThrow(() => assertPreflightPass(report));
});

test('identifies the dirty check and fails the preflight assertion', async () => {
  const report = parsePreflightOutput(await readFixture('preflight-dirty.txt'));
  assert.equal(
    report.checks.find(
      (check) => check.name === 'future_active_snapshot_incomplete',
    )?.affectedCount,
    1,
  );
  assert.throws(
    () => assertPreflightPass(report),
    /future_active_snapshot_incomplete/,
  );
});

test('rejects malformed or incomplete preflight output', () => {
  assert.throws(
    () => parsePreflightOutput('check_name | affected_count | sample_ids\n'),
    /checks|seven-check/i,
  );
  assert.throws(
    () =>
      parsePreflightOutput(
        'check_name | affected_count | sample_ids\n' +
          'unexpected_check | 0 | {}\n',
      ),
    /check/i,
  );
});

test('parses quoted multi-ID sample arrays and rejects malformed arrays', async () => {
  const clean = await readFixture('preflight-clean.txt');
  const multiId = clean.replace(
    ' future_active_snapshot_incomplete     |              0 | {}',
    ' future_active_snapshot_incomplete     |              2 | {"registration-1","registration-2"}',
  );
  const report = parsePreflightOutput(multiId);
  assert.deepEqual(report.checks.at(-1).sampleIds, [
    'registration-1',
    'registration-2',
  ]);
  const malformed = clean.replace(
    ' future_active_snapshot_incomplete     |              0 | {}',
    ' future_active_snapshot_incomplete     |              1 | {registration-1',
  );
  assert.throws(() => parsePreflightOutput(malformed), /sample_ids/i);
});

test('fingerprints the target through bounded read-only psql calls', async () => {
  const invocations = [];
  const restore = installSpawn(
    [{ stdout: targetOutput() }, { stdout: migrationsOutput }],
    invocations,
  );
  try {
    const fingerprint = await fingerprintTarget({
      databaseUrl,
      schema,
    });
    assert.deepEqual(fingerprint, {
      database: 'imeal_staging',
      schema,
      serverVersion: 'PostgreSQL 16.4',
      migrationRows: [
        '{"migration_name":"20260928000000_phase0_domain_correctness","finished_at":"2026-09-28T00:00:00.000Z","rolled_back_at":null,"applied_steps_count":1}',
      ],
    });
    assert.equal(invocations.length, 2);
    for (const invocation of invocations) {
      assert.equal(invocation.command, 'psql');
      assert.equal(invocation.options.shell, false);
      assert.match(invocation.options.env.PGOPTIONS, /statement_timeout=30000/);
      assert.match(
        invocation.options.env.PGOPTIONS,
        /default_transaction_read_only=on/,
      );
      assert.equal(invocation.argv.includes('--command'), true);
    }
  } finally {
    restore();
  }
});

test('runs clean preflight read-only, hashes SQL and writes atomic evidence', async () => {
  const outputPath = await makeOutputPath();
  const clean = await readFixture('preflight-clean.txt');
  const invocations = [];
  const restore = installSpawn(
    [
      { stdout: targetOutput() },
      { stdout: migrationsOutput },
      { stdout: clean },
    ],
    invocations,
  );
  try {
    const result = await runPreflight({
      databaseUrl,
      schema,
      expectedTarget: target,
      releaseId: 'imeal-20260928-001',
      outputPath,
    });
    const sql = await readFile(
      new URL(
        '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql',
        import.meta.url,
      ),
      'utf8',
    );
    assert.equal(result.preflightSha256, sha256Text(sql));
    assert.equal(result.result, 'PASS');
    assert.deepEqual(result.target, target);
    assert.equal(result.targetFingerprint.serverVersion, 'PostgreSQL 16.4');
    assert.equal(result.checks.length, 7);
    assert.equal(result.statusCounts.length, 4);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
    assert.equal(invocations.length, 3);
    const preflightInvocation = invocations[2];
    assert.equal(preflightInvocation.argv.includes('--file'), false);
    assert.equal(preflightInvocation.argv.includes('--command'), true);
    assert.equal(
      commandBody(preflightInvocation).includes(
        sql.slice(
          sql.indexOf('SELECT check_name'),
          sql.indexOf('SELECT check_name') + 40,
        ),
      ),
      true,
    );
    assert.match(
      commandBody(preflightInvocation),
      /future_active_snapshot_incomplete/,
    );
  } finally {
    restore();
  }
});

test('does not write evidence for dirty checks, target mismatch or SQL failure', async () => {
  const dirtyOutput = await makeOutputPath();
  const dirty = await readFixture('preflight-dirty.txt');
  let restore = installSpawn([
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: dirty },
  ]);
  try {
    await assert.rejects(
      runPreflight({
        databaseUrl,
        schema,
        expectedTarget: target,
        releaseId: 'imeal-20260928-001',
        outputPath: dirtyOutput,
      }),
      /future_active_snapshot_incomplete/,
    );
    await assert.rejects(access(dirtyOutput));
  } finally {
    restore();
  }

  const mismatchOutput = await makeOutputPath();
  restore = installSpawn([
    { stdout: targetOutput({ database: 'wrong_database' }) },
    { stdout: migrationsOutput },
  ]);
  try {
    await assert.rejects(
      runPreflight({
        databaseUrl,
        schema,
        expectedTarget: target,
        releaseId: 'imeal-20260928-001',
        outputPath: mismatchOutput,
      }),
      /target fingerprint mismatch.*database/i,
    );
    await assert.rejects(access(mismatchOutput));
  } finally {
    restore();
  }

  const sqlFailureOutput = await makeOutputPath();
  restore = installSpawn([
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stderr: 'preflight failed\n', exitCode: 17 },
  ]);
  try {
    await assert.rejects(
      runPreflight({
        databaseUrl,
        schema,
        expectedTarget: target,
        releaseId: 'imeal-20260928-001',
        outputPath: sqlFailureOutput,
      }),
      /preflight SQL failed.*17/i,
    );
    await assert.rejects(access(sqlFailureOutput));
  } finally {
    restore();
  }
});

test('CLI rejects credentialed expected database values and preserves valid names', async () => {
  const outputPath = await makeOutputPath();
  const args = [
    '--database-url-env',
    'TARGET_DATABASE_URL',
    '--schema',
    schema,
    '--release-id',
    'imeal-20260928-001',
    '--expected-database',
    'postgresql://admin:super-secret@db.example/imeal',
    '--output',
    outputPath,
  ];
  await assert.rejects(
    main(args, { TARGET_DATABASE_URL: databaseUrl }),
    /invalid expected database/i,
  );
  await assert.rejects(access(outputPath));
});

test('CLI fails closed for missing environment, invalid release and schema', async () => {
  const args = [
    '--database-url-env',
    'TARGET_DATABASE_URL',
    '--schema',
    schema,
    '--release-id',
    'imeal-20260928-001',
    '--expected-database',
    'imeal_staging',
    '--output',
    await makeOutputPath(),
  ];
  await assert.rejects(main(args, {}), /TARGET_DATABASE_URL/);
  await assert.rejects(
    main(
      args.map((value) =>
        value === 'imeal-20260928-001' ? 'bad/release' : value,
      ),
      { TARGET_DATABASE_URL: databaseUrl },
    ),
    /release/i,
  );
  await assert.rejects(
    main(
      args.map((value) => (value === schema ? 'bad schema' : value)),
      { TARGET_DATABASE_URL: databaseUrl },
    ),
    /schema/i,
  );
});

test('redacts credentialed values from target mismatch diagnostics', async () => {
  const outputPath = await makeOutputPath();
  const restore = installSpawn([
    {
      stdout: targetOutput({
        database: 'postgresql://attacker:super-secret@db.example/imeal',
      }),
    },
    { stdout: migrationsOutput },
  ]);
  try {
    let failure;
    try {
      await runPreflight({
        databaseUrl,
        schema,
        expectedTarget: target,
        releaseId: 'imeal-20260928-001',
        outputPath,
      });
    } catch (error) {
      failure = error;
    }
    assert.match(
      failure?.message ?? '',
      /target fingerprint mismatch.*database/i,
    );
    assert.doesNotMatch(failure?.message ?? '', /super-secret/i);
    assert.match(failure?.message ?? '', /<redacted>/i);
    await assert.rejects(access(outputPath));
  } finally {
    restore();
  }
});
