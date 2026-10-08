import { Test, type TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { NoShowWorkerService } from './no-show-worker.service.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import { NotificationReminderService } from './notification-reminder.service.js';
import { OtpDeliveryWorker } from './otp-delivery-worker.service.js';
import { PrismaService } from './common/prisma.service.js';

type Registration = {
  method: string;
  expression: string;
  timeZone?: string;
  service: new (...args: never[]) => unknown;
};

const expectedRegistrations: readonly Registration[] = [
  {
    service: OtpDeliveryWorker,
    method: 'handleOtpDeliveryCron',
    expression: '*/15 * * * * *',
  },
  {
    service: NotificationDispatchService,
    method: 'handleNotificationDispatchCron',
    expression: '*/15 * * * * *',
  },
  {
    service: NotificationReminderService,
    method: 'handleRegistrationReminderCron',
    expression: '0 10 * * 0',
    timeZone: 'Asia/Ho_Chi_Minh',
  },
  {
    service: NotificationReminderService,
    method: 'handlePickupReminderCron',
    expression: '30 11 * * *',
    timeZone: 'Asia/Ho_Chi_Minh',
  },
  {
    service: NoShowWorkerService,
    method: 'handleNoShowCron',
    expression: '45 13 * * *',
    timeZone: 'Asia/Ho_Chi_Minh',
  },
];

let testingModule: TestingModule | undefined;

async function compileWorkerModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({
      isReady: () => true,
      $connect: vi.fn().mockResolvedValue(undefined),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    })
    .compile();
}

function replaceScheduledMethod(
  service: object,
  method: string,
  callback: () => void,
): void {
  const original = (service as Record<string, unknown>)[method];
  const replacement = vi.fn(callback);
  for (const metadataKey of Reflect.getMetadataKeys(original as object)) {
    Reflect.defineMetadata(
      metadataKey,
      Reflect.getMetadata(metadataKey, original as object),
      replacement,
    );
  }
  Object.defineProperty(service, method, {
    configurable: true,
    value: replacement,
    writable: true,
  });
}

describe('worker scheduler registration', () => {
  beforeEach(() => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://user:password@localhost/imeal?schema=public',
    );
  });

  afterEach(async () => {
    await testingModule?.close();
    testingModule = undefined;
    vi.unstubAllEnvs();
  });

  it('registers every production cron with its expected expression', async () => {
    testingModule = await compileWorkerModule();
    const invokedMethods: string[] = [];

    for (const registration of expectedRegistrations) {
      const service = testingModule.get(registration.service) as object;
      replaceScheduledMethod(service, registration.method, () => {
        invokedMethods.push(registration.method);
      });
    }

    await testingModule.init();

    const registry = testingModule.get(SchedulerRegistry);
    const cronJobs = [...registry.getCronJobs().values()];
    expect(cronJobs).toHaveLength(expectedRegistrations.length);

    const observed = new Map<
      string,
      { source: unknown; timeZone?: string }
    >();
    for (const cronJob of cronJobs) {
      invokedMethods.length = 0;
      await cronJob.fireOnTick();
      expect(invokedMethods).toHaveLength(1);
      observed.set(invokedMethods[0], {
        source: cronJob.cronTime.source,
        timeZone: cronJob.cronTime.timeZone,
      });
    }

    expect([...observed.keys()].sort()).toEqual(
      expectedRegistrations.map(({ method }) => method).sort(),
    );
    for (const registration of expectedRegistrations) {
      const cronJob = observed.get(registration.method);
      expect(cronJob?.source).toBe(registration.expression);
      if (registration.timeZone) {
        expect(cronJob?.timeZone).toBe(registration.timeZone);
      }
    }
  });

  it('does not register a cutoff cron', async () => {
    testingModule = await compileWorkerModule();
    await testingModule.init();

    const cronJobs = [
      ...testingModule.get(SchedulerRegistry).getCronJobs().values(),
    ];
    expect(cronJobs).toHaveLength(expectedRegistrations.length);
    expect(cronJobs.map(({ cronTime }) => cronTime.source)).not.toContain(
      '0 14 * * *',
    );
  });
});
