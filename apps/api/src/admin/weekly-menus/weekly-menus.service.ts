import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service.js';

function mealDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class WeeklyMenusService {
  private readonly prisma: PrismaClient;

  constructor(private readonly notificationsService: NotificationsService) {
    this.prisma = new PrismaClient();
  }

  async getWeeklyMenus() {
    return this.prisma.weeklyMenu.findMany({
      orderBy: { startDate: 'asc' },
      include: {
        dailyMenus: {
          include: { mealDays: true, revisions: true },
        },
      },
    });
  }

  async createDraft(startDateStr: string) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    await this.logAudit(
      'create_draft',
      `Created draft for week ${startDateStr}`,
    );

    return this.prisma.weeklyMenu.create({
      data: {
        startDate,
        endDate,
        dailyMenus: {
          create: Array.from({ length: 5 }).map((_, i) => {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            return {
              date,
              isHoliday: false,
              isEnabled: true,
              mealDays: { create: { mealType: 'LUNCH' } },
            };
          }),
        },
      },
      include: { dailyMenus: { include: { mealDays: true } } },
    });
  }

  async updateDailyMenu(dateStr: string, data: {
    content?: string;
    mealType?: string;
    isHoliday?: boolean;
    isEnabled?: boolean;
  }) {
    const date = new Date(dateStr);

    return this.prisma.$transaction(async (tx) => {
      const weeklyMenuRef = await tx.weeklyMenu.findFirst({
        where: { dailyMenus: { some: { date } } },
        select: { id: true },
      });
      if (!weeklyMenuRef) {
        throw new HttpException('Daily menu not found', HttpStatus.NOT_FOUND);
      }

      await tx.$queryRaw`SELECT id FROM weekly_menus WHERE id = ${weeklyMenuRef.id} FOR UPDATE`;
      const dailyMenu = await tx.dailyMenu.findUnique({
        where: { date },
        include: {
          weeklyMenu: true,
          revisions: { orderBy: { createdAt: 'desc' }, take: 1 },
          mealDays: true,
        },
      });

      if (!dailyMenu) {
        throw new HttpException('Daily menu not found', HttpStatus.NOT_FOUND);
      }

      const lockedWeeklyMenu = await tx.weeklyMenu.findUnique({
        where: { id: weeklyMenuRef.id },
        select: { publishedAt: true },
      });
      const publishedAt = lockedWeeklyMenu?.publishedAt ?? null;
      const latestRevision = dailyMenu.revisions[0];
      const currentMealType = dailyMenu.mealDays[0]?.mealType;
      const contentChanged =
        data.content !== undefined && data.content !== latestRevision?.content;
      const mealTypeChanged =
        data.mealType !== undefined && data.mealType !== currentMealType;
      const holidayChanged =
        data.isHoliday !== undefined && data.isHoliday !== dailyMenu.isHoliday;
      const enabledChanged =
        data.isEnabled !== undefined && data.isEnabled !== dailyMenu.isEnabled;
      const changed =
        contentChanged || mealTypeChanged || holidayChanged || enabledChanged;

      if (!changed) {
        return dailyMenu;
      }

      if (
        (holidayChanged && data.isHoliday === true) ||
        (enabledChanged && data.isEnabled === false)
      ) {
        const registrations = await tx.registration.findMany({
          where: { mealDate: date, status: 'ACTIVE' },
        });
        if (registrations.length > 0) {
          throw new HttpException(
            'Cannot disable day with active registrations',
            HttpStatus.CONFLICT,
          );
        }
      }

      const revision = await tx.dailyMenuRevision.create({
        data: {
          dailyMenuId: dailyMenu.id,
          content: data.content ?? latestRevision?.content ?? '',
        },
      });

      await tx.dailyMenu.update({
        where: { date },
        data: {
          isHoliday: data.isHoliday ?? dailyMenu.isHoliday,
          isEnabled: data.isEnabled ?? dailyMenu.isEnabled,
        },
      });
      if (mealTypeChanged) {
        await tx.mealDay.updateMany({
          where: { dailyMenuId: dailyMenu.id },
          data: { mealType: data.mealType ?? currentMealType ?? 'LUNCH' },
        });
      }

      await this.logAuditTx(
        tx,
        'update_daily_menu',
        `Updated daily menu for ${dateStr}`,
      );

      if (publishedAt) {
        const registrations = await tx.registration.findMany({
          where: { mealDate: date, status: 'ACTIVE' },
        });
        for (const registration of registrations) {
          await this.notificationsService.publish(tx, {
            userId: registration.userId,
            kind: 'REGISTERED_MENU_CHANGED',
            payload: {
              dailyMenuRevisionId: revision.id,
              mealDate: mealDate(date),
            },
            dedupeKey: `registered-menu-changed:${registration.userId}:${revision.id}`,
          });
        }
      }

      return tx.dailyMenu.findUnique({
        where: { date },
        include: { mealDays: true, revisions: true },
      });
    });
  }

  async publishWeeklyMenu(weekStartStr: string) {
    const startDate = new Date(weekStartStr);

    return this.prisma.$transaction(async (tx) => {
      const weeklyMenu = await tx.weeklyMenu.findFirst({
        where: { startDate },
        include: { dailyMenus: true },
      });
      if (!weeklyMenu) {
        throw new HttpException('Weekly menu not found', HttpStatus.NOT_FOUND);
      }

      await tx.$queryRaw`SELECT id FROM weekly_menus WHERE id = ${weeklyMenu.id} FOR UPDATE`;
      const lockedWeeklyMenu = await tx.weeklyMenu.findUnique({
        where: { id: weeklyMenu.id },
        select: { publishedAt: true },
      });
      if (lockedWeeklyMenu?.publishedAt) {
        return weeklyMenu;
      }

      for (const dailyMenu of weeklyMenu.dailyMenus) {
        const revision = await tx.dailyMenuRevision.findFirst({
          where: { dailyMenuId: dailyMenu.id },
          select: { id: true },
        });
        if (!revision) {
          await tx.dailyMenuRevision.create({
            data: {
              dailyMenuId: dailyMenu.id,
              content: `Revision 1 published`,
            },
          });
        }
      }

      const published = await tx.weeklyMenu.update({
        where: { id: weeklyMenu.id },
        data: { publishedAt: new Date() },
        include: { dailyMenus: true },
      });

      const staff = await tx.user.findMany({
        where: {
          isActive: true,
          userRoles: { some: { role: { name: 'staff' } } },
        },
        select: { id: true, name: true, email: true },
      });
      for (const user of staff) {
        await this.notificationsService.publish(tx, {
          userId: user.id,
          kind: 'REGISTRATION_OPENED',
          payload: {
            weekStart: mealDate(weeklyMenu.startDate),
            weekEnd: mealDate(weeklyMenu.endDate),
          },
          dedupeKey: `registration-opened:${user.id}:${weeklyMenu.id}`,
        });
      }

      await this.logAuditTx(
        tx,
        'publish_weekly_menu',
        `Published weekly menu for ${weekStartStr}`,
      );
      return published;
    });
  }

  private async logAudit(action: string, details: string) {
    await this.prisma.auditLog.create({ data: { action, details } });
  }

  private async logAuditTx(
    tx: Prisma.TransactionClient,
    action: string,
    details: string,
  ) {
    await tx.auditLog.create({ data: { action, details } });
  }
}
