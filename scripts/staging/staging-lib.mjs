import childProcess from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { URL } from 'node:url';

const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_PATTERN = /(password|token|secret|apikey|otp)/i;
const POSTGRES_CREDENTIAL_PATTERN =
  /(?:postgres|postgresql):\/\/(?!<redacted>@)[^\/\s@]+@/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|token|api[_-]?key|otp(?:[_-]?code)?|provider[\s_-]?payload)\b(\s*=\s*)((?:"[^"]*"|'[^']*'|[^;\s]+))/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s]+/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-\n]*PRIVATE KEY-----/i;

function normalizeSchemaDefinition(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('argument schema must be an object');
  }
  const definitions = new Map();
  for (const [rawName, rawDefinition] of Object.entries(schema)) {
    const name = rawName.replace(/^--/, '');
    if (!name || definitions.has(name)) {
      throw new Error(`invalid argument schema option: ${rawName}`);
    }
    const definition =
      typeof rawDefinition === 'string'
        ? { type: rawDefinition }
        : rawDefinition;
    if (!definition || !['string', 'boolean'].includes(definition.type)) {
      throw new Error(`invalid argument type for --${name}`);
    }
    definitions.set(name, { ...definition });
  }
  return definitions;
}

export function parseArgs(argv, schema) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }
  const definitions = normalizeSchemaDefinition(schema);
  const result = {};
  const seen = new Set();

  for (const [name, definition] of definitions) {
    if (Object.hasOwn(definition, 'default')) {
      result[name] = definition.default;
    } else if (definition.type === 'boolean') {
      result[name] = false;
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      typeof argument !== 'string' ||
      !argument.startsWith('--') ||
      argument === '--'
    ) {
      throw new Error(`unexpected positional argument: ${String(argument)}`);
    }
    const equalsIndex = argument.indexOf('=');
    const rawName =
      equalsIndex === -1 ? argument.slice(2) : argument.slice(2, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const negated = rawName.startsWith('no-');
    const name = negated ? rawName.slice(3) : rawName;
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(`unknown argument: --${rawName}`);
    }
    if (seen.has(name)) {
      throw new Error(`duplicate argument: --${name}`);
    }

    if (definition.type === 'boolean') {
      if (inlineValue !== undefined) {
        throw new Error(`boolean argument --${name} does not accept a value`);
      }
      result[name] = !negated;
    } else {
      if (negated) {
        throw new Error(`string argument --${name} cannot be negated`);
      }
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`argument --${name} requires a value`);
      }
      result[name] = value;
      if (inlineValue === undefined) {
        index += 1;
      }
    }
    seen.add(name);
  }

  for (const [name, definition] of definitions) {
    if (
      definition.required &&
      !seen.has(name) &&
      !Object.hasOwn(definition, 'default')
    ) {
      throw new Error(`missing required argument: --${name}`);
    }
  }
  return result;
}

export function requireSafeSchemaName(value) {
  if (typeof value !== 'string' || !SCHEMA_PATTERN.test(value)) {
    throw new Error('invalid schema name');
  }
  return value;
}

export function redactDatabaseUrl(value) {
  if (typeof value !== 'string') {
    return String(value);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (!parsed.username && !parsed.password) {
    return value;
  }
  return `${parsed.protocol}//<redacted>@${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function isRedactedAssignmentValue(value) {
  return /^["']?<redacted>["']?$/i.test(value.trim());
}

function redactSensitiveAssignments(value) {
  SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = 0;
  return value.replace(
    SENSITIVE_ASSIGNMENT_PATTERN,
    (match, key, separator, assignmentValue) =>
      isRedactedAssignmentValue(assignmentValue)
        ? match
        : `${key}${separator}<redacted>`,
  );
}

function hasSensitiveAssignment(value) {
  SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match;
  while ((match = SENSITIVE_ASSIGNMENT_PATTERN.exec(value)) !== null) {
    if (!isRedactedAssignmentValue(match[3])) {
      return true;
    }
  }
  return false;
}

function safeDiagnostic(value, databaseUrl) {
  let diagnostic = String(value);
  if (typeof databaseUrl === 'string' && databaseUrl.length > 0) {
    diagnostic = diagnostic
      .split(databaseUrl)
      .join(redactDatabaseUrl(databaseUrl));
    try {
      const parsed = new URL(databaseUrl);
      const encodedCredentials = `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`;
      const decodedCredentials = decodeURIComponent(encodedCredentials);
      diagnostic = diagnostic.split(encodedCredentials).join('<redacted>@');
      diagnostic = diagnostic.split(decodedCredentials).join('<redacted>@');
    } catch {
      // The URL is passed to psql for validation; regex redaction below still applies.
    }
  }
  diagnostic = diagnostic.replace(POSTGRES_CREDENTIAL_PATTERN, (match) => {
    const protocol = match.slice(0, match.indexOf('://'));
    return `${protocol}://<redacted>@`;
  });
  return redactSensitiveAssignments(diagnostic);
}

function assertDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('database URL is required');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('invalid database URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('database URL must use postgres or postgresql');
  }
  return value;
}

function comparableValue(value) {
  if (value === undefined) return '<missing>';
  if (value === null) return '<null>';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function assertTargetFingerprint(actual, expected) {
  if (
    !actual ||
    typeof actual !== 'object' ||
    !expected ||
    typeof expected !== 'object'
  ) {
    throw new TypeError('target fingerprints must be objects');
  }
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `target fingerprint mismatch: ${key} expected=${comparableValue(expected[key])} actual=${comparableValue(actual[key])}`,
      );
    }
  }
}

export function sha256Text(value) {
  if (typeof value !== 'string') {
    throw new TypeError('sha256Text requires a string');
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function secretValue(value) {
  return (
    typeof value === 'string' &&
    (hasSensitiveAssignment(value) ||
      POSTGRES_CREDENTIAL_PATTERN.test(value) ||
      BEARER_PATTERN.test(value) ||
      PRIVATE_KEY_PATTERN.test(value))
  );
}

export function assertNoSecrets(value) {
  const visited = new WeakSet();
  const visit = (current, path) => {
    if (typeof current === 'string') {
      POSTGRES_CREDENTIAL_PATTERN.lastIndex = 0;
      BEARER_PATTERN.lastIndex = 0;
      if (secretValue(current)) {
        throw new Error(`secret-like value rejected at ${path}`);
      }
      return;
    }
    if (current === null || typeof current !== 'object') {
      return;
    }
    if (visited.has(current)) {
      throw new Error(`cyclic evidence value rejected at ${path}`);
    }
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new Error(`secret-like key rejected at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, '$');
}

export async function writeEvidence(filePath, payload) {
  assertNoSecrets(payload);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const parent = dirname(filePath);
  await mkdir(parent, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o440);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function runPsql(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('runPsql options are required');
  }
  const databaseUrl = assertDatabaseUrl(options.databaseUrl);
  const schema = requireSafeSchemaName(options.schema);
  if (typeof options.readOnly !== 'boolean') {
    throw new TypeError('runPsql readOnly must be boolean');
  }
  if (
    !Number.isInteger(options.statementTimeoutSeconds) ||
    options.statementTimeoutSeconds <= 0
  ) {
    throw new Error('statementTimeoutSeconds must be a positive integer');
  }
  const hasSql = typeof options.sql === 'string';
  const hasSqlFile = typeof options.sqlFile === 'string';
  if (hasSql === hasSqlFile) {
    throw new Error('runPsql requires exactly one of sql or sqlFile');
  }

  const args = [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--dbname',
    databaseUrl,
  ];
  if (options.readOnly) {
    args.push(
      '--command',
      [
        'BEGIN;',
        'SET TRANSACTION READ ONLY;',
        `SET LOCAL statement_timeout = '${options.statementTimeoutSeconds * 1000}ms';`,
        `SET LOCAL search_path TO ${schema}, pg_catalog;`,
      ].join('\n'),
    );
  }
  args.push(
    hasSql ? '--command' : '--file',
    hasSql ? options.sql : options.sqlFile,
  );
  if (options.readOnly) {
    args.push('--command', 'COMMIT;');
  }
  const redactedArgs = args.map((argument) =>
    safeDiagnostic(argument, databaseUrl),
  );
  const pgOptions = [
    `-c search_path=${schema},pg_catalog`,
    `-c statement_timeout=${options.statementTimeoutSeconds * 1000}`,
  ];
  if (options.readOnly) {
    pgOptions.push('-c default_transaction_read_only=on');
  }
  const environment = {
    ...process.env,
    PGOPTIONS: pgOptions.join(' '),
  };

  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        stdout: safeDiagnostic(stdout, databaseUrl),
        stderr: safeDiagnostic(stderr, databaseUrl),
        exitCode,
        argv: redactedArgs,
      });
    };
    try {
      child = childProcess.spawn('psql', args, {
        env: environment,
        shell: false,
      });
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        stderr += error instanceof Error ? error.message : String(error);
        finish(-1);
      });
      child.on('close', (code) => finish(typeof code === 'number' ? code : -1));
    } catch (error) {
      stderr += error instanceof Error ? error.message : String(error);
      finish(-1);
    }
  });
}
