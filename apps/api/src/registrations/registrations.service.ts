import {
  BadRequestException,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getCutoffInstant, parseMealDate } from '../common/business-time.js';

@Injectable()
export class RegistrationsService {
  private prisma = new PrismaClient();
  private menuCache = new Map<string, { data: any; expiry: number }>();

  async getWeekData(userId: string, weekStart: string) {
    const startDate = new Date(weekStart);
    if (isNaN(startDate.getTime())) {
      throw new HttpException(
        'Invalid week start date',
        HttpStatus.BAD_REQUEST,
      );
    }
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    // 1. Traffic smoothing: Cache the weekly menu to reduce DB queries on Mon morning.
    // Jitter caching: TTL between 15s to 25s
    const cacheKey = `menu_${weekStart}`;
    let menuData = null;
    const now = Date.now();
    const cached = this.menuCache.get(cacheKey);

    if (cached && cached.expiry > now) {
      menuData = cached.data;
    } else {
      menuData = await this.prisma.weeklyMenu.findFirst({
        where: { startDate },
        include: { dailyMenus: true },
      });
      if (menuData) {
        const jitter = Math.floor(Math.random() * 10000) + 15000; // 15-25s
        this.menuCache.set(cacheKey, { data: menuData, expiry: now + jitter });
      }
    }

    // 2. Fetch user's own registrations (no cache, specific to user)
    const registrations = await this.prisma.registration.findMany({
      where: {
        userId,
        mealDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    return {
      menu: menuData,
      registrations,
    };
  }

  async getCutoffTime(): Promise<{ time: string; version: number }> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: 'CUTOFF_TIME' },
    });
    if (!setting) {
      return { time: '14:00', version: 1 };
    }
    return { time: setting.value, version: setting.version };
  }

  async setCutoffTime(time: string, expectedVersion: number) {
    try {
      getCutoffInstant('2000-01-02', time);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid cutoff time',
      );
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new BadRequestException('Version must be a non-negative integer');
    }

    // Optimistic Concurrency Control
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.appSetting.findUnique({
        where: { key: 'CUTOFF_TIME' },
      });

      if (!existing) {
        return tx.appSetting.create({
          data: {
            key: 'CUTOFF_TIME',
            value: time,
            version: 1,
          },
        });
      }

      const result = await tx.appSetting.updateMany({
        where: { key: 'CUTOFF_TIME', version: expectedVersion },
        data: {
          value: time,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new HttpException(
          'Cutoff setting was updated by another user. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      return { success: true };
    });
  }

  async batchRegister(
    userId: string,
    items: { mealDate: string; status: 'ACTIVE' | 'CANCELLED' }[],
  ) {
    const cutoffSetting = await this.getCutoffTime();
    const cutoffTimeStr = cutoffSetting.time;

    const results = [];

    // Partial success handling: loop each item independently
    for (const item of items) {
      try {
        const mealDateStr = item.mealDate;
        let mealDate: Date;
        try {
          mealDate = parseMealDate(mealDateStr);
        } catch (error: unknown) {
          results.push({
            date: mealDateStr,
            success: false,
            reason:
              error instanceof Error ? error.message : 'Invalid meal date',
          });
          continue;
        }

        const cutoffDate = getCutoffInstant(mealDateStr, cutoffTimeStr);
        const now = new Date();
        if (now >= cutoffDate) {
          results.push({
            date: mealDateStr,
            success: false,
            reason: 'Cutoff time exceeded',
          });
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          if (item.status === 'ACTIVE') {
            await tx.registration.upsert({
              where: {
                userId_mealDate: {
                  userId,
                  mealDate,
                },
              },
              update: {
                status: 'ACTIVE',
                version: { increment: 1 },
              },
              create: {
                userId,
                mealDate,
                status: 'ACTIVE',
                version: 1,
              },
            });
          } else if (item.status === 'CANCELLED') {
            const reg = await tx.registration.findUnique({
              where: {
                userId_mealDate: {
                  userId,
                  mealDate,
                },
              },
              include: { delegations: true },
            });

            if (reg) {
              await tx.registration.update({
                where: { id: reg.id },
                data: {
                  status: 'CANCELLED',
                  version: { increment: 1 },
                },
              });

              // Strict modular boundaries (DDD) using Outbox pattern for delegations cascade
              if (reg.delegations && reg.delegations.length > 0) {
                const payload = JSON.stringify({ registrationId: reg.id });
                await tx.outboxEvent.create({
                  data: {
                    aggregateType: 'REGISTRATION',
                    aggregateId: reg.id,
                    eventType: 'REGISTRATION_CANCELLED',
                    payload,
                  },
                });
              }
            }
          }
        });

        results.push({ date: mealDateStr, success: true });
      } catch (error: unknown) {
        results.push({
          date: item.mealDate,
          success: false,
          reason:
            error instanceof Error ? error.message : 'Registration failed',
        });
      }
    }

    return results;
  }
}
