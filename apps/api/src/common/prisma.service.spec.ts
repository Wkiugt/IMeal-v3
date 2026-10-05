import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PrismaService } from './prisma.service.js';

type PrismaLifecycleHarness = {
  service: PrismaService;
  connect: Mock;
  disconnect: Mock;
};

function harness(): PrismaLifecycleHarness {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const logger = { log: vi.fn(), error: vi.fn() };
  Reflect.set(service, '$connect', connect);
  Reflect.set(service, '$disconnect', disconnect);
  Reflect.set(service, 'logger', logger);
  return { service, connect, disconnect };
}

describe('PrismaService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it('tracks readiness through Nest lifecycle hooks', async () => {
    const { service } = harness();

    await service.onModuleInit();
    expect(service.isReady()).toBe(true);

    await service.onModuleDestroy();
    expect(service.isReady()).toBe(false);
  });

  it('rejects startup and remains not ready when connection fails', async () => {
    const { service, connect } = harness();
    const error = new Error('connection refused');
    connect.mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toBe(error);
    expect(service.isReady()).toBe(false);
  });

  it('handles disconnect failures and leaves the service not ready', async () => {
    const { service, disconnect } = harness();
    await service.onModuleInit();
    disconnect.mockRejectedValue(new Error('disconnect failed'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(service.isReady()).toBe(false);
  });

  it('bounds disconnect time and leaves the service not ready', async () => {
    vi.stubEnv('SHUTDOWN_TIMEOUT_SECONDS', '1');
    vi.useFakeTimers();
    const { service, disconnect } = harness();
    await service.onModuleInit();
    disconnect.mockReturnValue(Promise.race([]));

    const destroy = service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(destroy).resolves.toBeUndefined();

    expect(service.isReady()).toBe(false);
  });
});
