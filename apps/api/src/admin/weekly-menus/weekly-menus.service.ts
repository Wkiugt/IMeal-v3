import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PushTransportService } from '../../notifications/push-transport.service.js';

@Injectable()
export class WeeklyMenusService {
  private prisma: PrismaClient;

  constructor(private readonly pushService: PushTransportService) {
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
    endDate.setDate(startDate.getDate() + 6); // Sunday

    // Audit log placeholder (userId would come from request context, but we simplify here or mock)
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
            date.setDate(startDate.getDate() + i); // Mon to Fri
            return {
              date,
              isHoliday: false,
              isEnabled: true,
              mealDays: {
                create: {
                  mealType: 'LUNCH', // Exactly one meal per day
                },
              },
            };
          }),
        },
      },
      include: { dailyMenus: { include: { mealDays: true } } },
    });
  }

  async updateDailyMenu(dateStr: string, data: any) {
    const date = new Date(dateStr);

    return this.prisma.$transaction(async (tx) => {
      const dailyMenu = await tx.dailyMenu.findUnique({
        where: { date },
        include: { weeklyMenu: true },
      });

      if (!dailyMenu) {
        throw new HttpException('Daily menu not found', HttpStatus.NOT_FOUND);
      }

      if (data.isHoliday || data.isEnabled === false) {
        // Prevent unpublish if active registrations exist
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

      await this.logAuditTx(
        tx,
        'update_daily_menu',
        `Updated daily menu for ${dateStr}`,
      );

      return tx.dailyMenu.update({
        where: { date },
        data: {
          isHoliday: data.isHoliday ?? dailyMenu.isHoliday,
          isEnabled: data.isEnabled ?? dailyMenu.isEnabled,
          revisions: data.content
            ? {
                create: { content: data.content },
              }
            : undefined,
        },
      });
    });
  }

  async publishWeeklyMenu(weekStartStr: string) {
    const startDate = new Date(weekStartStr);
    const notificationsToSend: { userId: string; message: string }[] = [];

    const weeklyMenu = await this.prisma.$transaction(async (tx) => {
      const weeklyMenu = await tx.weeklyMenu.findFirst({
        where: { startDate },
        include: { dailyMenus: true },
      });

      if (!weeklyMenu) {
        throw new HttpException('Weekly menu not found', HttpStatus.NOT_FOUND);
      }

      for (const dm of weeklyMenu.dailyMenus) {
        // Create revision 1 if none exists, else create new revision
        const existingRevs = await tx.dailyMenuRevision.count({
          where: { dailyMenuId: dm.id },
        });

        await tx.dailyMenuRevision.create({
          data: {
            dailyMenuId: dm.id,
            content: `Revision ${existingRevs + 1} published`,
          },
        });

        // Pre-cutoff registrations preservation & notification
        // Find existing registrations for this date
        const regs = await tx.registration.findMany({
          where: { mealDate: dm.date, status: 'ACTIVE' },
        });

        for (const reg of regs) {
          const message = `Menu for ${dm.date.toISOString()} has been updated/published.`;
          await tx.notification.create({
            data: {
              userId: reg.userId,
              content: message,
            },
          });
          notificationsToSend.push({ userId: reg.userId, message });
        }
      }

      await this.logAuditTx(
        tx,
        'publish_weekly_menu',
        `Published weekly menu for ${weekStartStr}`,
      );
      return weeklyMenu;
    });

    // Send push outside the transaction
    for (const notif of notificationsToSend) {
      await this.pushService
        .sendPushNotification(notif.userId, 'Menu Update', notif.message)
        .catch((e) => {
          // Handled gracefully in pushService, but catch here just in case
          console.error('Push error:', e);
        });
    }

    return weeklyMenu;
  }

  private async logAudit(action: string, details: string) {
    await this.prisma.auditLog.create({
      data: { action, details },
    });
  }

  private async logAuditTx(tx: any, action: string, details: string) {
    await tx.auditLog.create({
      data: { action, details },
    });
  }
}
