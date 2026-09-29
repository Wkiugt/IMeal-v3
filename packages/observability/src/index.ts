import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRequestId(value: unknown): string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
    ? value
    : randomUUID();
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SafeLogFields = {
  service: 'api' | 'worker';
  release: string;
  event: string;
  requestId?: string;
  jobName?: string;
  jobRunId?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  providerCode?: string;
  [key: string]: string | number | boolean | undefined;
};

export interface StructuredLogger {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

const REDACTED = '[REDACTED]';

const SAFE_FIELD_KEYS: Record<string, true> = {
  requestId: true,
  jobName: true,
  jobRunId: true,
  statusCode: true,
  durationMs: true,
  errorCode: true,
  providerCode: true,
  method: true,
  route: true,
  status: true,
  count: true,
  total: true,
  attempt: true,
  retry: true,
};

function redactString(value: string): string {
  return value
    .replace(/(?:ExpoPushToken|ExponentPushToken)\[[^\]\r\n]*\]/g, REDACTED)
    .replace(/Bearer\s+[^\s,]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /(\b(?:api[-_ ]?key|access[-_ ]?token|authorization|password|secret|signature|token)\s*[:=]\s*)[^\s&#,;]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
      REDACTED,
    )
    .replace(/\b-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/g, REDACTED)
    .replace(/\b\d{6}\b/g, REDACTED);
}

function sanitizeField(key: string, value: unknown): string | number | boolean {
  if (SAFE_FIELD_KEYS[key] !== true) return REDACTED;

  if (typeof value === 'string') {
    return key === 'route'
      ? redactString(value).split('?')[0]
      : redactString(value);
  }

  if (typeof value === 'number')
    return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === 'boolean') return value;
  return REDACTED;
}

function sanitizeFields(
  fields: SafeLogFields | undefined,
): Record<string, string | number | boolean> {
  if (!fields) return {};

  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      key === 'service' ||
      key === 'release' ||
      key === 'event' ||
      value === undefined
    )
      continue;
    result[key] = sanitizeField(key, value);
  }
  return result;
}

export class JsonStructuredLogger implements StructuredLogger {
  private readonly sink: (line: string) => void;

  constructor(
    private readonly service: 'api' | 'worker',
    private readonly release: string,
    sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {
    this.sink = sink;
  }

  debug(event: string, fields?: SafeLogFields): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields?: SafeLogFields): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: SafeLogFields): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: SafeLogFields): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields?: SafeLogFields): void {
    const output = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      release: this.release,
      event: redactString(event),
      ...sanitizeFields(fields),
    };
    this.sink(JSON.stringify(output));
  }
}

export type MigrationEvidence = {
  release: string;
  migration: string;
  targetSchema: string;
  approvalId: string;
  completedAt: string;
};

const MIGRATION_EVIDENCE_KEYS = [
  'release',
  'migration',
  'targetSchema',
  'approvalId',
  'completedAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isMigrationEvidence(value: unknown): value is MigrationEvidence {
  if (!isRecord(value)) return false;

  const keys = Object.keys(value).sort();
  const expectedKeys = [...MIGRATION_EVIDENCE_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }

  return (
    isNonEmptyString(value.release) &&
    isNonEmptyString(value.migration) &&
    isNonEmptyString(value.targetSchema) &&
    isNonEmptyString(value.approvalId) &&
    isNonEmptyString(value.completedAt) &&
    isCanonicalTimestamp(value.completedAt)
  );
}

export function readMigrationEvidence(
  filePath: string,
  expectedRelease: string,
  expectedTargetSchema: string,
): { ok: true; evidence: MigrationEvidence } | { ok: false; reason: string } {
  if (
    !isNonEmptyString(expectedRelease) ||
    !isNonEmptyString(expectedTargetSchema)
  ) {
    return { ok: false, reason: 'expected_identity_missing' };
  }

  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return { ok: false, reason: 'marker_unavailable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return { ok: false, reason: 'marker_invalid' };
  }

  if (!isMigrationEvidence(parsed))
    return { ok: false, reason: 'marker_invalid' };
  if (parsed.release !== expectedRelease)
    return { ok: false, reason: 'release_mismatch' };
  if (parsed.targetSchema !== expectedTargetSchema)
    return { ok: false, reason: 'target_mismatch' };

  return { ok: true, evidence: parsed };
}
