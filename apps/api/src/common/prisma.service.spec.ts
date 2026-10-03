import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { AppService } from '../app.service.js';
import { AllowlistService } from '../auth/allowlist.service.js';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PrismaService } from './prisma.service.js';
import { AllowlistController } from '../admin/allowlist/allowlist.controller.js';
import { PenaltiesService } from '../admin/penalties/penalties.service.js';
import { RosterImportService } from '../admin/roster/roster-import.service.js';
import { OtpService } from '../auth/otp.service.js';
import { SessionService } from '../auth/session.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PushDevicesService } from '../notifications/push-devices.service.js';
import { OtpOutboxService } from '../otp/otp-outbox.service.js';
import { RegistrationsService } from '../registrations/registrations.service.js';

type PrismaLifecycleHarness = {
  service: PrismaService;
  connect: Mock;
  disconnect: Mock;
  logger: { log: Mock; error: Mock };
};

function harness(): PrismaLifecycleHarness {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const logger = { log: vi.fn(), error: vi.fn() };
  Reflect.set(service, '$connect', connect);
  Reflect.set(service, '$disconnect', disconnect);
  Reflect.set(service, 'logger', logger);
  return { service, connect, disconnect, logger };
}

describe('PrismaService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
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

  it('logs disconnect failures and leaves the service not ready', async () => {
    const { service, disconnect, logger } = harness();
    await service.onModuleInit();
    disconnect.mockRejectedValue(new Error('disconnect failed'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('prisma.disconnect_failed');
    expect(service.isReady()).toBe(false);
  });

  it('bounds disconnect time and logs timeout failures', async () => {
    vi.stubEnv('SHUTDOWN_TIMEOUT_SECONDS', '1');
    vi.useFakeTimers();
    const { service, disconnect, logger } = harness();
    await service.onModuleInit();
    disconnect.mockReturnValue(Promise.race([]));

    const destroy = service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(destroy).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('prisma.disconnect_failed');
    expect(service.isReady()).toBe(false);
  });

  it('registers one PrismaService shared by API providers', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const prisma = module.get(PrismaService);
    const owners = [
      AppService,
      AllowlistService,
      OtpService,
      SessionService,
      OtpOutboxService,
      AllowlistController,
      PenaltiesService,
      RosterImportService,
      LocationsService,
      NotificationsService,
      PushDevicesService,
      RegistrationsService,
    ];
    for (const Owner of owners) {
      expect(Reflect.get(module.get(Owner), 'prisma')).toBe(prisma);
    }

    await module.close();
  });
});
