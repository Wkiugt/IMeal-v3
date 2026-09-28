import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JsonStructuredLogger,
  REQUEST_ID_PATTERN,
  readMigrationEvidence,
  resolveRequestId,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function temporaryFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-observability-'));
  temporaryDirectories.push(directory);
  const file = join(directory, 'migration-gate.json');
  writeFileSync(file, contents, 'utf8');
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('request IDs', () => {
  it('preserves a valid UUIDv4 request ID', () => {
    expect(resolveRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('replaces malformed or missing request IDs with UUIDv4 values', () => {
    expect(resolveRequestId('attacker-value')).toMatch(REQUEST_ID_PATTERN);
    expect(resolveRequestId(undefined)).toMatch(REQUEST_ID_PATTERN);
  });
});

describe('JSON structured logging', () => {
  it('serializes required fields and redacts sensitive values', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('http.request', {
      service: 'api',
      release: 'r1',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'GET',
      route: '/api/health',
      statusCode: 200,
      durationMs: 4,
      bearer: 'Bearer opaque-token',
      otp: '123456',
      payload: 'ExpoPushToken[secret]',
      coordinates: '10.7769,106.7009',
      databaseUrl: 'postgresql://user:password@db.internal/imeal',
    });

    expect(lines).toHaveLength(1);
    const output = JSON.parse(lines[0]);
    expect(output).toMatchObject({
      level: 'info',
      service: 'api',
      release: 'r1',
      event: 'http.request',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'GET',
      route: '/api/health',
      statusCode: 200,
      durationMs: 4,
    });
    expect(output.timestamp).toEqual(expect.any(String));
    expect(lines[0]).not.toContain('opaque-token');
    expect(lines[0]).not.toContain('123456');
    expect(lines[0]).not.toContain('ExpoPushToken[secret]');
    expect(lines[0]).not.toContain('10.7769,106.7009');
    expect(lines[0]).not.toContain(
      'postgresql://user:password@db.internal/imeal',
    );
  });

  it('writes one line for each log level', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('worker', 'r1', (line) =>
      lines.push(line),
    );
    const fields = {
      service: 'worker' as const,
      release: 'r1',
      event: 'job.loop',
    };

    logger.debug(fields.event, fields);
    logger.info(fields.event, fields);
    logger.warn(fields.event, fields);
    logger.error(fields.event, fields);

    expect(lines.map((line) => JSON.parse(line).level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
    ]);
  });
});

describe('migration evidence', () => {
  it('accepts only a matching migration evidence marker', () => {
    const file = temporaryFile(
      JSON.stringify({
        release: 'release-1',
        migration: '20260928000000_phase0_domain_correctness',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    );

    const result = readMigrationEvidence(file, 'release-1', 'staging-schema');

    expect(result).toEqual({
      ok: true,
      evidence: {
        release: 'release-1',
        migration: '20260928000000_phase0_domain_correctness',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      },
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty(
      'approvalId',
      'approval-1',
    );
  });

  it.each([
    ['missing marker', undefined],
    ['malformed JSON', '{not-json'],
    [
      'stale release',
      JSON.stringify({
        release: 'release-0',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    ],
    [
      'wrong target',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'production-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    ],
    [
      'missing required field',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    ],
  ])('rejects %s markers safely', (_reason, contents) => {
    const file =
      contents === undefined
        ? join(tmpdir(), 'missing-imeal-marker.json')
        : temporaryFile(contents);

    const result = readMigrationEvidence(file, 'release-1', 'staging-schema');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain('release-0');
      expect(result.reason).not.toContain('production-schema');
      expect(result.reason).not.toContain('approval-1');
    }
  });
});
