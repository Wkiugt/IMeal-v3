import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import {
  WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER,
  WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER,
  WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
  WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER,
} from './metrics/authoritative-metrics-runtime.service.js';

describe('worker metrics source wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('registers concrete providers that fail closed when the protected registry is absent', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_METRICS_POSTGRES_SOURCE', 'source-ref');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    const postgres = module.get<{ collect: (reference: string, observedAt: string) => Promise<unknown> }>(
      WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
    );
    await expect(
      postgres.collect('source-ref', '2026-09-30T00:00:00.000Z'),
    ).resolves.toBeUndefined();

    await module.close();
  });

  it('registers four concrete source providers with absent protected registry config', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    for (const token of [
      WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
      WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER,
      WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER,
      WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER,
    ]) {
      expect(typeof module.get<{ collect: unknown }>(token).collect).toBe('function');
    }

    await module.close();
  });
});
