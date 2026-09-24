import { createHash } from 'node:crypto';

const SEED_NAMESPACE = Buffer.from(
  'd9d1b8a48f5e4b5aa9a3c5e2d7024a21',
  'hex',
);
const SEED_INSTANT_EPOCH = Date.parse('2026-01-01T00:00:00.000Z');
const SEED_INSTANT_RANGE = 366 * 24 * 60 * 60 * 1_000;

export function normalizeSeedEmail(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export function generateSeedEmails(baseEmail: string): readonly string[] {
  const normalized = normalizeSeedEmail(baseEmail);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) {
    throw new TypeError('Invalid seed email');
  }

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return [
    normalized,
    ...Array.from({ length: 49 }, (_, index) => `${localPart}-${index + 1}@${domain}`),
  ];
}

export function stableSeedId(entity: string, seedKey: string): string {
  const digest = createHash('sha1')
    .update(SEED_NAMESPACE)
    .update(`${entity}:${seedKey}`)
    .digest();

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function stableSeedKey(
  baseEmail: string,
  weekStart: string,
  entity: string,
  ordinal: string | number,
): string {
  return `${normalizeSeedEmail(baseEmail)}:${weekStart}:${entity}:${ordinal}`;
}

export function seedEmployeeCode(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 50) {
    throw new RangeError('Invalid seed ordinal');
  }
  return `LOCAL-EMP-${String(ordinal).padStart(4, '0')}`;
}

export function seedInstant(seedKey: string): Date {
  const digest = createHash('sha256').update(seedKey).digest();
  const offset = digest.readUInt32BE(0) % SEED_INSTANT_RANGE;
  return new Date(SEED_INSTANT_EPOCH + offset);
}

export function seedHash(seedKey: string): string {
  return createHash('sha256').update(seedKey).digest('hex');
}
