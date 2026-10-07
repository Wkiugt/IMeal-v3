const SENSITIVE_KEY =
  /(otp|token|secret|password|passwd|hash|gps|coordinate|latitude|longitude|\blat\b|\blng\b|qr|authorization|cookie|bearer|signature|nonce|credential|verifier|api[-_]?key|payload)/i;
const SENSITIVE_VALUE =
  /bearer\s+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN |sha256:[a-f0-9]{16,}/i;
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RESULT = /^[A-Z][A-Z0-9_]{0,63}$/;
const RESOURCE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export type RedactedAuditDetails = {
  details: Record<string, string | number | boolean | null> | null;
  redacted: boolean;
  targetUserId: string | null;
  result: string | null;
  resourceType: string | null;
};

function sensitive(value: string): boolean {
  return SENSITIVE_KEY.test(value) || SENSITIVE_VALUE.test(value);
}

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return undefined;
  if (sensitive(value)) return undefined;
  return value;
}

export function redactAuditDetails(raw: string | null | undefined): RedactedAuditDetails {
  const empty = {
    details: null,
    redacted: false,
    targetUserId: null,
    result: null,
    resourceType: null,
  };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (raw.length > 500 || sensitive(raw)) {
      return { ...empty, redacted: true };
    }
    return {
      ...empty,
      details: { message: raw },
      redacted: false,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...empty, redacted: true };
  }
  const details: Record<string, string | number | boolean | null> = {};
  let redacted = false;
  for (const [key, value] of Object.entries(parsed)) {
    if (!SAFE_KEY.test(key) || sensitive(key)) {
      redacted = true;
      continue;
    }
    const scalar = safeScalar(value);
    if (scalar === undefined) {
      redacted = true;
      continue;
    }
    details[key] = scalar;
  }
  const target = details.targetUserId;
  const result = details.result;
  const resource = details.resourceType;
  return {
    details: Object.keys(details).length > 0 ? details : null,
    redacted,
    targetUserId: typeof target === 'string' && OPAQUE_ID.test(target) ? target : null,
    result: typeof result === 'string' && RESULT.test(result) ? result : null,
    resourceType:
      typeof resource === 'string' && RESOURCE.test(resource) ? resource : null,
  };
}

export function pageMeta(page: number, limit: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
  };
}

export function auditColumnsFromDetails(
  details: string | null | undefined,
  explicit: {
    targetUserId?: string | null;
    result?: string | null;
    resourceType?: string | null;
  } = {},
): {
  targetUserId: string | null;
  result: string | null;
  resourceType: string | null;
} {
  const parsed = redactAuditDetails(details);
  return {
    targetUserId: explicit.targetUserId ?? parsed.targetUserId,
    result: explicit.result ?? parsed.result,
    resourceType: explicit.resourceType ?? parsed.resourceType,
  };
}
