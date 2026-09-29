import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parsePreflightOutput } from './phase0-preflight.mjs';
import { runBackfill, verifyApproval } from './phase0-backfill.mjs';
import { sha256Text } from './staging-lib.mjs';

const databaseUrl = 'postgresql://admin:password@db.example/imeal';
const schema = 'phase0_staging';
const target = { database: 'imeal_staging', schema };
const releaseId = 'imeal-20260928-001';
const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);

async function makeDirectory() {
  return mkdtemp(join(tmpdir(), 'phase0-backfill-'));
}

async function readPreflightSql() {
  return readFile(
    new URL(
      '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql',
      import.meta.url,
    ),
    'utf8',
  );
}

async function readBackfillSql() {
  return readFile(
    new URL(
      '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql',
      import.meta.url,
    ),
    'utf8',
  );
}

async function createPreflightFile(directory, overrides = {}) {
  const report = parsePreflightOutput(
    await readFile(fixtureUrl('preflight-clean.txt'), 'utf8'),
  );
  const preflight = {
    releaseId,
    target,
    preflightSha256: sha256Text(await readPreflightSql()),
    result: 'PASS',
    ...report,
    ...overrides,
  };
  const path = join(directory, 'preflight-before.json');
  await writeFile(path, `${JSON.stringify(preflight, null, 2)}\n`, 'utf8');
  return path;
}

async function createBackupManifest(
  directory,
  content = '{\"result\":\"PASS\"}\n',
) {
  const path = join(directory, 'backup-manifest.json');
  await writeFile(path, content, 'utf8');
  return { path, sha256: sha256Text(content) };
}

function approvalRecord(overrides = {}) {
  const now = Date.now();
  return {
    approvalId: 'approval-001',
    releaseId,
    target,
    preflightSha256: 'a'.repeat(64),
    backupManifestSha256: 'b'.repeat(64),
    decision: 'APPROVED_FOR_EXACT_BACKFILL',
    scope: 'phase0_domain_correctness',
    approvedAt: new Date(now - 60_000).toISOString(),
    approver: 'independent-data-owner',
    rollbackAuthority: 'operations-owner',
    rollbackDecisionWindow: `${new Date(now - 3_600_000).toISOString()}/${new Date(now + 3_600_000).toISOString()}`,
    ...overrides,
  };
}

function targetOutput({
  database = 'imeal_staging',
  schemaName = schema,
} = {}) {
  return `phase0-target:{"database":"${database}","schema":"${schemaName}","serverVersion":"PostgreSQL 16.4"}\n`;
}

const migrationsOutput = 'phase0-migrations:[]\n';

function installSpawn(responses, invocations = []) {
  const originalSpawn = childProcess.spawn;
  let responseIndex = 0;
  childProcess.spawn = (command, argv, options) => {
    const response = responses[responseIndex++];
    if (!response) throw new Error('unexpected psql invocation');
    invocations.push({ command, argv, options });
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

function backfillResponses(backfillStdout = 'BEGIN\nUPDATE 0\nCOMMIT\n') {
  return [
    { stdout: targetOutput() },
    { stdout: migrationsOutput },
    { stdout: backfillStdout },
  ];
}

test('accepts only an independent, current approval bound to release and target', () => {
  const approval = approvalRecord();
  assert.doesNotThrow(() =>
    verifyApproval({
      approval,
      releaseId,
      target,
      preflightSha256: approval.preflightSha256,
      backupManifestSha256: approval.backupManifestSha256,
    }),
  );
  for (const [field, value, message] of [
    ['approvalId', 'approvalToken', /approval id/i],
    ['approvalId', 'invalid/id', /approval id/i],
    ['decision', 'REJECTED', /decision/i],
    ['releaseId', 'imeal-20260928-002', /release/i],
    ['preflightSha256', 'c'.repeat(64), /preflight/i],
    ['backupManifestSha256', 'd'.repeat(64), /backup/i],
    ['approver', 'operations-owner', /independent/i],
    [
      'rollbackDecisionWindow',
      '2020-01-01T00:00:00Z/2020-01-02T00:00:00Z',
      /expired/i,
    ],
  ]) {
    assert.throws(
      () =>
        verifyApproval({
          approval: approvalRecord({ [field]: value }),
          releaseId,
          target,
          preflightSha256: approval.preflightSha256,
          backupManifestSha256: approval.backupManifestSha256,
        }),
      message,
    );
  }
});

test('refuses missing approval before spawning psql', async () => {
  const directory = await makeDirectory();
  const preflightPath = await createPreflightFile(directory);
  const backupManifest = await createBackupManifest(directory);
  const restore = installSpawn([]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath: join(directory, 'missing-approval.json'),
        preflightPath,
        releaseId,
        outputPath: join(directory, 'backfill-result.json'),
        backupManifestPath: backupManifest.path,
      }),
      /approval/i,
    );
  } finally {
    restore();
  }
});

test('requires a backup manifest and verifies its exact bytes before spawning psql', async () => {
  const directory = await makeDirectory();
  const preflightPath = await createPreflightFile(directory);
  const preflightSqlHash = sha256Text(await readPreflightSql());
  const approval = approvalRecord({ preflightSha256: preflightSqlHash });
  const approvalPath = join(directory, 'approval.json');
  await writeFile(
    approvalPath,
    `${JSON.stringify(approval, null, 2)}\n`,
    'utf8',
  );
  const outputPath = join(directory, 'backfill-result.json');
  let restore = installSpawn([]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath,
      }),
      /backup manifest path/i,
    );
    await assert.rejects(access(outputPath));
  } finally {
    restore();
  }

  const backupManifest = await createBackupManifest(directory);
  restore = installSpawn([]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath,
        backupManifestPath: backupManifest.path,
      }),
      /backup manifest hash mismatch/i,
    );
    await assert.rejects(access(outputPath));
  } finally {
    restore();
  }
});

test('rejects unsafe approval IDs before spawning psql', async () => {
  const directory = await makeDirectory();
  const preflightPath = await createPreflightFile(directory);
  const backupManifest = await createBackupManifest(directory);
  const preflightSqlHash = sha256Text(await readPreflightSql());
  const approvalPath = join(directory, 'approval.json');
  await writeFile(
    approvalPath,
    `${JSON.stringify(
      approvalRecord({
        approvalId: 'approvalToken',
        preflightSha256: preflightSqlHash,
        backupManifestSha256: backupManifest.sha256,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
  const invocations = [];
  const restore = installSpawn([], invocations);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath: join(directory, 'backfill-result.json'),
        backupManifestPath: backupManifest.path,
      }),
      /approval id/i,
    );
    assert.equal(invocations.length, 0);
  } finally {
    restore();
  }
});

test('refuses a dirty preflight before fingerprint or backfill', async () => {
  const directory = await makeDirectory();
  const dirty = parsePreflightOutput(
    await readFile(fixtureUrl('preflight-dirty.txt'), 'utf8'),
  );
  const preflightPath = await createPreflightFile(directory, dirty);
  const preflightSqlHash = sha256Text(await readPreflightSql());
  const backupManifest = await createBackupManifest(directory);
  const approval = approvalRecord({
    preflightSha256: preflightSqlHash,
    backupManifestSha256: backupManifest.sha256,
  });
  const approvalPath = join(directory, 'approval.json');
  await writeFile(
    approvalPath,
    `${JSON.stringify(approval, null, 2)}\n`,
    'utf8',
  );
  const outputPath = join(directory, 'backfill-result.json');
  const restore = installSpawn([]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath,
        backupManifestPath: backupManifest.path,
      }),
      /future_active_snapshot_incomplete/i,
    );
    await assert.rejects(access(outputPath));
  } finally {
    restore();
  }
});
test('runs exact read-write backfill only after fingerprint and approval, and is repeatable', async () => {
  const directory = await makeDirectory();
  const preflightSqlHash = sha256Text(await readPreflightSql());
  const preflightPath = await createPreflightFile(directory);
  const backupManifest = await createBackupManifest(directory);
  const approval = approvalRecord({
    preflightSha256: preflightSqlHash,
    backupManifestSha256: backupManifest.sha256,
  });
  const approvalPath = join(directory, 'approval.json');
  await writeFile(
    approvalPath,
    `${JSON.stringify(approval, null, 2)}\n`,
    'utf8',
  );
  const outputPath = join(directory, 'backfill-result.json');
  const secondOutputPath = join(directory, 'backfill-result-second.json');
  const invocations = [];
  const restore = installSpawn(
    [...backfillResponses(), ...backfillResponses()],
    invocations,
  );
  try {
    const first = await runBackfill({
      databaseUrl,
      schema,
      approvalPath,
      preflightPath,
      releaseId,
      outputPath,
      backupManifestPath: backupManifest.path,
    });
    const second = await runBackfill({
      databaseUrl,
      schema,
      approvalPath,
      preflightPath,
      releaseId,
      outputPath: secondOutputPath,
      backupManifestPath: backupManifest.path,
    });
    assert.equal(first.result, 'PASS');
    assert.equal(second.result, 'PASS');
    assert.equal(first.approvalId, approval.approvalId);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), first);
    assert.equal(invocations.length, 6);
    assert.match(invocations[0].argv[5], /phase0-target:/);
    assert.match(invocations[1].argv[5], /phase0-migrations:/);
    assert.match(invocations[2].argv[5], /UPDATE registrations/);
    assert.equal(invocations[2].argv.includes('--file'), false);
    assert.equal(
      invocations[2].options.env.PGOPTIONS.includes(
        'default_transaction_read_only',
      ),
      false,
    );
    assert.match(invocations[2].options.env.PGOPTIONS, /lock_timeout=5000/);
    assert.match(invocations[3].argv[5], /phase0-target:/);
    assert.match(invocations[4].argv[5], /phase0-migrations:/);
    assert.equal(invocations[5].argv[5], invocations[2].argv[5]);
    assert.equal(invocations[2].argv[5], await readBackfillSql());
    assert.match(invocations[2].argv[5], /DO \$menu_backfill\$/);
  } finally {
    restore();
  }
});

test('fails closed without evidence on target mismatch or failed backfill SQL', async () => {
  const directory = await makeDirectory();
  const preflightSqlHash = sha256Text(await readPreflightSql());
  const preflightPath = await createPreflightFile(directory);
  const backupManifest = await createBackupManifest(directory);
  const approval = approvalRecord({
    preflightSha256: preflightSqlHash,
    backupManifestSha256: backupManifest.sha256,
  });
  const approvalPath = join(directory, 'approval.json');
  await writeFile(
    approvalPath,
    `${JSON.stringify(approval, null, 2)}\n`,
    'utf8',
  );
  const mismatchOutput = join(directory, 'mismatch.json');
  let restore = installSpawn([
    { stdout: targetOutput({ database: 'wrong_database' }) },
    { stdout: migrationsOutput },
  ]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath: mismatchOutput,
        backupManifestPath: backupManifest.path,
      }),
      /target fingerprint mismatch/i,
    );
    await assert.rejects(access(mismatchOutput));
  } finally {
    restore();
  }

  const failedOutput = join(directory, 'failed.json');
  restore = installSpawn([
    ...backfillResponses('backfill failed\n').slice(0, 2),
    { stderr: 'deadlock detected\n', exitCode: 40 },
  ]);
  try {
    await assert.rejects(
      runBackfill({
        databaseUrl,
        schema,
        approvalPath,
        preflightPath,
        releaseId,
        outputPath: failedOutput,
        backupManifestPath: backupManifest.path,
      }),
      /backfill SQL failed.*40/i,
    );
    await assert.rejects(access(failedOutput));
  } finally {
    restore();
  }
});

test('backfill CLI fails closed for missing environment, invalid schema and release', async () => {
  const directory = await makeDirectory();
  const args = [
    '--database-url-env',
    'TARGET_DATABASE_URL',
    '--schema',
    schema,
    '--approval',
    join(directory, 'approval.json'),
    '--preflight',
    join(directory, 'preflight.json'),
    '--backup-manifest',
    join(directory, 'backup-manifest.json'),
    '--release-id',
    releaseId,
    '--output',
    join(directory, 'backfill.json'),
  ];
  const { main } = await import('./phase0-backfill.mjs');
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
