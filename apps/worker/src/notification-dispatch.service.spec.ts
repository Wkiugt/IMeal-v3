import type { Expo } from 'expo-server-sdk';
import type { StructuredLogger } from '@imeal/observability';
import { PrismaService } from './common/prisma.service.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
type TestDelivery = {
  id: string;
  notificationId: string;
  pushDeviceId: string;
  attemptCount: number;
  pushDevice: { token: string; revokedAt: Date | null };
  notification: {
    id: string;
    titleVi: string;
    bodyVi: string;
    titleEn: string;
    bodyEn: string;
    user: { notificationLocale: 'VI' };
  };
};

function makeDelivery(attemptCount = 0): TestDelivery {
  const revokedAt: Date | null = null;
  return {
    id: 'delivery-1',
    notificationId: 'notification-1',
    pushDeviceId: 'device-1',
    attemptCount,
    pushDevice: { token: 'ExpoPushToken[redacted]', revokedAt },
    notification: {
      id: 'notification-1',
      titleVi: 'Tiêu đề',
      bodyVi: 'Nội dung',
      titleEn: 'Title',
      bodyEn: 'Body',
      user: { notificationLocale: 'VI' as const },
    },
  };
}

describe('NotificationDispatchService ticket mapping', () => {
  let prisma: {
    $transaction: Mock;
    notificationDelivery: { update: Mock };
    pushDevice: { updateMany: Mock };
  };
  let expo: {
    chunkPushNotifications: Mock;
    sendPushNotificationsAsync: Mock;
  };
  let service: NotificationDispatchService;

  beforeEach(() => {
    const tx = {
      $queryRaw: vi.fn(),
      notificationDelivery: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ status: 'PROCESSING' }),
      },
      pushDevice: {
        updateMany: vi.fn(),
        findUnique: vi
          .fn()
          .mockResolvedValue({ userId: 'user-1', revokedAt: null }),
      },
      notification: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'user-1' }),
      },
    };
    prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
      notificationDelivery: tx.notificationDelivery,
      pushDevice: tx.pushDevice,
    };
    expo = {
      chunkPushNotifications: vi.fn((messages: unknown[]) => [messages]),
      sendPushNotificationsAsync: vi.fn(),
    };
    service = new NotificationDispatchService(
      prisma as unknown as PrismaService,
      expo as unknown as Expo,
    );
  });

  it('retries MessageRateExceeded from ticket details instead of treating status=error as permanent', async () => {
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        details: { error: 'MessageRateExceeded' },
      },
    ]);
    vi.spyOn(service, 'claimNotificationDeliveries').mockResolvedValueOnce([
      makeDelivery() as never,
    ]);

    await service.processNotificationDeliveries(
      new Date('2026-09-18T03:00:00.000Z'),
    );

    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'PENDING',
        attemptCount: 1,
        nextAttemptAt: new Date('2026-09-18T03:01:00.000Z'),
        lastError: 'MessageRateExceeded',
      },
    });
    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
  });

  it('fails and revokes a device for DeviceNotRegistered from ticket details', async () => {
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);
    vi.spyOn(service, 'claimNotificationDeliveries').mockResolvedValueOnce([
      makeDelivery() as never,
    ]);
    const now = new Date('2026-09-18T03:00:00.000Z');

    await service.processNotificationDeliveries(now);

    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'FAILED',
        attemptCount: 1,
        nextAttemptAt: now,
        lastError: 'DeviceNotRegistered',
      },
    });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'device-1', revokedAt: null },
      data: { revokedAt: now },
    });
  });

  it('redacts arbitrary provider details from structured providerCode logs', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const secret = 'provider-secret=super-secret;payload={"token":"secret"}';
    const safeService = new NotificationDispatchService(
      prisma as unknown as PrismaService,
      expo as unknown as Expo,
      logger as unknown as StructuredLogger,
    );
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        details: { error: secret },
      },
    ]);
    vi.spyOn(safeService, 'claimNotificationDeliveries').mockResolvedValueOnce([
      makeDelivery() as never,
    ]);

    await safeService.processNotificationDeliveries(
      new Date('2026-09-18T03:00:00.000Z'),
    );

    const logs = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logs).not.toContain(secret);
    expect(logs).toContain('"providerCode":"UNKNOWN"');
  });

  it('does not send already-revoked deliveries and leaves them non-retryable', async () => {
    const delivery = makeDelivery();
    delivery.pushDevice.revokedAt = new Date('2026-09-18T02:59:00.000Z');
    vi.spyOn(service, 'claimNotificationDeliveries').mockResolvedValueOnce([
      delivery as never,
    ]);
    const now = new Date('2026-09-18T03:00:00.000Z');

    await service.processNotificationDeliveries(now);

    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'FAILED',
        nextAttemptAt: now,
        lastError: 'Device revoked',
      },
    });
  });
});
