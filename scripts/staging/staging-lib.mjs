import childProcess from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { URL } from 'node:url';

const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_PATTERN = /(password|token|secret|apikey|otp)/i;
const SENSITIVE_JSON_KEY_PATTERN =
  /^(?:[A-Za-z0-9_-]*(?:password|token|secret)|[A-Za-z0-9_-]*api[_-]?key|otp(?:[_-]?code)?|provider[\s_-]?payload)$/i;
const POSTGRES_CREDENTIAL_PATTERN =
  /(?:postgres|postgresql):\/\/(?!<redacted>@)[^\/\s@]+@/gi;
const SENSITIVE_OBJECT_ASSIGNMENT_PATTERN =
  /\b(password|token|api[_-]?key|otp(?:[_-]?code)?|provider[\s_-]?payload)\b(\s*=\s*)(?=[{\[])/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|token|api[_-]?key|otp(?:[_-]?code)?|provider[\s_-]?payload)\b(\s*=\s*)((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^;\s]+))/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s]+/gi;
const TRANSACTION_SETTING_PATTERN =
  /\bSET\s+(?:(?:SESSION|LOCAL)\s+)?(?:CHARACTERISTICS\s+AS\s+)?TRANSACTION\b/i;
const TRANSACTION_READ_ONLY_SETTING_PATTERN =
  /\bSET\s+(?:(?:SESSION|LOCAL)\s+)?(?:default_)?transaction_read_only\b/i;
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
  let redacted = '';
  let cursor = 0;
  SENSITIVE_OBJECT_ASSIGNMENT_PATTERN.lastIndex = 0;
  let objectMatch;
  while (
    (objectMatch = SENSITIVE_OBJECT_ASSIGNMENT_PATTERN.exec(value)) !== null
  ) {
    const openingIndex = objectMatch.index + objectMatch[0].length;
    const parsedEnd = findJsonEnd(value, openingIndex);
    const semicolonIndex = value.indexOf(';', openingIndex);
    const end =
      parsedEnd === -1
        ? semicolonIndex === -1
          ? value.length
          : semicolonIndex + 1
        : parsedEnd;
    redacted +=
      value.slice(cursor, objectMatch.index) +
      `${objectMatch[1]}${objectMatch[2]}<redacted>`;
    cursor = end;
    SENSITIVE_OBJECT_ASSIGNMENT_PATTERN.lastIndex = end;
  }
  redacted += value.slice(cursor);

  SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = 0;
  return redacted.replace(
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
function isSensitiveJsonKey(key) {
  return SENSITIVE_JSON_KEY_PATTERN.test(key);
}

function redactParsedJson(value) {
  if (Array.isArray(value)) {
    let changed = false;
    const redacted = value.map((item) => {
      const result = redactParsedJson(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: redacted, changed };
  }
  if (!value || typeof value !== 'object') {
    return { value, changed: false };
  }
  let changed = false;
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveJsonKey(key)) {
      if (typeof child === 'string' && isRedactedAssignmentValue(child)) {
        redacted[key] = child;
      } else {
        redacted[key] = '<redacted>';
        changed = true;
      }
      continue;
    }
    const result = redactParsedJson(child);
    redacted[key] = result.value;
    changed ||= result.changed;
  }
  return { value: redacted, changed };
}

function findJsonEnd(value, start) {
  const stack = [value[start] === '{' ? '}' : ']'];
  let quote;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      stack.push('}');
    } else if (character === '[') {
      stack.push(']');
    } else if (character === '}' || character === ']') {
      if (stack.pop() !== character) {
        return -1;
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

function forEachJsonFragment(value, callback) {
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '{' && value[index] !== '[') {
      index += 1;
      continue;
    }
    const end = findJsonEnd(value, index);
    if (end === -1) {
      index += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(value.slice(index, end));
      callback(index, end, parsed);
      index = end;
    } catch {
      index += 1;
    }
  }
}

function redactJsonFragments(value) {
  let redacted = '';
  let cursor = 0;
  let changed = false;
  forEachJsonFragment(value, (start, end, parsed) => {
    const result = redactParsedJson(parsed);
    if (!result.changed) {
      return;
    }
    redacted += value.slice(cursor, start);
    redacted += JSON.stringify(result.value);
    cursor = end;
    changed = true;
  });
  return changed ? `${redacted}${value.slice(cursor)}` : value;
}

function parsedJsonHasSecrets(value) {
  if (Array.isArray(value)) {
    return value.some((item) => parsedJsonHasSecrets(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(([key, child]) => {
    if (
      isSensitiveJsonKey(key) &&
      !(typeof child === 'string' && isRedactedAssignmentValue(child))
    ) {
      return true;
    }
    return parsedJsonHasSecrets(child);
  });
}

function hasSensitiveJson(value) {
  let found = false;
  forEachJsonFragment(value, (_start, _end, parsed) => {
    if (parsedJsonHasSecrets(parsed)) {
      found = true;
    }
  });
  return found;
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
  diagnostic = redactJsonFragments(diagnostic);
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
  if (typeof value === 'string') return redactDatabaseUrl(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
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
      hasSensitiveJson(value) ||
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
      if (SECRET_KEY_PATTERN.test(key) || isSensitiveJsonKey(key)) {
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
function sqlDollarQuoteAt(value, index) {
  const match = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0];
}

function stripSqlComments(sql) {
  let output = '';
  let index = 0;
  let quote;
  let dollarQuote;
  while (index < sql.length) {
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        output += dollarQuote;
        index += dollarQuote.length;
        dollarQuote = undefined;
      } else {
        output += sql[index];
        index += 1;
      }
      continue;
    }
    if (quote) {
      const character = sql[index];
      output += character;
      index += 1;
      if (character === '\\' && index < sql.length) {
        output += sql[index];
        index += 1;
      } else if (character === quote) {
        if (sql[index] === quote) {
          output += sql[index];
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (sql.startsWith('--', index)) {
      output += '  ';
      index += 2;
      while (index < sql.length && sql[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1;
      output += '  ';
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          output += '  ';
          index += 2;
          depth += 1;
        } else if (sql.startsWith('*/', index)) {
          output += '  ';
          index += 2;
          depth -= 1;
        } else {
          output += sql[index] === '\n' ? '\n' : ' ';
          index += 1;
        }
      }
      continue;
    }
    const character = sql[index];
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    const delimiter =
      character === '$' ? sqlDollarQuoteAt(sql, index) : undefined;
    if (delimiter) {
      dollarQuote = delimiter;
      output += delimiter;
      index += delimiter.length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function maskSqlLiterals(sql) {
  let output = '';
  let index = 0;
  let quote;
  let dollarQuote;
  const mask = (character) => (character === '\n' ? '\n' : ' ');
  while (index < sql.length) {
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        output += dollarQuote;
        index += dollarQuote.length;
        dollarQuote = undefined;
      } else {
        output += mask(sql[index]);
        index += 1;
      }
      continue;
    }
    if (quote) {
      const character = sql[index];
      if (character === quote) {
        output += character;
        index += 1;
        if (sql[index] === quote) {
          output += sql[index];
          index += 1;
        } else {
          quote = undefined;
        }
      } else {
        output += mask(character);
        index += 1;
        if (character === '\\' && index < sql.length) {
          output += mask(sql[index]);
          index += 1;
        }
      }
      continue;
    }
    const character = sql[index];
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    const delimiter =
      character === '$' ? sqlDollarQuoteAt(sql, index) : undefined;
    if (delimiter) {
      dollarQuote = delimiter;
      output += delimiter;
      index += delimiter.length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function removeSafeReadOnlyStatement(body) {
  const visible = maskSqlLiterals(stripSqlComments(body));
  const safeStatement = /(^|[;\n])\s*SET\s+TRANSACTION\s+READ\s+ONLY\s*;/gi;
  let output = '';
  let cursor = 0;
  let match;
  while ((match = safeStatement.exec(visible)) !== null) {
    const setOffset = match[0].search(/\bSET\b/i);
    const statementStart = match.index + setOffset;
    const statementEnd = match.index + match[0].length;
    output += body.slice(cursor, statementStart);
    cursor = statementEnd;
  }
  return `${output}${body.slice(cursor)}`;
}

function normalizeReadOnlySql(sql) {
  const source = sql;
  const commentFree = stripSqlComments(source);
  const visible = maskSqlLiterals(commentFree);
  const leadingWhitespace = /^\s*/.exec(visible)[0].length;
  const beginStatement = /^BEGIN\s*;/i.exec(visible.slice(leadingWhitespace));
  let body = source;
  let hasOuterTransaction = false;
  if (beginStatement) {
    const beginStart = leadingWhitespace;
    const beginEnd = beginStart + beginStatement[0].length;
    const afterBegin = visible.slice(beginEnd);
    const commitSuffix = /\s*\bCOMMIT\b\s*;?\s*$/i.exec(afterBegin);
    if (commitSuffix) {
      const commitOffset = commitSuffix[0].search(/\bCOMMIT\b/i);
      const commitStart = beginEnd + commitSuffix.index + commitOffset;
      const commitSemicolon = visible.indexOf(';', commitStart);
      const commitEnd =
        commitSemicolon === -1
          ? commitStart + 'COMMIT'.length
          : commitSemicolon + 1;
      body =
        source.slice(0, beginStart) +
        source.slice(beginEnd, commitStart) +
        source.slice(commitEnd);
      hasOuterTransaction = true;
    }
  }
  const withoutSafeReadOnly = removeSafeReadOnlyStatement(body);
  const visibleWithoutSafe = maskSqlLiterals(
    stripSqlComments(withoutSafeReadOnly),
  );
  if (
    TRANSACTION_SETTING_PATTERN.test(visibleWithoutSafe) ||
    TRANSACTION_READ_ONLY_SETTING_PATTERN.test(visibleWithoutSafe) ||
    /\bREAD\s+WRITE\b/i.test(visibleWithoutSafe) ||
    /\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(visibleWithoutSafe)
  ) {
    throw new Error('read-only transaction control is not allowed');
  }
  return (hasOuterTransaction ? withoutSafeReadOnly : body).trim();
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
  if (
    options.lockTimeoutSeconds !== undefined &&
    (!Number.isInteger(options.lockTimeoutSeconds) ||
      options.lockTimeoutSeconds <= 0)
  ) {
    throw new Error('lockTimeoutSeconds must be a positive integer');
  }
  const hasSql = typeof options.sql === 'string';
  const hasSqlFile = typeof options.sqlFile === 'string';
  if (hasSql === hasSqlFile) {
    throw new Error('runPsql requires exactly one of sql or sqlFile');
  }

  let readOnlySql;
  if (options.readOnly) {
    const source = hasSql
      ? options.sql
      : await readFile(options.sqlFile, 'utf8');
    readOnlySql = normalizeReadOnlySql(source);
  }

  const args = [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--dbname',
    databaseUrl,
  ];
  if (options.readOnly) {
    const readOnlyPrelude = [
      'BEGIN;',
      'SET TRANSACTION READ ONLY;',
      `SET LOCAL statement_timeout = '${options.statementTimeoutSeconds * 1000}ms';`,
      `SET LOCAL search_path TO ${schema}, pg_catalog;`,
    ].join('\n');
    args.push(
      '--command',
      [readOnlyPrelude, readOnlySql, 'COMMIT;'].filter(Boolean).join('\n'),
    );
  } else {
    args.push(
      hasSql ? '--command' : '--file',
      hasSql ? options.sql : options.sqlFile,
    );
  }
  const redactedArgs = args.map((argument) =>
    safeDiagnostic(argument, databaseUrl),
  );
  const pgOptions = [
    `-c search_path=${schema},pg_catalog`,
    `-c statement_timeout=${options.statementTimeoutSeconds * 1000}`,
  ];
  if (options.lockTimeoutSeconds !== undefined) {
    pgOptions.push(`-c lock_timeout=${options.lockTimeoutSeconds * 1000}`);
  }
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
