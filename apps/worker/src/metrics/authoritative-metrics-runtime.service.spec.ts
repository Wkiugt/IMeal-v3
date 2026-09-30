import { describe, expect, it, vi } from 'vitest';
import type { WorkerMetricsService } from './metrics.service.js';
import {
  AuthoritativeMetricsRuntimeService,
  type AuthoritativeMetricsRuntimeScheduler,
} from './authoritative-metrics-runtime.service.js';
import type { AuthoritativeMetricsCollectorProviders } from './authoritative-metrics-collector.js';

const digest = `sha256:${'a'.repeat(64)}`;
const validEnvironment = {
  NODE_ENV: 'production',
  RELEASE_VERSION: 'release-staging-1',
  WORKER_METRICS_TARGET_FINGERPRINT: digest,
  WORKER_METRICS_POSTGRES_SOURCE: 'postgres-exporter-private',
  WORKER_METRICS_OBJECT_STORAGE_SOURCE: 'minio-capacity-private',
  WORKER_METRICS_BACKUP_EVIDENCE_SOURCE: 'backup-evidence-private',
  WORKER_METRICS_SECURITY_BOUNDARY_SOURCE: 'security-feed-private',
} satisfies NodeJS.ProcessEnv;

function sink(): WorkerMetricsService {
  return {
    acceptAuthoritativeSnapshot: vi.fn(),
    acceptAuthoritativeFailure: vi.fn(),
  } as unknown as WorkerMetricsService;
}

function scheduler(): AuthoritativeMetricsRuntimeScheduler & {
  callback?: () => void;
} {
  const value: AuthoritativeMetricsRuntimeScheduler & { callback?: () => void } = {
    setInterval: vi.fn((callback: () => void) => {
      value.callback = callback;
      return 1 as unknown as NodeJS.Timeout;
    }),
    clearInterval: vi.fn(),
  };
  return value;
}

describe('AuthoritativeMetricsRuntimeService', () => {
  it('collects once, starts the fixed schedule, and stops on module destroy', async () => {
    const metrics = sink();
    const timer = scheduler();
    const service = new AuthoritativeMetricsRuntimeService(
      metrics,
      undefined,
      undefined,
      undefined,
      undefined,
      timer,
      validEnvironment,
    );

    await service.onModuleInit();

    expect(metrics.acceptAuthoritativeFailure).toHaveBeenCalledTimes(4);
    expect(timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    service.onModuleDestroy();
    expect(timer.clearInterval).toHaveBeenCalledWith(1);
  });

  it('reports all sources failed when optional provider tokens are absent', async () => {
    const metrics = sink();
    const service = new AuthoritativeMetricsRuntimeService(
      metrics,
      undefined,
      undefined,
      undefined,
      undefined,
      scheduler(),
      validEnvironment,
    );

    await service.onModuleInit();

    expect(metrics.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(metrics.acceptAuthoritativeFailure).toHaveBeenCalledTimes(4);
    expect(metrics.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'configuration_missing',
    );
  });

  it('fails closed for missing target fingerprint or release without calling providers', async () => {
    const metrics = sink();
    const postgres = { collect: vi.fn() };
    const providers: AuthoritativeMetricsCollectorProviders = { postgres };
    const environment = {
      ...validEnvironment,
      RELEASE_VERSION: '',
      WORKER_METRICS_TARGET_FINGERPRINT: '',
    };
    const service = new AuthoritativeMetricsRuntimeService(
      metrics,
      postgres,
      undefined,
      undefined,
      undefined,
      scheduler(),
      environment,
    );

    await service.onModuleInit();

    expect(postgres.collect).not.toHaveBeenCalled();
    expect(metrics.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(metrics.acceptAuthoritativeFailure).toHaveBeenCalledTimes(4);
  });

  it('fails closed when production source references are missing or unsafe', async () => {
    const metrics = sink();
    const postgres = { collect: vi.fn() };
    const service = new AuthoritativeMetricsRuntimeService(
      metrics,
      postgres,
      undefined,
      undefined,
      undefined,
      scheduler(),
      { ...validEnvironment, WORKER_METRICS_POSTGRES_SOURCE: 'postgres://db' },
    );

    await service.onModuleInit();

    expect(postgres.collect).not.toHaveBeenCalled();
    expect(metrics.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(metrics.acceptAuthoritativeFailure).toHaveBeenCalledTimes(4);
  });
});
