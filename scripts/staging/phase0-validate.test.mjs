import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  main,
  parseConstraintValidation,
  runValidation,
} from './phase0-validate.mjs';

const databaseUrl = 'postgresql://admin:password@db.example/imeal';
const schema = 'phase0_staging';
const target = { database: 'imeal_staging', schema };
const releaseId = 'imeal-20260928-001';
const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);

async function makeDirectory() {
  return mkdtemp(join(tmpdir(), 'phase0-validate-'));
}

function targetOutput({
  database = 'imeal_staging',
  schemaName = schema,
} = {}) {
  return `phase0-target:{"database":"${database}","schema":"${schemaName}","serverVersion":"PostgreSQL 16.4"}\n`;
}

const migrationsOutput = 'phase0-migrations:[]\n';
function commandBody(invocation) {
  const commandIndex = invocation.argv.indexOf('--command');
  assert.notEqual(commandIndex, -1);
  return invocation.argv[commandIndex + 1];
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

test('parses both named constraints and requires exact valid rows', async () => {
  const valid = await readFile(fixtureUrl('constraint-valid.txt'), 'utf8');
  assert.deepEqual(parseConstraintValidation(valid), [
    { name: 'registration_lifecycle_snapshot_complete', validated: true },
    { name: 'registration_serving_consistency', validated: true },
  ]);
  assert.equal(
    parseConstraintValidation(valid.replace(' | t', ' | f'))[0].validated,
    false,
  );
  assert.throws(
    () =>
      parseConstraintValidation(
        valid.replace(/registration_serving_consistency[^\r\n]*\r?\n/, ''),
      ),
    /constraint|rows|incomplete/i,
  );
});

test('rejects a missing evidence output path before spawning psql', async () => {
  const invocations = [];
  const restore = installSpawn([], invocations);
  try {
    await assert.rejects(
      runValidation({
        databaseUrl,
        schema,
        releaseId,
        preflightAfterOutputPath: 'unused-preflight.json',
        outputPath: '',
      }),
      /output path/i,
    );
    assert.equal(invocations.length, 0);
  } finally {
    restore();
  }
});

test('runs post-preflight and named constraint validation before evidence', async () => {
  const directory = await makeDirectory();
  const preflightAfterOutputPath = join(directory, 'preflight-after.json');
  const outputPath = join(directory, 'constraint-validation.json');
  const clean = await readFile(fixtureUrl('preflight-clean.txt'), 'utf8');
  const validConstraint = await readFile(
    fixtureUrl('constraint-valid.txt'),
    'utf8',
  );
  const invocations = [];
  const restore = installSpawn(
    [
      { stdout: targetOutput() },
      { stdout: migrationsOutput },
      { stdout: targetOutput() },
      { stdout: migrationsOutput },
      { stdout: clean },
      { stdout: targetOutput() },
      { stdout: migrationsOutput },
      { stdout: validConstraint },
    ],
    invocations,
  );
  try {
    const result = await runValidation({
      databaseUrl,
      schema,
      releaseId,
      preflightAfterOutputPath,
      outputPath,
    });
    assert.equal(result.result, 'PASS');
    assert.deepEqual(result.constraints, [
      { name: 'registration_lifecycle_snapshot_complete', validated: true },
      { name: 'registration_serving_consistency', validated: true },
    ]);
    assert.equal(
      JSON.parse(await readFile(preflightAfterOutputPath)).result,
      'PASS',
    );
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
    assert.equal(invocations.length, 8);
    assert.match(commandBody(invocations[0]), /phase0-target:/);
    assert.match(commandBody(invocations[1]), /phase0-migrations:/);
    assert.match(commandBody(invocations[2]), /phase0-target:/);
    assert.match(
      commandBody(invocations[4]),
      /future_active_snapshot_incomplete/,
    );
    assert.match(commandBody(invocations[5]), /phase0-target:/);
    assert.match(commandBody(invocations[6]), /phase0-migrations:/);
    assert.match(commandBody(invocations[7]), /VALIDATE CONSTRAINT/);
    assert.match(
      commandBody(invocations[7]),
      /registration_lifecycle_snapshot_complete/,
    );
    assert.equal(
      invocations[7].options.env.PGOPTIONS.includes(
        'default_transaction_read_only',
      ),
      false,
    );
  } finally {
    restore();
  }
});

test('rejects dirty post-preflight and invalid constraints without evidence', async () => {
  const directory = await makeDirectory();
  const preflightAfterOutputPath = join(directory, 'preflight-after.json');
  const dirty = await readFile(fixtureUrl('preflight-dirty.txt'), 'utf8');
  const dirtyOutput = join(directory, 'dirty-validation.json');
  const restore = installSpawn([
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: dirty },
  ]);
  try {
    await assert.rejects(
      runValidation({
        databaseUrl,
        schema,
        releaseId,
        preflightAfterOutputPath,
        outputPath: dirtyOutput,
      }),
      /future_active_snapshot_incomplete/i,
    );
    await assert.rejects(access(dirtyOutput));
    await assert.rejects(access(preflightAfterOutputPath));
  } finally {
    restore();
  }

  const invalidDirectory = await makeDirectory();
  const invalidPreflight = join(invalidDirectory, 'preflight-after.json');
  const invalidOutput = join(invalidDirectory, 'invalid-validation.json');
  const clean = await readFile(fixtureUrl('preflight-clean.txt'), 'utf8');
  const invalidConstraint = (
    await readFile(fixtureUrl('constraint-valid.txt'), 'utf8')
  ).replace(
    'registration_serving_consistency         | t',
    'registration_serving_consistency         | f',
  );
  const invalidRestore = installSpawn([
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: clean },
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: invalidConstraint },
  ]);
  try {
    await assert.rejects(
      runValidation({
        databaseUrl,
        schema,
        releaseId,
        preflightAfterOutputPath: invalidPreflight,
        outputPath: invalidOutput,
      }),
      /registration_serving_consistency/i,
    );
    await assert.rejects(access(invalidOutput));
  } finally {
    invalidRestore();
  }
});

test('validation CLI fails closed for missing environment and invalid release/schema', async () => {
  const directory = await makeDirectory();
  const args = [
    '--database-url-env',
    'TARGET_DATABASE_URL',
    '--schema',
    schema,
    '--release-id',
    releaseId,
    '--preflight-after-output',
    join(directory, 'preflight-after.json'),
    '--output',
    join(directory, 'constraint-validation.json'),
  ];
  await assert.rejects(main(args, {}), /TARGET_DATABASE_URL/);
  await assert.rejects(
    main(
      args.map((value) => (value === schema ? 'bad schema' : value)),
      { TARGET_DATABASE_URL: databaseUrl },
    ),
    /schema/i,
  );
  await assert.rejects(
    main(
      args.map((value) => (value === releaseId ? 'bad/release' : value)),
      { TARGET_DATABASE_URL: databaseUrl },
    ),
    /release/i,
  );
});
