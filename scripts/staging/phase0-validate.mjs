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
import {
  assertPreflightPass,
  fingerprintTarget,
  runPreflight,
} from './phase0-preflight.mjs';

const MIGRATION_SQL_PATH = fileURLToPath(
  new URL(
    '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/migration.sql',
    import.meta.url,
  ),
);
const STATEMENT_TIMEOUT_SECONDS = 30;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONSTRAINT_NAMES = [
  'registration_lifecycle_snapshot_complete',
  'registration_serving_consistency',
];

function assertReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid release id');
  }
  return value;
}

export function parseConstraintValidation(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('constraint output must be text');
  }
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) =>
    /^\s*conname\s*\|\s*convalidated\s*$/.test(line),
  );
  if (headerIndex === -1)
    throw new Error('missing constraint validation result');
  let endIndex = -1;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\(\s*2\s+rows?\s*\)\s*$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) throw new Error('missing two-constraint result count');
  const constraints = [];
  for (let index = headerIndex + 1; index < endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || /^-+\+/.test(line)) continue;
    const columns = lines[index].split('|');
    if (columns.length !== 2)
      throw new Error('invalid constraint validation row');
    const name = columns[0].trim();
    const value = columns[1].trim().toLowerCase();
    if (!CONSTRAINT_NAMES.includes(name)) {
      throw new Error(`unexpected constraint: ${name}`);
    }
    if (!['t', 'true', 'f', 'false'].includes(value)) {
      throw new Error(`invalid convalidated value for ${name}`);
    }
    constraints.push({ name, validated: value === 't' || value === 'true' });
  }
  if (constraints.length !== CONSTRAINT_NAMES.length) {
    throw new Error('constraint validation is incomplete');
  }
  const seen = new Set();
  for (const constraint of constraints) {
    if (seen.has(constraint.name)) {
      throw new Error(`duplicate constraint: ${constraint.name}`);
    }
    seen.add(constraint.name);
  }
  if (seen.size !== CONSTRAINT_NAMES.length) {
    throw new Error('constraint validation is incomplete');
  }
  return constraints;
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
    return { value: JSON.parse(raw), raw };
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

const VALIDATE_SQL = `BEGIN;
SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_SECONDS}s';
ALTER TABLE "registrations"

  VALIDATE CONSTRAINT "registration_lifecycle_snapshot_complete";
ALTER TABLE "registrations"
  VALIDATE CONSTRAINT "registration_serving_consistency";
SELECT conname, convalidated
FROM pg_constraint
JOIN pg_class AS relation ON relation.oid = pg_constraint.conrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = current_schema()
  AND conname IN (
    'registration_lifecycle_snapshot_complete',
    'registration_serving_consistency'
  )
ORDER BY conname;
COMMIT;`;

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

export async function runValidation({
  databaseUrl,
  schema,
  releaseId,
  preflightAfterOutputPath,
  outputPath,
}) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('output path is required');
  }
  const safeSchema = requireSafeSchemaName(schema);
  const safeReleaseId = assertReleaseId(releaseId);
  if (
    typeof preflightAfterOutputPath !== 'string' ||
    preflightAfterOutputPath.length === 0
  ) {
    throw new Error('post-preflight output path is required');
  }
  const initialFingerprint = await fingerprintTarget({
    databaseUrl,
    schema: safeSchema,
  });
  await runPreflight({
    databaseUrl,
    schema: safeSchema,
    expectedTarget: {
      database: initialFingerprint.database,
      schema: safeSchema,
    },
    releaseId: safeReleaseId,
    outputPath: preflightAfterOutputPath,
  });
  const { value: preflightAfter, raw: preflightAfterRaw } = await readJson(
    preflightAfterOutputPath,
    'post-preflight',
  );
  if (!preflightAfter || preflightAfter.result !== 'PASS') {
    throw new Error('post-preflight must be PASS before validation');
  }
  if (preflightAfter.releaseId !== safeReleaseId) {
    throw new Error('post-preflight release mismatch');
  }
  if (!preflightAfter.checks || !preflightAfter.statusCounts) {
    throw new Error('post-preflight report is incomplete');
  }
  assertPreflightPass({
    checks: preflightAfter.checks,
    statusCounts: preflightAfter.statusCounts,
  });
  const expectedTarget = preflightAfter.target;
  if (!expectedTarget || expectedTarget.schema !== safeSchema) {
    throw new Error('post-preflight target schema mismatch');
  }
  const targetFingerprint = await fingerprintTarget({
    databaseUrl,
    schema: safeSchema,
  });
  assertTargetFingerprint(targetFingerprint, expectedTarget);
  if (preflightAfter.targetFingerprint) {
    assertRecordedTargetFingerprint(
      targetFingerprint,
      preflightAfter.targetFingerprint,
    );
  }
  const migrationSql = await readFile(MIGRATION_SQL_PATH, 'utf8');
  for (const constraintName of CONSTRAINT_NAMES) {
    if (!migrationSql.includes(`"${constraintName}"`)) {
      throw new Error(
        `migration is missing named constraint: ${constraintName}`,
      );
    }
  }
  const migrationSha256 = sha256Text(migrationSql);
  const result = await runPsql({
    databaseUrl,
    schema: safeSchema,
    sql: VALIDATE_SQL,
    readOnly: false,
    statementTimeoutSeconds: STATEMENT_TIMEOUT_SECONDS,
  });
  assertSuccessfulPsql(result, 'constraint validation SQL');
  const constraints = parseConstraintValidation(result.stdout);
  for (const constraint of constraints) {
    if (!constraint.validated) {
      throw new Error(`constraint validation failed: ${constraint.name}`);
    }
  }
  const evidence = {
    releaseId: safeReleaseId,
    target: expectedTarget,
    targetFingerprint,
    preflightAfterSha256: sha256Text(preflightAfterRaw),
    migrationSha256,
    result: 'PASS',
    constraints,
  };
  await writeEvidence(outputPath, evidence);
  return evidence;
}

const CLI_SCHEMA = {
  'database-url-env': { type: 'string', required: true },
  schema: { type: 'string', required: true },
  'release-id': { type: 'string', required: true },
  'preflight-after-output': { type: 'string', required: true },
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
  return runValidation({
    databaseUrl,
    schema: options.schema,
    releaseId: options['release-id'],
    preflightAfterOutputPath: options['preflight-after-output'],
    outputPath: options.output,
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
