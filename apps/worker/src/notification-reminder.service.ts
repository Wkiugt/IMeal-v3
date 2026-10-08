import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@imeal/core';
import type { StructuredLogger } from '@imeal/observability';
import { PrismaService } from './common/prisma.service.js';
import { WorkerNotificationPublisher } from './worker-notification-publisher.js';
import {
  createWorkerStructuredLogger,
  workerLogFields,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';
import {
  WORKER_HEALTH_SHUTDOWN_COORDINATOR,
  type WorkerShutdownCoordinatorLike,
} from './health.service.js';
import { WorkerMetricsService } from './metrics/metrics.service.js';
import { jobRunBookkeeping } from './job-run-fields.js';

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
  private readonly logger: StructuredLogger;
  private readonly publisher: WorkerNotificationPublisher;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() publisher?: WorkerNotificationPublisher,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
    @Optional() private readonly metrics?: WorkerMetricsService,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
    this.publisher = publisher ?? new WorkerNotificationPublisher();
  }

  @Cron('0 10 * * 0', { timeZone: TIME_ZONE })
  async handleRegistrationReminderCron() {
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.metrics?.recordWorkerRun('registration_reminder', 'skipped');
      this.logger.info(
        'worker.registration_reminder.skipped',
        workerLogFields('worker.registration_reminder.skipped', {
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return;
    }
    try {
      const result = await this.processRegistrationReminders();
      this.metrics?.recordWorkerRun('registration_reminder', 'success');
      return result;
    } catch (error) {
      this.metrics?.recordWorkerRun('registration_reminder', 'failure');
      throw error;
    } finally {
      release?.();
    }
  }

  @Cron('30 11 * * *', { timeZone: TIME_ZONE })
  async handlePickupReminderCron() {
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.metrics?.recordWorkerRun('pickup_reminder', 'skipped');
      this.logger.info(
        'worker.pickup_reminder.skipped',
        workerLogFields('worker.pickup_reminder.skipped', {
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return;
    }
    try {
      const result = await this.processPickupReminders();
      this.metrics?.recordWorkerRun('pickup_reminder', 'success');
      return result;
    } catch (error) {
      this.metrics?.recordWorkerRun('pickup_reminder', 'failure');
      throw error;
    } finally {
      release?.();
    }
  }

  async processRegistrationReminders(
    now: Date = new Date(),
  ): Promise<ReminderResult> {
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

  async processPickupReminders(
    now: Date = new Date(),
  ): Promise<ReminderResult> {
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
        },
      });

      const grouped = new Map<string, string[]>();
      for (const registration of registrations) {
        const recipient = registration.user;
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
      data: {
        id: randomUUID(),
        jobName,
        status: 'RUNNING',
        ...jobRunBookkeeping({ status: 'RUNNING' }),
      },
      select: { id: true, jobName: true },
    });
    try {
      const result = await this.prisma.$transaction((tx) => work(tx));
      await this.prisma.jobRun.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          ...jobRunBookkeeping({
            status: 'COMPLETED',
            successCount: result.publishedCount,
            failureCount: 0,
          }),
        },
      });
      this.logger.info(
        'worker.notification_reminder.completed',
        workerLogFields('worker.notification_reminder.completed', {
          jobRunId: job.id,
          jobName: job.jobName,
          count: result.publishedCount,
        }),
      );
      return result;
    } catch (error) {
      await this.prisma.jobRun.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          ...jobRunBookkeeping({
            status: 'FAILED',
            successCount: 0,
            failureCount: 1,
            failureCode: 'REMINDER_FAILURE',
          }),
        },
      });
      this.logger.error(
        'worker.notification_reminder.failed',
        workerLogFields('worker.notification_reminder.failed', {
          jobRunId: job.id,
          jobName: job.jobName,
          errorCode: 'REMINDER_FAILURE',
        }),
      );
      throw error;
    }
  }
}
