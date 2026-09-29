import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  assertTargetFingerprint,
  parseArgs,
  requireSafeSchemaName,
  runPsql,
  sha256Text,
  writeEvidence,
} from './staging-lib.mjs';
import { assertPreflightPass, fingerprintTarget } from './phase0-preflight.mjs';

const PRE_FLIGHT_SQL_PATH = fileURLToPath(
  new URL(
    '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql',
    import.meta.url,
  ),
);
const BACKFILL_SQL_PATH = fileURLToPath(
  new URL(
    '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql',
    import.meta.url,
  ),
);
const STATEMENT_TIMEOUT_SECONDS = 30;
const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const DECISION = 'APPROVED_FOR_EXACT_BACKFILL';
const SCOPE = 'phase0_domain_correctness';

function assertReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid release id');
  }
  return value;
}

function assertDatabase(value, label = 'database') {
  if (typeof value !== 'string' || !DATABASE_PATTERN.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value.toLowerCase();
}

function assertTarget(target, label = 'target') {
  if (!target || typeof target !== 'object') {
    throw new Error(`${label} is required`);
  }
  return {
    database: assertDatabase(target.database, `${label} database`),
    schema: requireSafeSchemaName(target.schema),
  };
}

function parseRollbackWindow(value) {
  let startsAt;
  let expiresAt;
  if (typeof value === 'string') {
    const parts = value.split('/');
    if (parts.length !== 2) throw new Error('invalid rollback decision window');
    [startsAt, expiresAt] = parts;
  } else if (value && typeof value === 'object') {
    startsAt = value.startsAt ?? value.start;
    expiresAt = value.expiresAt ?? value.end;
  }
  const start = Date.parse(startsAt);
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('invalid rollback decision window');
  }
  return { start, end };
}

export function verifyApproval({
  approval,
  releaseId,
  target,
  preflightSha256,
  backupManifestSha256,
}) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new Error('approval is required');
  }
  const expectedReleaseId = assertReleaseId(releaseId);
  const expectedTarget = assertTarget(target);
  if (
    typeof approval.approvalId !== 'string' ||
    approval.approvalId.trim() === ''
  ) {
    throw new Error('approval id is required');
  }
  if (approval.releaseId !== expectedReleaseId) {
    throw new Error('approval release mismatch');
  }
  const approvalTarget = assertTarget(approval.target, 'approval target');
  if (
    approvalTarget.database !== expectedTarget.database ||
    approvalTarget.schema !== expectedTarget.schema
  ) {
    throw new Error('approval target mismatch');
  }
  if (approval.decision !== DECISION) {
    throw new Error(`approval decision must be ${DECISION}`);
  }
  if (approval.scope !== SCOPE) {
    throw new Error(`approval scope must be ${SCOPE}`);
  }
  const expectedPreflightHash = assertHash(preflightSha256, 'preflight hash');
  const expectedBackupHash = assertHash(
    backupManifestSha256,
    'backup manifest hash',
  );
  if (
    assertHash(approval.preflightSha256, 'approval preflight hash') !==
    expectedPreflightHash
  ) {
    throw new Error('approval preflight hash mismatch');
  }
  if (
    assertHash(
      approval.backupManifestSha256,
      'approval backup manifest hash',
    ) !== expectedBackupHash
  ) {
    throw new Error('approval backup manifest hash mismatch');
  }
  if (
    typeof approval.approver !== 'string' ||
    approval.approver.trim() === '' ||
    typeof approval.rollbackAuthority !== 'string' ||
    approval.rollbackAuthority.trim() === ''
  ) {
    throw new Error('approval approver and rollback authority are required');
  }
  if (approval.approver.trim() === approval.rollbackAuthority.trim()) {
    throw new Error('approval must be independently authorized');
  }
  if (!Number.isFinite(Date.parse(approval.approvedAt))) {
    throw new Error('approval approvedAt is invalid');
  }
  const window = parseRollbackWindow(approval.rollbackDecisionWindow);
  const now = Date.now();
  if (now < window.start) throw new Error('approval window is not active');
  if (now > window.end) throw new Error('approval is expired');
}

async function readJson(filePath, label) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error(`${label} path is required`);
  }
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is invalid JSON`);
  }
}

function assertSuccessfulPsql(result, label) {
  if (result.exitCode !== 0) {
    const detail = result.stderr?.trim() || 'no diagnostics';
    throw new Error(
      `${label} failed with exit code ${result.exitCode}: ${detail}`,
    );
  }
}

function assertRecordedTargetFingerprint(actual, expected) {
  if (!expected || typeof expected !== 'object') {
    throw new Error('target fingerprint is missing');
  }
  const { migrationRows, ...scalarFields } = expected;
  assertTargetFingerprint(actual, scalarFields);
  if (
    migrationRows !== undefined &&
    JSON.stringify(actual.migrationRows) !== JSON.stringify(migrationRows)
  ) {
    throw new Error('target fingerprint mismatch: migrationRows');
  }
}

export async function runBackfill({
  databaseUrl,
  schema,
  approvalPath,
  preflightPath,
  releaseId,
  outputPath,
  approvalId,
  backupManifestPath,
}) {
  const safeSchema = requireSafeSchemaName(schema);
  const safeReleaseId = assertReleaseId(releaseId);
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('output path is required');
  }
  const [approval, preflight] = await Promise.all([
    readJson(approvalPath, 'approval'),
    readJson(preflightPath, 'preflight'),
  ]);
  if (approvalId !== undefined && approval.approvalId !== approvalId) {
    throw new Error('approval id mismatch');
  }
  if (!preflight || preflight.result !== 'PASS') {
    throw new Error('preflight must be PASS before backfill');
  }
  if (preflight.releaseId !== safeReleaseId) {
    throw new Error('preflight release mismatch');
  }
  if (!preflight.checks || !preflight.statusCounts) {
    throw new Error('preflight report is incomplete');
  }
  assertPreflightPass({
    checks: preflight.checks,
    statusCounts: preflight.statusCounts,
  });
  const expectedTarget = assertTarget(preflight.target, 'preflight target');
  if (expectedTarget.schema !== safeSchema) {
    throw new Error('preflight target schema mismatch');
  }
  const preflightSql = await readFile(PRE_FLIGHT_SQL_PATH, 'utf8');
  const preflightSha256 = sha256Text(preflightSql);
  if (preflight.preflightSha256 !== preflightSha256) {
    throw new Error('preflight SQL hash mismatch');
  }
  const backupManifestSha256 = assertHash(
    approval.backupManifestSha256,
    'backup manifest hash',
  );
  if (backupManifestPath !== undefined) {
    const backupManifest = await readFile(backupManifestPath, 'utf8');
    if (sha256Text(backupManifest) !== backupManifestSha256) {
      throw new Error('backup manifest hash mismatch');
    }
  }
  verifyApproval({
    approval,
    releaseId: safeReleaseId,
    target: expectedTarget,
    preflightSha256,
    backupManifestSha256,
  });
  const targetFingerprint = await fingerprintTarget({
    databaseUrl,
    schema: safeSchema,
  });
  assertTargetFingerprint(targetFingerprint, expectedTarget);
  if (preflight.targetFingerprint) {
    assertRecordedTargetFingerprint(
      targetFingerprint,
      preflight.targetFingerprint,
    );
  }
  const backfillSql = await readFile(BACKFILL_SQL_PATH, 'utf8');
  const backfillSha256 = sha256Text(backfillSql);
  const startedAt = new Date().toISOString();
  const result = await runPsql({
    databaseUrl,
    schema: safeSchema,
    sql: backfillSql,
    readOnly: false,
    statementTimeoutSeconds: STATEMENT_TIMEOUT_SECONDS,
  });
  assertSuccessfulPsql(result, 'backfill SQL');
  const completedAt = new Date().toISOString();
  const evidence = {
    releaseId: safeReleaseId,
    approvalId: approval.approvalId,
    target: expectedTarget,
    preflightSha256,
    backupManifestSha256,
    backfillSha256,
    result: 'PASS',
    transaction: { startedAt, completedAt },
  };
  await writeEvidence(outputPath, evidence);
  return evidence;
}

const CLI_SCHEMA = {
  'database-url-env': { type: 'string', required: true },
  schema: { type: 'string', required: true },
  approval: { type: 'string', required: true },
  preflight: { type: 'string', required: false },
  input: { type: 'string', required: false },
  'approval-id': { type: 'string', required: false },
  'backup-manifest': { type: 'string', required: false },
  'release-id': { type: 'string', required: true },
  output: { type: 'string', required: true },
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
  const preflightPath = options.preflight ?? options.input;
  if (!preflightPath) throw new Error('preflight path is required');
  return runBackfill({
    databaseUrl,
    schema: options.schema,
    approvalPath: options.approval,
    preflightPath,
    releaseId: options['release-id'],
    outputPath: options.output,
    approvalId: options['approval-id'],
    backupManifestPath: options['backup-manifest'],
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((evidence) => {
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
