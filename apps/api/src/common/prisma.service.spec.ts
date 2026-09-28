import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { AppService } from '../app.service.js';
import { AllowlistService } from '../auth/allowlist.service.js';
import { describe, expect, it, vi, type Mock } from 'vitest';
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
  Reflect.set(service, '$connect', connect);
  Reflect.set(service, '$disconnect', disconnect);
  Reflect.set(service, 'logger', { log: vi.fn(), error: vi.fn() });
  return { service, connect, disconnect };
}

describe('PrismaService', () => {
  it('connects and disconnects through Nest lifecycle hooks', async () => {
    const { service, connect, disconnect } = harness();

    await service.onModuleInit();
    expect(connect).toHaveBeenCalledOnce();
    expect(service.isReady()).toBe(true);

    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(service.isReady()).toBe(false);
  });

  it('rejects startup and remains not ready when connection fails', async () => {
    const { service, connect } = harness();
    const error = new Error('connection refused');
    connect.mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toBe(error);
    expect(service.isReady()).toBe(false);
  });

  it('registers one PrismaService shared by API providers', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const prisma = module.get(PrismaService);
    expect(Reflect.get(module.get(AppService), 'prisma')).toBe(prisma);
    expect(Reflect.get(module.get(AllowlistService), 'prisma')).toBe(prisma);

    await module.close();
  });
});
