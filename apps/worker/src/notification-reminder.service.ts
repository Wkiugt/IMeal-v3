import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from './common/prisma.service.js';
import { WorkerNotificationPublisher } from './worker-notification-publisher.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

type ReminderResult = {
  jobName: string;
  publishedCount: number;
};


function vietnamDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number): string {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMondayStart(now: Date): string {
  const today = vietnamDateKey(now);
  const weekday = dateFromKey(today).getUTCDay();
  const daysUntilNextMonday = weekday === 1 ? 7 : (8 - weekday) % 7;
  return addDays(today, daysUntilNextMonday);
}

@Injectable()
export class NotificationReminderService {
  private readonly logger = new Logger(NotificationReminderService.name);
  private readonly publisher: WorkerNotificationPublisher;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() publisher?: WorkerNotificationPublisher,
  ) {
    this.publisher = publisher ?? new WorkerNotificationPublisher();
  }

  @Cron('0 10 * * 0', { timeZone: TIME_ZONE })
  async handleRegistrationReminderCron() {
    return this.processRegistrationReminders();
  }

  @Cron('30 11 * * *', { timeZone: TIME_ZONE })
  async handlePickupReminderCron() {
    return this.processPickupReminders();
  }

  async processRegistrationReminders(now: Date = new Date()): Promise<ReminderResult> {
    const weekStart = nextMondayStart(now);
    const jobName = `registration_reminder_${weekStart}`;
    return this.runJob(jobName, async (tx) => {
      const menu = await tx.weeklyMenu.findUnique({
        where: { startDate: dateFromKey(weekStart) },
        select: {
          endDate: true,
          publishedAt: true,
          dailyMenus: {
            where: { isEnabled: true, isHoliday: false },
            orderBy: { date: 'asc' },
            select: { date: true },
          },
        },
      });
      if (!menu?.publishedAt || menu.dailyMenus.length === 0) {
        return { jobName, publishedCount: 0 };
      }

      const mealDates = menu.dailyMenus.map((dailyMenu) =>
        dailyMenu.date.toISOString().slice(0, 10),
      );
      const users = await tx.user.findMany({
        where: {
          isActive: true,
          remindersEnabled: true,
          userRoles: { some: { role: { name: 'staff' } } },
        },
        select: {
          id: true,
          registrations: {
            where: {
              status: 'ACTIVE',
              mealDate: { in: mealDates.map(dateFromKey) },
            },
            select: { mealDate: true },
          },
        },
      });

      let publishedCount = 0;
      const weekEnd = menu.endDate.toISOString().slice(0, 10);
      for (const user of users) {
        const registeredDates = new Set(
          user.registrations.map((registration) =>
            registration.mealDate.toISOString().slice(0, 10),
          ),
        );
        const remainingMealDates = mealDates.filter(
          (mealDate) => !registeredDates.has(mealDate),
        );
        if (remainingMealDates.length === 0) continue;

        await this.publisher.publish(tx, {
          userId: user.id,
          kind: 'REGISTRATION_REMINDER',
          payload: { weekStart, weekEnd, remainingMealDates },
          dedupeKey: `registration-reminder:${user.id}:${weekStart}`,
        });
        publishedCount += 1;
      }
      return { jobName, publishedCount };
    });
  }

  async processPickupReminders(now: Date = new Date()): Promise<ReminderResult> {
    const mealDate = vietnamDateKey(now);
    const jobName = `pickup_reminder_${mealDate}`;
    return this.runJob(jobName, async (tx) => {
      const registrations = await tx.registration.findMany({
        where: {
          mealDate: dateFromKey(mealDate),
          status: 'ACTIVE',
          mealServing: null,
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          user: { select: { id: true, remindersEnabled: true } },
          delegations: {
            where: { status: 'ACCEPTED' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              delegateUser: { select: { id: true, remindersEnabled: true } },
            },
          },
        },
      });

      const grouped = new Map<string, string[]>();
      for (const registration of registrations) {
        const recipient = registration.delegations[0]?.delegateUser ?? registration.user;
        if (!recipient.remindersEnabled) continue;
        const ids = grouped.get(recipient.id) ?? [];
        ids.push(registration.id);
        grouped.set(recipient.id, ids);
      }

      let publishedCount = 0;
      for (const [userId, registrationIds] of grouped) {
        await this.publisher.publish(tx, {
          userId,
          kind: 'PICKUP_REMINDER',
          payload: {
            mealDate,
            registrationIds,
            registrationCount: registrationIds.length,
          },
          dedupeKey: `pickup-reminder:${userId}:${mealDate}`,
        });
        publishedCount += 1;
      }
      return { jobName, publishedCount };
    });
  }

  private async runJob(
    jobName: string,
    work: (tx: Prisma.TransactionClient) => Promise<ReminderResult>,
  ): Promise<ReminderResult> {
    const job = await this.prisma.jobRun.create({
      data: { id: randomUUID(), jobName, status: 'RUNNING' },
      select: { id: true, jobName: true },
    });
    try {
      const result = await this.prisma.$transaction((tx) => work(tx));
      await this.prisma.jobRun.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return result;
    } catch (error) {
      await this.prisma.jobRun.update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      this.logger.error(`job=${job.jobName} status=FAILED`);
      throw error;
    }
  }
}
