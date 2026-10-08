import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

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
  errorClass?: string;
  providerCode?: string;
  provider?: string;
  method?: string;
  path?: string;
  route?: string;
  message?: string;
  stack?: string;
  context?: string;
  host?: string;
  port?: number;
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
  errorClass: true,
  providerCode: true,
  provider: true,
  method: true,
  path: true,
  route: true,
  status: true,
  count: true,
  total: true,
  attempt: true,
  retry: true,
  message: true,
  stack: true,
  context: true,
  host: true,
  port: true,
};

const DOTTED_AUTHORIZATION_LABEL_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:[A-Za-z_$][A-Za-z0-9_$-]*\.)+authorization["']?\s*[:=](?!\/\/)\s*)(["'])(?:\\.|(?!\2)[\s\S])*\2/gi;
const DOTTED_AUTHORIZATION_UNQUOTED_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:[A-Za-z_$][A-Za-z0-9_$-]*\.)+authorization["']?\s*[:=](?!\/\/)\s*)(?:Bearer\s+)?[^\s"'`&#,;}\])]+/gi;
const SET_COOKIE_HEADER_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?set-cookie["']?\s*:\s*)[^\r\n]*?(?=\r?\n|\s+["']?set-cookie["']?\s*:|$)/gi;

const SENSITIVE_LABEL_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:authorization|bearer|cookie|otp(?:[-_\s]*(?:code|token|password))?|session(?:[-_\s]*(?:token|id))?|refresh[-_\s]*token|client(?:[-_ ]|\s)*secret|provider(?:[-_ ]|\s)*(?:secret|api[-_ ]?key)|api[-_ ]?key|access[-_\s]*token|smtp(?:[-_\s]*(?:user(?:name)?|password|credential|secret))?|password|secret|signature|sig|qr(?:[-_\s]*(?:payload|token|code))?)["']?\s*[:=](?!\/\/)\s*)(["'])(?:\\.|(?!\2)[\s\S])*\2/gi;
const SENSITIVE_UNQUOTED_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:authorization|bearer|cookie|otp(?:[-_\s]*(?:code|token|password))?|session(?:[-_\s]*(?:token|id))?|refresh[-_\s]*token|client(?:[-_ ]|\s)*secret|provider(?:[-_ ]|\s)*(?:secret|api[-_ ]?key)|api[-_ ]?key|access[-_\s]*token|smtp(?:[-_\s]*(?:user(?:name)?|password|credential|secret))?|password|secret|signature|sig|qr(?:[-_\s]*(?:payload|token|code))?)["']?\s*[:=](?!\/\/)\s*)[^\s"'`&#,;}\])]+/gi;
const SENSITIVE_QUERY_PARAMETER_PATTERN =
  /([?&;](?:token|auth(?:entication|orization)?(?:[-_ ]?(?:token|code|key))?|session(?:[-_ ]?(?:token|id))?|access(?:[-_ ]?token)?|refresh(?:[-_ ]?token)?|otp(?:[-_ ]?(?:code|token|password))?|credential(?:s)?(?:[-_ ]?(?:token|id|key))?|password|secret|cookie|api[-_ ]?key|client[-_ ]?secret|provider[-_ ]?secret)=)[^&#\s"'`;]*/gi;
const PAYLOAD_CONTAINER_PREFIX_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:body|request(?:[-_ ]?body)?|response|headers|title|data|to|payload|message)["']?\s*[:=]\s*)([{\[])/gi;
const PAYLOAD_LABEL_PATTERN =
  /((?:^|[\s,{}(]|\[)["']?(?:body|request(?:[-_ ]?body)?|response|headers|title|data|to|payload|message)["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[\s\S])*\2/gi;
const PAYLOAD_UNQUOTED_PATTERN =
  /((?:^|[\s,{}(]|\[)["']?(?:body|request(?:[-_ ]?body)?|response|headers|title|data|to|payload|message)["']?\s*[:=]\s*)[^\s"'`&#,;}\])]+/gi;
const OTP_LABEL_PATTERN =

  /(\b(?:otp|one[- ]time|verification|auth(?:entication)?)(?:\s+(?:code|password))?(?:(?:\s*[:=]\s*)|\s+))(\d{6})\b/gi;
const STRUCTURED_PAYLOAD_MAX_LENGTH = 8192;

function redactStructuredPayloads(value: string): string {
  let result = '';
  let cursor = 0;
  PAYLOAD_CONTAINER_PREFIX_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAYLOAD_CONTAINER_PREFIX_PATTERN.exec(value)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    if (openIndex < cursor) continue;

    const limit = Math.min(
      value.length,
      openIndex + STRUCTURED_PAYLOAD_MAX_LENGTH,
    );
    const closers: string[] = [];
    let quote: '"' | "'" | undefined;
    let escaped = false;
    let end = -1;
    for (let index = openIndex; index < limit; index += 1) {
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
        closers.push('}');
      } else if (character === '[') {
        closers.push(']');
      } else if (character === closers[closers.length - 1]) {
        closers.pop();
        if (closers.length === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) end = value.length;
    result += value.slice(cursor, openIndex) + REDACTED;
    cursor = Math.min(value.length, end + 1);
  }
  PAYLOAD_CONTAINER_PREFIX_PATTERN.lastIndex = 0;
  return result + value.slice(cursor);
}

function redactPayloadLabels(value: string): string {
  return redactStructuredPayloads(value)
    .replace(
      PAYLOAD_LABEL_PATTERN,
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${REDACTED}${quote}`,
    )
    .replace(PAYLOAD_UNQUOTED_PATTERN, `$1${REDACTED}`);
}

function redactString(
  value: string,
  context: 'event' | 'field',
  key?: string,
): string {
  let redacted = value
    .replace(/\bimeal:v2:[^\s"'`]+/gi, REDACTED)
    .replace(/(?:ExpoPushToken|ExponentPushToken)\[[^\]\r\n]*\]/g, REDACTED)
    .replace(
      DOTTED_AUTHORIZATION_LABEL_PATTERN,
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${REDACTED}${quote}`,
    )
    .replace(DOTTED_AUTHORIZATION_UNQUOTED_PATTERN, `$1${REDACTED}`)
    .replace(SET_COOKIE_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(/\bBearer\s+[^\s,]+/gi, `Bearer ${REDACTED}`)
    .replace(
      SENSITIVE_LABEL_PATTERN,
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${REDACTED}${quote}`,
    )
    .replace(SENSITIVE_UNQUOTED_PATTERN, `$1${REDACTED}`)
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
      REDACTED,
    )
    .replace(/\bhttps?:\/\/[^/\s:@]+:[^@\s]+@/gi, 'https://[REDACTED]@')
    .replace(SENSITIVE_QUERY_PARAMETER_PATTERN, `$1${REDACTED}`)
    .replace(
      /(\b(?:lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*)-?\d+(?:\.\d+)?/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/g, REDACTED)
    .replace(OTP_LABEL_PATTERN, `$1${REDACTED}`);

  if (context === 'event' || key === 'providerCode' || key === 'message') {
    redacted = redactPayloadLabels(redacted);
  }
  redacted = redacted.replace(
    STRUCTURED_PAYLOAD_PATTERN,
    `$1${REDACTED}`,
  );

  return redacted;
}

const MESSAGE_MAX_LENGTH = 1024;
const STACK_MAX_LENGTH = 4096;
const CONTEXT_TOKEN = /^[A-Za-z][A-Za-z0-9_$.-]{0,63}$/;

export function sanitizeLogText(
  value: unknown,
  maxLength = MESSAGE_MAX_LENGTH,
): string {
  if (typeof value !== 'string') return REDACTED;
  return redactString(value, 'field', 'message').slice(0, maxLength);
}

function isCredentialFreeBindHost(value: string): boolean {
  if (
    value.includes('@') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    /\s/.test(value)
  ) {
    return false;
  }
  return value === '0.0.0.0';
}


function sanitizeContext(value: unknown): string {
  if (typeof value === 'string' && CONTEXT_TOKEN.test(value)) return value;
  return REDACTED;
}

function sanitizeHost(value: unknown): string {
  if (typeof value === 'string' && isCredentialFreeBindHost(value)) {
    return value;
  }
  return REDACTED;
}

function sanitizePort(value: unknown): number | string {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 65535
  ) {
    return value;
  }
  return REDACTED;
}

function sanitizeField(
  key: string,
  value: unknown,
): string | number | boolean | undefined {
  if (SAFE_FIELD_KEYS[key] !== true) return undefined;
  if (key === 'message') return sanitizeLogText(value, MESSAGE_MAX_LENGTH);
  if (key === 'stack') return sanitizeLogText(value, STACK_MAX_LENGTH);
  if (key === 'context') return sanitizeContext(value);
  if (key === 'host') return sanitizeHost(value);
  if (key === 'port') return sanitizePort(value);

  if (typeof value === 'string') {
    if (key === 'requestId' && !REQUEST_ID_PATTERN.test(value)) {
      return REDACTED;
    }
    if (key === 'provider' && !/^[a-z0-9-]{1,32}$/.test(value)) {
      return REDACTED;
    }
    const redacted = redactString(value, 'field', key);
    return key === 'route' || key === 'path' ? redacted.split('?')[0] : redacted;
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

    const sanitized = sanitizeField(key, value);
    if (sanitized !== undefined) result[key] = sanitized;
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
      event: redactString(event, 'event'),
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

const MAX_MIGRATION_EVIDENCE_BYTES = 64 * 1024;

type BoundedMarkerRead =
  | { ok: true; contents: string }
  | {
      ok: false;
      reason: 'marker_too_large' | 'marker_changed' | 'marker_unavailable';
    };

function readBoundedMarker(filePath: string): BoundedMarkerRead {
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(filePath, 'r');
    const initialSize = fstatSync(fileDescriptor).size;
    if (
      !Number.isSafeInteger(initialSize) ||
      initialSize > MAX_MIGRATION_EVIDENCE_BYTES
    ) {
      return { ok: false, reason: 'marker_too_large' };
    }

    const buffer = Buffer.allocUnsafe(MAX_MIGRATION_EVIDENCE_BYTES + 1);
    let offset = 0;
    while (offset <= MAX_MIGRATION_EVIDENCE_BYTES) {
      const bytesRead = readSync(
        fileDescriptor,
        buffer,
        offset,
        MAX_MIGRATION_EVIDENCE_BYTES + 1 - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const finalSize = fstatSync(fileDescriptor).size;
    if (
      offset > MAX_MIGRATION_EVIDENCE_BYTES ||
      finalSize > MAX_MIGRATION_EVIDENCE_BYTES
    ) {
      return { ok: false, reason: 'marker_too_large' };
    }
    if (finalSize !== initialSize || offset !== finalSize) {
      return { ok: false, reason: 'marker_changed' };
    }

    return {
      ok: true,
      contents: buffer.toString('utf8', 0, offset),
    };
  } catch {
    return { ok: false, reason: 'marker_unavailable' };
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // The marker result remains safe if closing an already-closed descriptor fails.
      }
    }
  }
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

  const marker = readBoundedMarker(filePath);
  if (!marker.ok) return { ok: false, reason: marker.reason };

  const contents = marker.contents;

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

export * from './metrics-contract.js';
export {
  MetricRegistry,
  createMetricRegistry,
  escapeMetricLabelValue,
  serializeMetrics,
  serializeOpenMetrics,
  type ApplicationSnapshotMetadata,
  type MetricLabelValues,
  type MetricSourceSnapshot,
} from './metrics.js';
