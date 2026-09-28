import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { v1 } from '@imeal/contracts';

function invalidToken(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_PUSH_TOKEN',
    message: 'Invalid Expo push token',
  });
}

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    token: string,
    platform: v1.PushDevicePlatform,
  ) {
    const parsed = v1.ExpoPushTokenSchema.safeParse(token);
    if (!parsed.success) {
      throw invalidToken();
    }

    const device = await this.prisma.$transaction(async (tx) => {
      const existingDevice = await tx.pushDevice.findUnique({
        where: { token: parsed.data },
        select: { id: true, userId: true },
      });
      if (existingDevice) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${existingDevice.id}, 0))`;
      }
      if (existingDevice && existingDevice.userId !== userId) {
        await tx.notificationDelivery.updateMany({
          where: {
            pushDeviceId: existingDevice.id,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'FAILED',
            lastError: 'DEVICE_REASSIGNED',
          },
        });
      }

      return tx.pushDevice.upsert({
        where: { token: parsed.data },
        update: {
          userId,
          platform: platform === 'ios' ? 'IOS' : 'ANDROID',
          lastSeenAt: new Date(),
          revokedAt: null,
        },
        create: {
          userId,
          token: parsed.data,
          platform: platform === 'ios' ? 'IOS' : 'ANDROID',
          lastSeenAt: new Date(),
        },
        select: { token: true, platform: true, lastSeenAt: true },
      });
    });

    return {
      token: device.token,
      platform: String(device.platform).toLowerCase() as v1.PushDevicePlatform,
      lastSeenAt: device.lastSeenAt.toISOString(),
    };
  }

  async revoke(userId: string, token: string) {
    const parsed = v1.ExpoPushTokenSchema.safeParse(token);
    if (!parsed.success) {
      throw invalidToken();
    }

    await this.prisma.$transaction(async (tx) => {
      const device = await tx.pushDevice.findUnique({
        where: { token: parsed.data },
        select: { id: true, userId: true },
      });
      if (!device || device.userId !== userId) {
        return;
      }

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${device.id}, 0))`;
      const lockedDevice = await tx.pushDevice.findUnique({
        where: { id: device.id },
        select: { userId: true },
      });
      if (!lockedDevice || lockedDevice.userId !== userId) {
        return;
      }
      await tx.pushDevice.update({
        where: { id: device.id },
        data: { revokedAt: new Date() },
      });
    });
    return { token: parsed.data };
  }
}
