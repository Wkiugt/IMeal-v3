import { isFiniteNonnegative, isSha256Digest } from '../authoritative-metrics.js';
import type { MetricFreshness } from '@imeal/observability';

export type JsonRecord = Record<string, unknown>;

export const AUTHORITATIVE_CONTRACT_REVISION = '2026-09-30';

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: JsonRecord,
  required: readonly string[],
  allowed: readonly string[] = required,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length &&
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isFreshness(value: unknown): value is MetricFreshness {
  return value === 'fresh' || value === 'stale' || value === 'unknown' || value === 'collector_failure';
}

export function isAuthoritativeEvidence(
  value: unknown,
  expectedSource: string,
  observedAt: string,
  freshness: MetricFreshness,
  sourceSpecificKeys: readonly string[],
): value is JsonRecord {
  if (!isRecord(value)) return false;
  const required = [
    'release',
    'source',
    'observedAt',
    'contractRevision',
    'freshness',
    'sha256Digest',
    'sourceKind',
    ...sourceSpecificKeys,
  ];
  if (!hasExactKeys(value, required)) return false;
  return (
    typeof value.release === 'string' &&
    value.release.length > 0 &&
    value.source === expectedSource &&
    value.observedAt === observedAt &&
    value.contractRevision === AUTHORITATIVE_CONTRACT_REVISION &&
    value.freshness === freshness &&
    value.sourceKind === 'authoritative' &&
    isSha256Digest(value.sha256Digest)
  );
}


export function isNonnegativeSafeInteger(value: unknown): value is number {
  return isFiniteNonnegative(value) && Number.isSafeInteger(value);
}

export function isNonnegativeNumber(value: unknown): value is number {
  return isFiniteNonnegative(value);
}

