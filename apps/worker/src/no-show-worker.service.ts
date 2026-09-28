import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, Prisma, type JobRunStatus } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { WorkerNotificationPublisher } from './worker-notification-publisher.js';

export interface ProcessNoShowsOptions {
  force?: boolean;
  currentTime?: Date;
}

type NoShowResult = 'PROCESSED' | 'SKIPPED';

@Injectable()
export class NoShowWorkerService {
  private readonly logger = new Logger(NoShowWorkerService.name);
  private readonly prisma: PrismaClient;
  private readonly notificationPublisher: WorkerNotificationPublisher;

  constructor(
    @Optional() notificationPublisher?: WorkerNotificationPublisher,
  ) {
    this.prisma = new PrismaClient();
    this.notificationPublisher =
      notificationPublisher ?? new WorkerNotificationPublisher();
  }

  private getVietnamTime(now: Date = new Date()) {
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const vnDate = new Date(now.getTime() + vnOffsetMs);
    const year = vnDate.getUTCFullYear();
    const month = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(vnDate.getUTCDate()).padStart(2, '0');
    const todayVnStr = `${year}-${month}-${day}`;
    const currentHour = vnDate.getUTCHours();
    const currentMinute = vnDate.getUTCMinutes();

    return {
      todayVnStr,
      currentHour,
      currentMinute,
    };
  }

  // Daily cron at 13:45 VN time (Asia/Ho_Chi_Minh)
  @Cron('45 13 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleNoShowCron() {
    this.logger.log('Running daily no-show worker at 13:45 VN time');
    try {
      return await this.processNoShows();
    } catch (error) {
      this.logger.error('Error in daily no-show cron execution', error);
      throw error;
    }
  }

  async processNoShows(
    targetDateStr?: string,
    options?: ProcessNoShowsOptions,
  ) {
    const now = options?.currentTime ?? new Date();
    const { todayVnStr, currentHour, currentMinute } = this.getVietnamTime(now);

    if (targetDateStr && !/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
      throw new BadRequestException(
        `Invalid targetDateStr format: ${targetDateStr}. Expected YYYY-MM-DD`,
      );
    }

    const dateStr = targetDateStr || todayVnStr;
    const isBefore1345 =
      currentHour < 13 || (currentHour === 13 && currentMinute < 45);

    if (dateStr === todayVnStr && isBefore1345 && !options?.force) {
      throw new BadRequestException(
        `Cannot process no-shows for today before 13:45 VN time (current VN time: ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}) without force flag`,
      );
    }

    if (dateStr > todayVnStr && !options?.force) {
      throw new BadRequestException(
        `Cannot process future meal date (${dateStr}) no-shows without force flag`,
      );
    }

    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    const candidates = await this.prisma.registration.findMany({
      where: {
        mealDate: targetDate,
        status: 'ACTIVE',
        user: { isActive: true },
        mealServing: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const candidateIds = candidates
      .map((candidate) => candidate.id)
      .sort((left, right) => left.localeCompare(right));

    this.logger.log(
      `Found ${candidateIds.length} active registration candidate(s) for no-show processing on ${dateStr}`,
    );

    let processedCount = 0;
    const failures: unknown[] = [];

    for (const registrationId of candidateIds) {
      try {
        const result = await this.processRegistrationNoShow(
          registrationId,
          dateStr,
          now,
        );
        if (result === 'PROCESSED') {
          processedCount += 1;
        }
      } catch (error) {
        failures.push(error);
        this.logger.error(
          `No-show transaction failed for registration ${registrationId}`,
          error,
        );
      }
    }

    try {
      await this.recordJobRun(
        dateStr,
        failures.length === 0 ? 'COMPLETED' : 'FAILED',
      );
    } catch (error) {
      failures.push(error);
      this.logger.error(`No-show job bookkeeping failed for ${dateStr}`, error);
    }

    if (failures.length > 0) {
      throw failures[0];
    }

    this.logger.log(
      `Successfully completed no-show processing for ${dateStr}. Processed: ${processedCount}/${candidateIds.length}`,
    );

    return {
      success: true,
      dateStr,
      processedCount,
      candidateCount: candidateIds.length,
    };
  }

  private async processRegistrationNoShow(
    registrationId: string,
    dateStr: string,
    now: Date,
  ): Promise<NoShowResult> {
    return this.prisma.$transaction(async (tx) => {
      const lockedRegistration = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT r.id
          FROM registrations AS r
          INNER JOIN users AS u ON u.id = r.user_id
          WHERE r.id = ${registrationId}
          FOR UPDATE OF r, u
        `,
      );

      if (lockedRegistration.length === 0) {
        return 'SKIPPED';
      }

      const registration = await tx.registration.findUnique({
        where: { id: registrationId },
        include: {
          user: { select: { isActive: true } },
          mealServing: true,
        },
      });

      const { currentHour, currentMinute } = this.getVietnamTime(now);
      const eligibleAt1330 =
        currentHour > 13 || (currentHour === 13 && currentMinute >= 30);
      const registrationDate = registration?.mealDate
        .toISOString()
        .slice(0, 10);

      if (
        !registration ||
        registration.status !== 'ACTIVE' ||
        registration.mealServing !== null ||
        registration.user.isActive !== true ||
        registrationDate !== dateStr ||
        !eligibleAt1330
      ) {
        return 'SKIPPED';
      }

      await tx.$queryRaw(
        Prisma.sql`
          SELECT id
          FROM penalties
          WHERE registration_id = ${registrationId}
          FOR UPDATE
        `,
      );
      const existingPenalty = await tx.penalty.findFirst({
        where: { registrationId },
      });

      let penalty = existingPenalty;
      if (penalty) {
        const penaltyDate = penalty.mealDate?.toISOString().slice(0, 10);
        if (
          penalty.userId !== registration.userId ||
          penaltyDate !== dateStr ||
          penalty.amount !== 50000 ||
          penalty.reason !== 'NO_SHOW'
        ) {
          throw new Error(
            `No-show penalty invariant mismatch for registration ${registrationId}`,
          );
        }
      } else {
        penalty = await tx.penalty.create({
          data: {
            id: randomUUID(),
            registrationId,
            userId: registration.userId,
            mealDate: registration.mealDate,
            amount: 50000,
            reason: 'NO_SHOW',
            status: 'PENDING',
          },
        });
      }

      await tx.registration.update({
        where: { id: registrationId },
        data: { status: 'NO_SHOW', noShowAt: now },
      });

      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          action: 'NO_SHOW_PROCESSED',
          userId: registration.userId,
          details: JSON.stringify({
            registrationId,
            mealDate: dateStr,
            amount: 50000,
          }),
        },
      });

      await this.notificationPublisher.publish(tx, {
        userId: registration.userId,
        kind: 'NO_SHOW_PENALTY_CREATED',
        payload: {
          penaltyId: penalty.id,
          registrationId,
          mealDate: dateStr,
          amount: 50000,
        },
        dedupeKey: `no-show-penalty:${registration.userId}:${registrationId}`,
      });

      await tx.outboxEvent.upsert({
        where: { dedupeKey: `kitchen:no-show:${registrationId}` },
        update: {},
        create: {
          id: randomUUID(),
          aggregateType: 'REGISTRATION',
          aggregateId: registrationId,
          eventType: 'NO_SHOW_RECONCILED',
          payload: JSON.stringify({
            registrationId,
            mealDate: dateStr,
            penaltyId: penalty.id,
          }),
          dedupeKey: `kitchen:no-show:${registrationId}`,
        },
      });

      return 'PROCESSED';
    });
  }

  private async recordJobRun(
    dateStr: string,
    status: JobRunStatus,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const jobName = `no_show_worker_${dateStr}`;
      const existingJob = await tx.jobRun.findFirst({
        where: { jobName },
      });

      if (existingJob) {
        await tx.jobRun.update({
          where: { id: existingJob.id },
          data: {
            status,
            completedAt: new Date(),
          },
        });
      } else {
        await tx.jobRun.create({
          data: {
            id: randomUUID(),
            jobName,
            status,
            completedAt: new Date(),
          },
        });
      }
    });
  }
}
