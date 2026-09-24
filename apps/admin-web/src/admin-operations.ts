export interface RosterImportRow {
  email: string;
  name: string;
  employeeCode: string;
  isActive: boolean;
  role: string;
  serviceLocationCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RosterPreviewInputRow extends RosterImportRow {
  rowNumber: number;
  normalizedEmail: string;
  locationId?: string;
  reason?: string;
}

export interface RosterPreview {
  batchId?: string;
  source: string;
  rows: ReadonlyArray<RosterPreviewInputRow>;
  valid: boolean;
  acceptedCount: number;
  rejectedCount: number;
}

export type RosterPreviewRowOutcome = 'ACCEPTED' | 'REJECTED';

export interface RosterPreviewRow extends RosterPreviewInputRow {
  outcome: RosterPreviewRowOutcome;
}

export interface RosterImportRequest {
  source: 'admin-web';
  rows: ReadonlyArray<RosterImportRow>;
}

export interface AuditEntry {
  id?: string | null;
  action: string;
  userId?: string | null;
  createdAt?: string | Date | null;
  details?: unknown;
}

export interface SafeAuditEntry {
  id: string | null;
  action: string;
  actorId: string | null;
  occurredAt: string | null;
  result: string | null;
  details: Readonly<Record<string, string | number | boolean | null>>;
  redactedFields: ReadonlyArray<string>;
}

type SafeDetailKind = 'boolean' | 'code' | 'count' | 'id' | 'source';

const SAFE_DETAIL_KINDS: Record<string, SafeDetailKind> = {
  acceptedCount: 'count',
  assignmentId: 'id',
  batchId: 'id',
  idempotent: 'boolean',
  locationId: 'id',
  rejectedCount: 'count',
  result: 'code',
  rowNumber: 'count',
  source: 'source',
  state: 'code',
  status: 'code',
};

const SAFE_CODE_VALUE = /^[A-Z][A-Z0-9_:-]{0,31}$/;
const SAFE_ID_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SAFE_SOURCE_VALUES = new Set([
  'admin-api',
  'admin-web',
  'import',
  'scanner',
  'system',
]);
const SENSITIVE_DETAIL_KEY =
  /(?:otp|code|token|secret|password|session|qr|gps|latitude|longitude|accuracy|coordinate|locationclaim|raw)/i;
const SENSITIVE_DETAIL_VALUE =
  /(?:\b(?:otp|one[-\s]?time(?:[-\s]?pass(?:word)?)?|token|secret|password|session|csrf|bearer|authorization|cookie|qr|gps|latitude|longitude|accuracy|coordinate|locationclaim|raw)\b|(?:\b(?:lat(?:itude)?|lon(?:gitude)?)\s*[:=])|(?:[-+]?\d{1,3}\.\d+\s*[,;]\s*[-+]?\d{1,3}\.\d+)|(?:\b\d{4,8}\b))/i;

function cleanText(value: string): string {
  return value.normalize('NFKC').trim();
}

function normalizeEmail(value: string): string {
  return cleanText(value).toLowerCase();
}

function safeDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function parseDetails(details: unknown): Record<string, unknown> {
  if (typeof details === 'string') {
    try {
      const parsed: unknown = JSON.parse(details);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function safeDetailValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  const kind = SAFE_DETAIL_KINDS[key];
  if (!kind) return undefined;
  if (value === null) return null;

  if (kind === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (kind === 'count') {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 1_000_000
      ? value
      : undefined;
  }

  if (typeof value !== 'string') return undefined;
  const normalized = cleanText(value);
  if (
    normalized.length === 0 ||
    SENSITIVE_DETAIL_VALUE.test(normalized)
  ) {
    return undefined;
  }

  if (kind === 'source') {
    return SAFE_SOURCE_VALUES.has(normalized) ? normalized : undefined;
  }
  if (kind === 'code') {
    return SAFE_CODE_VALUE.test(normalized) ? normalized : undefined;
  }
  return SAFE_ID_VALUE.test(normalized) ? normalized : undefined;
}

export interface EffectiveLocationPolicy {
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
}

export function selectEffectiveLocationPolicy<T extends EffectiveLocationPolicy>(
  policies: ReadonlyArray<T>,
  at: Date = new Date(),
): T | undefined {
  const atMillis = at.getTime();
  return policies
    .filter((policy) => {
      const effectiveFrom = new Date(policy.effectiveFrom).getTime();
      const effectiveTo = policy.effectiveTo
        ? new Date(policy.effectiveTo).getTime()
        : Number.POSITIVE_INFINITY;
      return (
        policy.isActive &&
        Number.isFinite(effectiveFrom) &&
        effectiveFrom <= atMillis &&
        effectiveTo > atMillis
      );
    })
    .sort(
      (left, right) =>
        new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
    )[0];
}

/**
 * Maps the API's preview into rows that can be rendered without deriving or
 * changing server validation outcomes.
 */
export function toRosterPreviewRows(
  result: RosterPreview,
): ReadonlyArray<RosterPreviewRow> {
  return result.rows.map((row) => ({
    ...row,
    email: normalizeEmail(row.email),
    normalizedEmail: normalizeEmail(row.normalizedEmail || row.email),
    outcome: row.reason ? 'REJECTED' : 'ACCEPTED',
  }));
}

/**
 * Keeps audit cards useful while dropping secrets and raw device/location
 * evidence before data reaches the DOM.
 */
export function toSafeAuditEntry(entry: AuditEntry): SafeAuditEntry {
  const source = parseDetails(entry.details);
  const details: Record<string, string | number | boolean | null> = {};
  const redactedFields: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) {
      redactedFields.push(key);
      continue;
    }
    const scalar = safeDetailValue(key, value);
    if (scalar === undefined) {
      redactedFields.push(key);
      continue;
    }
    details[key] = scalar;
  }

  const result = typeof details.result === 'string' ? details.result : null;
  return {
    id: typeof entry.id === 'string' ? entry.id : null,
    action: cleanText(entry.action),
    actorId: typeof entry.userId === 'string' ? entry.userId : null,
    occurredAt: safeDate(entry.createdAt),
    result,
    details,
    redactedFields,
  };
}

/**
 * Creates the exact allowlisted request accepted by the roster endpoint.
 * Unknown UI fields are deliberately not forwarded to the API.
 */
export function toRosterImportRequest(
  rows: ReadonlyArray<RosterImportRow>,
): RosterImportRequest {
  return {
    source: 'admin-web',
    rows: rows.map((row) => ({
      email: normalizeEmail(row.email),
      name: cleanText(row.name),
      employeeCode: cleanText(row.employeeCode),
      isActive: row.isActive === true,
      role: cleanText(row.role),
      serviceLocationCode: cleanText(row.serviceLocationCode).toUpperCase(),
      effectiveFrom: cleanText(row.effectiveFrom),
      effectiveTo: row.effectiveTo === null ? null : cleanText(row.effectiveTo),
    })),
  };
}
