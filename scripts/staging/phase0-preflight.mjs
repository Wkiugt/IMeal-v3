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

const PRE_FLIGHT_SQL_PATH = fileURLToPath(
  new URL(
    '../../packages/domain/prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql',
    import.meta.url,
  ),
);
const STATEMENT_TIMEOUT_SECONDS = 30;
// Controlled staging databases use the same simple identifier contract as schemas.
const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TARGET_MARKER = 'phase0-target:';
const MIGRATIONS_MARKER = 'phase0-migrations:';
const CHECK_NAMES = [
  'registration_snapshot_incomplete',
  'registration_serving_mismatch',
  'roster_assignment_ambiguous',
  'menu_revision_incomplete',
  'penalty_registration_mapping_ambiguous',
  'penalty_registration_duplicate_candidate',
  'future_active_snapshot_incomplete',
];
const STATUS_NAMES = ['ACTIVE', 'CANCELLED', 'SERVED', 'NO_SHOW'];

function assertReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid release id');
  }
  return value;
}

function assertExpectedDatabase(value) {
  if (typeof value !== 'string' || !DATABASE_PATTERN.test(value)) {
    throw new Error(
      'invalid expected database: must match /^[A-Za-z_][A-Za-z0-9_]*$/',
    );
  }
  return value;
}

function parseInteger(value, label) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function parsePostgresTextArray(value) {
  const source = value.trim();
  if (!source.startsWith('{') || !source.endsWith('}')) {
    throw new Error('invalid sample_ids array');
  }
  const contents = source.slice(1, -1);
  if (contents.length === 0) return [];
  const values = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of contents) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (quoted || escaped) {
    throw new Error('invalid sample_ids array');
  }
  values.push(current.trim());
  if (values.some((value) => value.length === 0) || values.length > 20) {
    throw new Error('invalid sample_ids array');
  }
  return values;
}

function findMarkerValue(raw, marker) {
  if (typeof raw !== 'string') {
    throw new TypeError('psql output must be text');
  }
  const line = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith(marker));
  if (!line) throw new Error(`missing ${marker} result`);
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    throw new Error(`invalid ${marker} result`);
  }
}

function parseCheckRows(lines, headerIndex) {
  const rows = [];
  const expectedEnd = headerIndex + 1;
  let endIndex = -1;
  for (let index = expectedEnd; index < lines.length; index += 1) {
    if (/^\s*\(\s*7\s+rows?\s*\)\s*$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) throw new Error('missing seven-check result count');
  for (let index = headerIndex + 1; index < endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || /^-+\+/.test(line)) continue;
    const columns = lines[index].split('|');
    if (columns.length < 3) throw new Error('invalid preflight check row');
    const name = columns.shift().trim();
    const affectedCount = parseInteger(
      columns.shift().trim(),
      'affected_count',
    );
    const sampleIds = parsePostgresTextArray(columns.join('|').trim());
    rows.push({ name, affectedCount, sampleIds });
  }
  if (rows.length !== CHECK_NAMES.length) {
    throw new Error('preflight checks must contain exactly seven rows');
  }
  const seen = new Set();
  for (const row of rows) {
    if (!CHECK_NAMES.includes(row.name) || seen.has(row.name)) {
      throw new Error(`unexpected or duplicate preflight check: ${row.name}`);
    }
    seen.add(row.name);
  }
  if (seen.size !== CHECK_NAMES.length) {
    throw new Error('preflight checks are incomplete');
  }
  return { rows, endIndex };
}

function parseStatusRows(lines, afterIndex) {
  const headerIndex = lines.findIndex(
    (line, index) =>
      index > afterIndex &&
      /^\s*registration_status\s*\|\s*row_count\s*$/.test(line),
  );
  if (headerIndex === -1) throw new Error('missing registration status result');
  let endIndex = -1;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\(\s*4\s+rows?\s*\)\s*$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) throw new Error('missing four-status result count');
  const rows = [];
  for (let index = headerIndex + 1; index < endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || /^-+\+/.test(line)) continue;
    const columns = lines[index].split('|');
    if (columns.length !== 2)
      throw new Error('invalid registration status row');
    rows.push({
      status: columns[0].trim(),
      count: parseInteger(columns[1].trim(), 'row_count'),
    });
  }
  if (rows.length !== STATUS_NAMES.length) {
    throw new Error('registration statuses must contain exactly four rows');
  }
  const seen = new Set();
  for (const row of rows) {
    if (!STATUS_NAMES.includes(row.status) || seen.has(row.status)) {
      throw new Error(
        `unexpected or duplicate registration status: ${row.status}`,
      );
    }
    seen.add(row.status);
  }
  if (seen.size !== STATUS_NAMES.length) {
    throw new Error('registration statuses are incomplete');
  }
  return rows;
}

export function parsePreflightOutput(raw) {
  if (typeof raw !== 'string')
    throw new TypeError('preflight output must be text');
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) =>
    /^\s*check_name\s*\|\s*affected_count\s*\|\s*sample_ids\s*$/.test(line),
  );
  if (headerIndex === -1) throw new Error('missing preflight checks');
  const { rows: checks, endIndex } = parseCheckRows(lines, headerIndex);
  const statusCounts = parseStatusRows(lines, endIndex);
  return { checks, statusCounts };
}

export function assertPreflightPass(report) {
  if (
    !report ||
    !Array.isArray(report.checks) ||
    !Array.isArray(report.statusCounts)
  ) {
    throw new TypeError('preflight report is invalid');
  }
  const seenChecks = new Set();
  for (const check of report.checks) {
    if (
      !check ||
      typeof check.name !== 'string' ||
      !CHECK_NAMES.includes(check.name) ||
      seenChecks.has(check.name) ||
      !Number.isSafeInteger(check.affectedCount) ||
      check.affectedCount < 0 ||
      !Array.isArray(check.sampleIds)
    ) {
      throw new Error('preflight report checks are invalid');
    }
    seenChecks.add(check.name);
    if (check.affectedCount !== 0) {
      throw new Error(
        `preflight check failed: ${check.name} affected_count=${check.affectedCount}`,
      );
    }
  }
  if (seenChecks.size !== CHECK_NAMES.length) {
    throw new Error('preflight report checks are incomplete');
  }
  const seenStatuses = new Set();
  for (const status of report.statusCounts) {
    if (
      !status ||
      typeof status.status !== 'string' ||
      !STATUS_NAMES.includes(status.status) ||
      seenStatuses.has(status.status) ||
      !Number.isSafeInteger(status.count) ||
      status.count < 0
    ) {
      throw new Error('preflight report status counts are invalid');
    }
    seenStatuses.add(status.status);
  }
  if (seenStatuses.size !== STATUS_NAMES.length) {
    throw new Error('preflight report status counts are incomplete');
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

function parseTargetResult(raw) {
  const value = findMarkerValue(raw, TARGET_MARKER);
  if (
    !value ||
    typeof value.database !== 'string' ||
    typeof value.schema !== 'string' ||
    typeof value.serverVersion !== 'string' ||
    value.database.length === 0 ||
    value.schema.length === 0 ||
    value.serverVersion.length === 0
  ) {
    throw new Error('invalid target fingerprint');
  }
  return value;
}

function parseMigrationResult(raw) {
  const value = findMarkerValue(raw, MIGRATIONS_MARKER);
  if (!Array.isArray(value)) throw new Error('invalid migration rows');
  return value.map((row) => {
    if (
      !row ||
      typeof row.migration_name !== 'string' ||
      row.migration_name.length === 0 ||
      (row.finished_at !== null && typeof row.finished_at !== 'string') ||
      (row.rolled_back_at !== null && typeof row.rolled_back_at !== 'string') ||
      !Number.isSafeInteger(Number(row.applied_steps_count)) ||
      Number(row.applied_steps_count) < 0
    ) {
      throw new Error('invalid migration row');
    }
    return JSON.stringify({
      migration_name: row.migration_name,
      finished_at: row.finished_at,
      rolled_back_at: row.rolled_back_at,
      applied_steps_count: Number(row.applied_steps_count),
    });
  });
}

export async function fingerprintTarget({
  databaseUrl,
  schema,
  commandRunner,
}) {
  const safeSchema = requireSafeSchemaName(schema);
  const options = {
    databaseUrl,
    schema: safeSchema,
    readOnly: true,
    statementTimeoutSeconds: STATEMENT_TIMEOUT_SECONDS,
    commandRunner,
  };
  const targetResult = await runPsql({
    ...options,
    sql: `SELECT 'phase0-target:' || json_build_object(
      'database', current_database(),
      'schema', current_schema(),
      'serverVersion', version()
    )::text;`,
  });
  assertSuccessfulPsql(targetResult, 'target fingerprint query');
  const target = parseTargetResult(targetResult.stdout);
  if (target.schema !== safeSchema) {
    throw new Error(
      `target schema assertion failed: expected=${safeSchema} actual=${target.schema}`,
    );
  }
  const migrationResult = await runPsql({
    ...options,
    sql: `SELECT 'phase0-migrations:' || COALESCE(
      json_agg(
        json_build_object(
          'migration_name', migration_name,
          'finished_at', finished_at,
          'rolled_back_at', rolled_back_at,
          'applied_steps_count', applied_steps_count
        ) ORDER BY started_at, migration_name
      )::text,
      '[]'
    ) FROM _prisma_migrations;`,
  });
  assertSuccessfulPsql(migrationResult, 'migration fingerprint query');
  return {
    ...target,
    migrationRows: parseMigrationResult(migrationResult.stdout),
  };
}

export async function runPreflight({
  databaseUrl,
  schema,
  expectedTarget,
  releaseId,
  outputPath,
}) {
  const safeSchema = requireSafeSchemaName(schema);
  const safeReleaseId = assertReleaseId(releaseId);
  if (!expectedTarget || typeof expectedTarget !== 'object') {
    throw new TypeError('expected target is required');
  }
  const expectedDatabase = assertExpectedDatabase(expectedTarget.database);
  const expectedSchema = requireSafeSchemaName(expectedTarget.schema);
  if (expectedSchema !== safeSchema) {
    throw new Error(
      `target schema mismatch: expected=${expectedSchema} actual=${safeSchema}`,
    );
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('output path is required');
  }
  const preflightSql = await readFile(PRE_FLIGHT_SQL_PATH, 'utf8');
  const preflightSha256 = sha256Text(preflightSql);
  const targetFingerprint = await fingerprintTarget({
    databaseUrl,
    schema: safeSchema,
  });
  assertTargetFingerprint(targetFingerprint, {
    database: expectedDatabase,
    schema: expectedSchema,
  });
  const preflightResult = await runPsql({
    databaseUrl,
    schema: safeSchema,
    sql: preflightSql,
    readOnly: true,
    statementTimeoutSeconds: STATEMENT_TIMEOUT_SECONDS,
  });
  assertSuccessfulPsql(preflightResult, 'preflight SQL');
  const report = parsePreflightOutput(preflightResult.stdout);
  assertPreflightPass(report);
  const evidence = {
    releaseId: safeReleaseId,
    target: {
      database: targetFingerprint.database,
      schema: targetFingerprint.schema,
    },
    targetFingerprint,
    preflightSha256,
    result: 'PASS',
    checks: report.checks,
    statusCounts: report.statusCounts,
  };
  await writeEvidence(outputPath, evidence);
  return evidence;
}

const CLI_SCHEMA = {
  'database-url-env': { type: 'string', required: true },
  schema: { type: 'string', required: true },
  'release-id': { type: 'string', required: true },
  'expected-database': { type: 'string', required: true },
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
  return runPreflight({
    databaseUrl,
    schema: options.schema,
    expectedTarget: {
      database: options['expected-database'],
      schema: options.schema,
    },
    releaseId: options['release-id'],
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
