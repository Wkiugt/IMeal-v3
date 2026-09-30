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

const SENSITIVE_LABEL_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:authorization|bearer|session(?:[-_]?(?:token|id))?|client(?:[-_ ]|\s)*secret|provider(?:[-_ ]|\s)*(?:secret|api[-_ ]?key)|api[-_ ]?key|access[-_ ]?token|password|secret|signature|sig|qr(?:[-_ ]?(?:payload|token|code))?)["']?\s*[:=](?!\/\/)\s*)(["'])(?:\\.|(?!\2)[^\r\n])*\2/gi;
const SENSITIVE_UNQUOTED_PATTERN =
  /((?:^|[\s?&,;{}(]|\[)["']?(?:authorization|bearer|session(?:[-_]?(?:token|id))?|client(?:[-_ ]|\s)*secret|provider(?:[-_ ]|\s)*(?:secret|api[-_ ]?key)|api[-_ ]?key|access[-_ ]?token|password|secret|signature|sig|qr(?:[-_ ]?(?:payload|token|code))?)["']?\s*[:=](?!\/\/)\s*)[^\s"'`&#,;}\])]+/gi;
const PAYLOAD_LABEL_PATTERN =
  /((?:^|[\s,{}(]|\[)["']?(?:body|title|data|to|payload|message)["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[^\r\n])*\2/gi;
const PAYLOAD_UNQUOTED_PATTERN =
  /((?:^|[\s,{}(]|\[)["']?(?:body|title|data|to|payload|message)["']?\s*[:=]\s*)[^\s"'`&#,;}\])]+/gi;
const OTP_LABEL_PATTERN =
  /(\b(?:otp|one[- ]time|verification|auth(?:entication)?)(?:\s+(?:code|password))?(?:(?:\s*[:=]\s*)|\s+))(\d{6})\b/gi;

function redactPayloadLabels(value: string): string {
  return value
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
    .replace(/Bearer\s+[^\s,]+/gi, `Bearer ${REDACTED}`)
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
    .replace(
      /(\b(?:lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*)-?\d+(?:\.\d+)?/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/g, REDACTED)
    .replace(OTP_LABEL_PATTERN, `$1${REDACTED}`);

  if (context === 'event' || key === 'providerCode') {
    redacted = redactPayloadLabels(redacted);
  }

  return redacted;
}

function sanitizeField(
  key: string,
  value: unknown,
): string | number | boolean | undefined {
  if (SAFE_FIELD_KEYS[key] !== true) return undefined;

  if (typeof value === 'string') {
    if (key === 'requestId' && !REQUEST_ID_PATTERN.test(value)) {
      return REDACTED;
    }
    const redacted = redactString(value, 'field', key);
    return key === 'route' ? redacted.split('?')[0] : redacted;
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
  type MetricLabelValues,
  type MetricSourceSnapshot,
} from './metrics.js';
