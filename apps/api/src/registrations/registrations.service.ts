import {
  BadRequestException,
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service.js';
import { v1 } from '@imeal/contracts';
import type { VietnameseLunarDate } from '../common/vietnamese-lunar.js';
import {
  BUSINESS_TIME_ZONE,
  getCutoffInstant,
  parseMealDate,
} from '../common/business-time.js';
import {
  getAvailableMealChoices,
  getVietnameseLunarDate,
} from '../common/vietnamese-lunar.js';

const INVALID_MEAL_DATE_MESSAGE = 'Invalid meal date';
const CUTOFF_PASSED_MESSAGE = 'Cutoff time exceeded';
const MEAL_CHOICE_UNAVAILABLE_MESSAGE =
  'Meal choice is unavailable for this date';
const REGISTRATION_FINALIZED_MESSAGE = 'Registration is finalized';

class RegistrationFinalizedError extends Error {}

class MealChoiceUnavailableError extends Error {}
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
type WeeklyMenuData = {
  id: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
  dailyMenus: Array<{
    id: string;
    weeklyMenuId: string;
    date: Date;
    isHoliday: boolean;
    isEnabled: boolean;
    createdAt: Date;
  }>;
};

@Injectable()
export class RegistrationsService {
  private prisma = new PrismaClient();
  private menuCache = new Map<string, { data: WeeklyMenuData; expiry: number }>();
  private readonly notificationsService: NotificationsService;

  constructor(
    @Optional() notificationsService?: NotificationsService,
  ) {
    this.notificationsService =
      notificationsService ?? new NotificationsService();
  }

  async getWeekData(userId: string, weekStart: string) {
    let startDate: Date;
    try {
      startDate = parseMealDate(weekStart);
    } catch (error: unknown) {
      throw new BadRequestException({
        code: 'INVALID_MEAL_DATE',
        message:
          error instanceof Error ? error.message : INVALID_MEAL_DATE_MESSAGE,
      });
    }

    const mealDates = Array.from({ length: 7 }, (_, index) => {
      const mealDate = new Date(startDate);
      mealDate.setUTCDate(startDate.getUTCDate() + index);
      return mealDate.toISOString().slice(0, 10);
    });

    let lunarDates: VietnameseLunarDate[];
    try {
      lunarDates = mealDates.map((mealDate) =>
        getVietnameseLunarDate(mealDate),
      );
    } catch (error: unknown) {
      throw new BadRequestException({
        code: 'INVALID_MEAL_DATE',
        message:
          error instanceof Error ? error.message : INVALID_MEAL_DATE_MESSAGE,
      });
    }

    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 6);
    const cutoffSetting = await this.getCutoffTime();
    const serverNow = new Date();
    const days = mealDates.map((mealDateKey, index) => {
      const cutoffAt = getCutoffInstant(mealDateKey, cutoffSetting.time);
      return {
        mealDate: mealDateKey,
        cutoffAt: cutoffAt.toISOString(),
        editable: serverNow < cutoffAt,
        lunarDate: lunarDates[index],
        availableMealChoices: getAvailableMealChoices(mealDateKey),
      };
    });

    // 1. Traffic smoothing: Cache the weekly menu to reduce DB queries on Mon morning.
    // Jitter caching: TTL between 15s to 25s
    const cacheKey = `menu_${weekStart}`;
    let menuData: WeeklyMenuData | null = null;
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

    const serializedMenu = menuData
      ? {
          id: menuData.id,
          startDate: menuData.startDate.toISOString().slice(0, 10),
          endDate: menuData.endDate.toISOString().slice(0, 10),
          createdAt: menuData.createdAt.toISOString(),
          updatedAt: menuData.updatedAt.toISOString(),
          dailyMenus: menuData.dailyMenus.map((dailyMenu) => ({
            id: dailyMenu.id,
            weeklyMenuId: dailyMenu.weeklyMenuId,
            date: dailyMenu.date.toISOString().slice(0, 10),
            isHoliday: dailyMenu.isHoliday,
            isEnabled: dailyMenu.isEnabled,
            createdAt: dailyMenu.createdAt.toISOString(),
          })),
        }
      : null;
    const serializedRegistrations = registrations.map((registration) => ({
      id: registration.id,
      mealDate: registration.mealDate.toISOString().slice(0, 10),
      status: registration.status,
      mealChoice:
        'mealChoice' in registration ? registration.mealChoice : undefined,
    }));

    return v1.WeekRegistrationResponseSchema.parse({
      menu: serializedMenu,
      registrations: serializedRegistrations,
      registrationWindow: {
        serverNow: serverNow.toISOString(),
        cutoffAt: days[0].cutoffAt,
        timeZone: BUSINESS_TIME_ZONE,
        days,
      },
    });
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
    items: v1.BatchRegistrationItem[],
  ): Promise<v1.BatchRegistrationResponse> {
    const cutoffSetting = await this.getCutoffTime();
    const cutoffTimeStr = cutoffSetting.time;
    const serverNow = new Date();
    const results: v1.BatchRegistrationResult[] = [];

    // Partial success handling: loop each item independently
    for (const item of items) {
      const mealDateStr = item.mealDate;
      let mealDate: Date;
      try {
        mealDate = parseMealDate(mealDateStr);
        getVietnameseLunarDate(mealDateStr);
      } catch (error: unknown) {
        results.push({
          date: mealDateStr,
          success: false,
          code: 'INVALID_MEAL_DATE',
          reason:
            error instanceof Error ? error.message : INVALID_MEAL_DATE_MESSAGE,
        });
        continue;
      }

      try {
        const cutoffDate = getCutoffInstant(mealDateStr, cutoffTimeStr);
        if (serverNow >= cutoffDate) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'CUTOFF_PASSED',
            reason: CUTOFF_PASSED_MESSAGE,
          });
          continue;
        }

        let transactionAttempt = 0;
        while (true) {
          try {
            await this.prisma.$transaction(async (tx) => {
              let registration = await tx.registration.findUnique({
                where: {
                  userId_mealDate: {
                    userId,
                    mealDate,
                  },
                },
                include: { user: true },
              });

              if (registration) {
                await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
                registration = await tx.registration.findUnique({
                  where: { id: registration.id },
                  include: { user: true },
                });
              }

              if (
                registration &&
                (registration.status === 'SERVED' ||
                  registration.status === 'NO_SHOW')
              ) {
                throw new RegistrationFinalizedError();
              }

              if (
                item.status === 'ACTIVE' &&
                !getAvailableMealChoices(mealDateStr).includes(item.mealChoice)
              ) {
                throw new MealChoiceUnavailableError();
              }

              if (item.status === 'ACTIVE') {
                if (
                  registration &&
                  (registration.status === 'ACTIVE' ||
                    registration.status === 'CANCELLED')
                ) {
                  if (
                    registration.status !== 'ACTIVE' ||
                    registration.mealChoice !== item.mealChoice
                  ) {
                    await tx.registration.update({
                      where: { id: registration.id },
                      data: {
                        status: 'ACTIVE',
                        mealChoice: item.mealChoice,
                        version: { increment: 1 },
                      },
                    });
                  }
                } else {
                  await tx.registration.create({
                    data: {
                      userId,
                      mealDate,
                      status: 'ACTIVE',
                      mealChoice: item.mealChoice,
                      version: 1,
                    },
                  });
                }
              } else if (registration?.status === 'ACTIVE') {
                await tx.registration.update({
                  where: { id: registration.id },
                  data: {
                    status: 'CANCELLED',
                    version: { increment: 1 },
                  },
                });

                const activeDelegations = await tx.pickupDelegation.findMany({
                  where: {
                    registrationId: registration.id,
                    status: { in: ['PENDING', 'ACCEPTED'] },
                  },
                });
                for (const delegation of activeDelegations) {
                  await tx.pickupDelegation.update({
                    where: { id: delegation.id },
                    data: { status: 'REVOKED' },
                  });
                  await tx.auditLog.create({
                    data: {
                      userId,
                      action: 'delegation_revoked',
                      details: `Delegation ${delegation.id} revoked because registration ${registration.id} was cancelled`,
                    },
                  });
                  await this.notificationsService.publish(tx, {
                    userId: delegation.delegateUserId,
                    kind: 'DELEGATION_REVOKED',
                    payload: {
                      delegationId: delegation.id,
                      registrationId: registration.id,
                      mealDate: mealDate.toISOString().slice(0, 10),
                      counterpartName:
                        registration.user.name?.trim() ||
                        registration.user.email?.trim() ||
                        'nhân viên',
                      reason: 'REGISTRATION_CANCELLED',
                    },
                    dedupeKey: `delegation-revoked:${delegation.delegateUserId}:${delegation.id}`,
                  });
                }
              }
            });
            break;
          } catch (error: unknown) {
            if (transactionAttempt === 0 && isUniqueConstraintError(error)) {
              transactionAttempt += 1;
              continue;
            }
            throw error;
          }
        }

        results.push({ date: mealDateStr, success: true });
      } catch (error: unknown) {
        if (error instanceof RegistrationFinalizedError) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'REGISTRATION_FINALIZED',
            reason: REGISTRATION_FINALIZED_MESSAGE,
          });
        } else if (error instanceof MealChoiceUnavailableError) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'MEAL_CHOICE_UNAVAILABLE',
            reason: MEAL_CHOICE_UNAVAILABLE_MESSAGE,
          });
        } else {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'REGISTRATION_FAILED',
            reason:
              error instanceof Error ? error.message : 'Registration failed',
          });
        }
      }
    }

    return v1.BatchRegistrationResponseSchema.parse(results);
  }
}
