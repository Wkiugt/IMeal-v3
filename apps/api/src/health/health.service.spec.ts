import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service.js';
import type { ShutdownCoordinatorLike } from './health.types.js';
import { HealthService } from './health.service.js';
function markerPath(): string {
  return join(
    mkdtempSync(join(tmpdir(), 'imeal-api-health-')),
    'migration.json',
  );
}

function validMarker() {
  return JSON.stringify({
    release: 'release-1',
    migration: 'migration-1',
    targetSchema: 'schema-1',
    approvalId: 'approval-1',
    completedAt: '2026-09-28T00:00:00.000Z',
  });
}

describe('HealthService', () => {
  let prisma: {
    $queryRaw: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
  };
  let shutdown: ShutdownCoordinatorLike;
  let path: string;

  beforeEach(() => {
    path = markerPath();
    writeFileSync(path, validMarker());
    vi.stubEnv('RELEASE_VERSION', 'release-1');
    vi.stubEnv('MIGRATION_EVIDENCE_PATH', path);
    vi.stubEnv('MIGRATION_TARGET_IDENTITY', 'schema-1');
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      isReady: vi.fn().mockReturnValue(true),
    };
    shutdown = { isDraining: vi.fn().mockReturnValue(false) };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(path, { force: true });
    rmSync(join(path, '..'), { force: true, recursive: true });
  });

  it('returns live without querying Prisma', () => {
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );

    const result = service.live('request-1');

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      status: 'ok',
      service: 'api',
      requestId: 'request-1',
      release: null,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns 200 ready only when DB, marker, and drain checks pass', async () => {
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );

    const result = await service.ready('request-1');

    expect(result.statusCode).toBe(200);
    expect(result.body.checks).toEqual({
      environment: 'ok',
      database: 'ok',
      migration: 'ok',
      draining: 'ok',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns 503 and safe check states on DB failure', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('secret database detail'));
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );

    const result = await service.ready('request-1');

    expect(result.statusCode).toBe(503);
    expect(result.body.checks.database).toBe('down');
    expect(JSON.stringify(result.body)).not.toContain('secret database detail');
  });

  it('returns 503 when migration evidence is missing or mismatched', async () => {
    vi.stubEnv('MIGRATION_TARGET_IDENTITY', 'wrong-schema');
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );

    const result = await service.ready('request-1');

    expect(result.statusCode).toBe(503);
    expect(result.body.checks.migration).toBe('down');
  });

  it('returns 503 while shutdown is draining', async () => {
    shutdown.isDraining = vi.fn().mockReturnValue(true);
    const service = new HealthService(
      prisma as unknown as PrismaService,
      shutdown,
    );

    expect(service.live('request-1').statusCode).toBe(503);
    expect((await service.ready('request-1')).statusCode).toBe(503);
  });
});
