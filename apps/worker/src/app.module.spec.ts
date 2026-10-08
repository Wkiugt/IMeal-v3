import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { WORKER_METRICS_POSTGRES_SOURCE_PROVIDER } from './metrics/authoritative-metrics-runtime.service.js';

describe('worker metrics source wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://user:password@localhost/imeal?schema=public',
    );
  });
  it('registers concrete providers that fail closed when the protected registry is absent', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_METRICS_POSTGRES_SOURCE', 'source-ref');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const postgres = module.get<{
      collect: (reference: string, observedAt: string) => Promise<unknown>;
    }>(WORKER_METRICS_POSTGRES_SOURCE_PROVIDER);
    await expect(
      postgres.collect('source-ref', '2026-09-30T00:00:00.000Z'),
    ).resolves.toBeUndefined();

    await module.close();
  });
});
