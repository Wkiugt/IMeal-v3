import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service.js';
import type { UpdateDailyMenuInput } from './dto/weekly-menus.schema.js';
function mealDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function serviceBoundary(
  date: Date,
  utcHour: number,
  utcMinute: number,
): Date {
  return new Date(
    `${mealDate(date)}T${String(utcHour).padStart(2, '0')}:${String(
      utcMinute,
    ).padStart(2, '0')}:00.000Z`,
  );
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

  async updateDailyMenu(
    dateStr: string,
    data: UpdateDailyMenuInput,
    actorUserId: string,
  ) {
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
          revisions: {
            where: { revision: { not: null } },
            orderBy: [{ revision: 'desc' }, { id: 'desc' }],
            take: 1,
          },
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
      const canonicalContentChanged =
        (data.mealName !== undefined &&
          data.mealName !== latestRevision?.mealName) ||
        (data.description !== undefined &&
          data.description !== (latestRevision?.description ?? null)) ||
        (data.imageUrl !== undefined &&
          data.imageUrl !== (latestRevision?.imageUrl ?? null));
      const mealTypeChanged =
        data.mealType !== undefined && data.mealType !== currentMealType;
      const holidayChanged =
        data.isHoliday !== undefined && data.isHoliday !== dailyMenu.isHoliday;
      const enabledChanged =
        data.isEnabled !== undefined && data.isEnabled !== dailyMenu.isEnabled;
      const changed =
        contentChanged ||
        canonicalContentChanged ||
        mealTypeChanged ||
        holidayChanged ||
        enabledChanged;

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

      const mealName = data.mealName?.trim() ?? latestRevision?.mealName?.trim();
      if (!mealName) {
        throw new HttpException(
          'A verified meal name is required before publishing a menu revision',
          HttpStatus.BAD_REQUEST,
        );
      }
      const description =
        data.description !== undefined
          ? data.description
          : (latestRevision?.description ?? null);
      const imageUrl =
        data.imageUrl !== undefined
          ? data.imageUrl
          : (latestRevision?.imageUrl ?? null);
      const revisionNumber = (latestRevision?.revision ?? 0) + 1;
      const revision = await tx.dailyMenuRevision.create({
        data: {
          dailyMenuId: dailyMenu.id,
          revision: revisionNumber,
          mealName,
          description,
          imageUrl,
          createdByUserId: actorUserId,
          content: data.content ?? latestRevision?.content ?? mealName,
        },
      });

      await tx.dailyMenu.update({
        where: { date },
        data: {
          isHoliday: data.isHoliday ?? dailyMenu.isHoliday,
          isEnabled: data.isEnabled ?? dailyMenu.isEnabled,
        },
      });
      await tx.mealDay.updateMany({
        where: { dailyMenuId: dailyMenu.id },
        data: {
          ...(mealTypeChanged
            ? { mealType: data.mealType ?? currentMealType ?? 'LUNCH' }
            : {}),
          menuNameSnapshot: mealName,
          menuDescriptionSnapshot: description,
          menuImageSnapshot: imageUrl,
          lockedAt: publishedAt ? new Date() : null,
          serviceStartAt: serviceBoundary(date, 3, 30),
          serviceEndAt: serviceBoundary(date, 6, 30),
        },
      });

      await this.logAuditTx(
        tx,
        'update_daily_menu',
        `Updated daily menu for ${dateStr}`,
        actorUserId,
      );

      if (publishedAt) {
        await this.updatePublishedRegistrationSnapshots(tx, date, revision);
      }

      return tx.dailyMenu.findUnique({
        where: { date },
        include: { mealDays: true, revisions: true },
      });
    });
  }

  async publishWeeklyMenu(weekStartStr: string, actorUserId: string) {
    const startDate = new Date(weekStartStr);

    return this.prisma.$transaction(async (tx) => {
      const weeklyMenu = await tx.weeklyMenu.findFirst({
        where: { startDate },
        include: {
          dailyMenus: {
            include: {
              revisions: {
                where: { revision: { not: null } },
                orderBy: [{ revision: 'desc' }, { id: 'desc' }],
                take: 1,
              },
              mealDays: true,
            },
          },
        },
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

      const publishedAt = new Date();
      for (const dailyMenu of weeklyMenu.dailyMenus) {
        let revision = dailyMenu.revisions[0];
        if (!revision) {
          throw new HttpException(
            `A verified meal name is required for ${mealDate(dailyMenu.date)}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (revision.revision === null) {
          const mealName = revision.mealName?.trim();
          if (!mealName) {
            throw new HttpException(
              `A verified meal name is required for ${mealDate(dailyMenu.date)}`,
              HttpStatus.BAD_REQUEST,
            );
          }
          revision = await tx.dailyMenuRevision.create({
            data: {
              dailyMenuId: dailyMenu.id,
              revision: 1,
              mealName,
              description: revision.description ?? null,
              imageUrl: revision.imageUrl ?? null,
              createdByUserId: actorUserId,
              content: revision.content || mealName,
            },
          });
        }
        if (!revision.mealName?.trim()) {
          throw new HttpException(
            `A verified meal name is required for ${mealDate(dailyMenu.date)}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        await tx.mealDay.updateMany({
          where: { dailyMenuId: dailyMenu.id },
          data: {
            menuNameSnapshot: revision.mealName.trim(),
            menuDescriptionSnapshot: revision.description ?? null,
            menuImageSnapshot: revision.imageUrl ?? null,
            lockedAt: publishedAt,
            serviceStartAt: serviceBoundary(dailyMenu.date, 3, 30),
            serviceEndAt: serviceBoundary(dailyMenu.date, 6, 30),
          },
        });
        await this.updatePublishedRegistrationSnapshots(tx, dailyMenu.date, revision);
      }

      const published = await tx.weeklyMenu.update({
        where: { id: weeklyMenu.id },
        data: { publishedAt },
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
        actorUserId,
      );
      return published;
    });
  }

  private async updatePublishedRegistrationSnapshots(
    tx: Prisma.TransactionClient,
    date: Date,
    revision: {
      id: string;
      mealName: string | null;
      description: string | null;
      imageUrl: string | null;
    },
  ) {
    const registrations =
      (await tx.registration.findMany({
        where: { mealDate: date, status: 'ACTIVE' },
        include: { mealServing: true, penalties: true },
        orderBy: { id: 'asc' },
      })) ?? [];
    for (const registration of registrations) {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
      if (
        registration.mealServing ||
        registration.noShowAt ||
        registration.penalties.length > 0
      ) {
        continue;
      }
      await tx.registration.update({
        where: { id: registration.id },
        data: {
          menuRevisionId: revision.id,
          menuNameSnapshot: revision.mealName,
          menuDescriptionSnapshot: revision.description,
          menuImageSnapshot: revision.imageUrl,
        },
      });
      await this.logAuditTx(
        tx,
        'registration_menu_revision_updated',
        `Registration ${registration.id} now uses menu revision ${revision.id}`,
      );
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

  private async logAudit(action: string, details: string) {
    await this.prisma.auditLog.create({ data: { action, details } });
  }

  private async logAuditTx(
    tx: Prisma.TransactionClient,
    action: string,
    details: string,
    actorUserId?: string,
  ) {
    await tx.auditLog.create({
      data: {
        action,
        details,
        ...(actorUserId ? { userId: actorUserId } : {}),
      },
    });
  }
}
