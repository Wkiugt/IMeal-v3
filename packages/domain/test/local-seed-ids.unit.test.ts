import { describe, expect, it } from 'vitest';
import {
  generateSeedEmails,
  normalizeSeedEmail,
  seedEmployeeCode,
  seedHash,
  seedInstant,
  stableSeedId,
  stableSeedKey,
} from '../src/local-seed/ids.js';

describe('local seed deterministic IDs', () => {
  it('generates the base and exactly -1 through -49 addresses', () => {
    const emails = generateSeedEmails(' Seed@Example.test ');

    expect(emails).toHaveLength(50);
    expect(emails[0]).toBe('seed@example.test');
    expect(emails[49]).toBe('seed-49@example.test');
    expect(new Set(emails).size).toBe(50);
  });

  it('normalizes seed email text with compatibility normalization', () => {
    expect(normalizeSeedEmail(' Ｓｅｅｄ@Example.TEST ')).toBe('seed@example.test');
  });

  it('keeps IDs stable and entity/key-specific', () => {
    expect(stableSeedId('user', 'seed@example.test:0')).toBe(
      stableSeedId('user', 'seed@example.test:0'),
    );
    expect(stableSeedId('user', 'seed@example.test:0')).not.toBe(
      stableSeedId('user', 'seed@example.test:1'),
    );
    expect(stableSeedId('user', 'seed@example.test:0')).not.toBe(
      stableSeedId('location', 'seed@example.test:0'),
    );
  });

  it('builds stable keys and deterministic seed values', () => {
    const key = stableSeedKey(' Seed@Example.test ', '2026-09-28', 'user', 0);

    expect(key).toBe('seed@example.test:2026-09-28:user:0');
    expect(seedEmployeeCode(1)).toBe('LOCAL-EMP-0001');
    expect(seedEmployeeCode(50)).toBe('LOCAL-EMP-0050');
    expect(seedHash(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(seedInstant(key)).toEqual(seedInstant(key));
  });
});
