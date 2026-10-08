import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { StructuredLogger } from '@imeal/observability';
import { Prisma, type JobRunStatus } from '@imeal/core';
import { Cron } from '@nestjs/schedule';
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
export interface ProcessNoShowsOptions {
  force?: boolean;
  currentTime?: Date;
}

type NoShowResult = 'PROCESSED' | 'SKIPPED';

@Injectable()
export class NoShowWorkerService {
  private readonly logger: StructuredLogger;
  private readonly notificationPublisher: WorkerNotificationPublisher;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() notificationPublisher?: WorkerNotificationPublisher,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
    @Optional() private readonly metrics?: WorkerMetricsService,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
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
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.metrics?.recordWorkerRun('no_show', 'skipped');
      this.logger.info(
        'worker.no_show.skipped',
        workerLogFields('worker.no_show.skipped', {
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return;
    }
    this.logger.info(
      'worker.no_show.started',
      workerLogFields('worker.no_show.started'),
    );
    try {
      const result = await this.processNoShows();
      this.metrics?.recordWorkerRun('no_show', 'success');
      return result;
    } catch (error: unknown) {
      this.metrics?.recordWorkerRun('no_show', 'failure');
      this.logger.error(
        'worker.no_show.failed',
        workerLogFields('worker.no_show.failed', {
          errorCode: 'JOB_FAILURE',
        }),
      );
      throw error;
    } finally {
      release?.();
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

    this.logger.info(
      'worker.no_show.candidates',
      workerLogFields('worker.no_show.candidates', {
        jobName: `no_show_${dateStr}`,
        count: candidateIds.length,
      }),
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
          'worker.no_show.registration_failed',
          workerLogFields('worker.no_show.registration_failed', {
            jobName: `no_show_${dateStr}`,
            errorCode: 'REGISTRATION_FAILURE',
          }),
        );
      }
    }

    try {
      await this.recordJobRun(dateStr, failures.length === 0 ? 'COMPLETED' : 'FAILED', {
        successCount: processedCount,
        failureCount: failures.length,
        failureCode: failures.length === 0 ? undefined : 'REGISTRATION_FAILURE',
      });
    } catch (error) {
      failures.push(error);
      this.logger.error(
        'worker.no_show.bookkeeping_failed',
        workerLogFields('worker.no_show.bookkeeping_failed', {
          jobName: `no_show_${dateStr}`,
          errorCode: 'BOOKKEEPING_FAILURE',
        }),
      );
    }

    if (failures.length > 0) {
      throw failures[0];
    }

    this.logger.info(
      'worker.no_show.completed',
      workerLogFields('worker.no_show.completed', {
        jobName: `no_show_${dateStr}`,
        count: processedCount,
        total: candidateIds.length,
      }),
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
          WHERE r.id = ${registrationId}
          FOR UPDATE
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
      const eligibleAt1345 =
        currentHour > 13 || (currentHour === 13 && currentMinute >= 45);
      const registrationDate = registration?.mealDate
        .toISOString()
        .slice(0, 10);

      if (
        !registration ||
        registration.status !== 'ACTIVE' ||
        registration.mealServing !== null ||
        registration.user.isActive !== true ||
        registrationDate !== dateStr ||
        !eligibleAt1345
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
    counts: {
      successCount: number;
      failureCount: number;
      failureCode?: string;
    },
  ): Promise<void> {
    const bookkeeping = jobRunBookkeeping({ status, ...counts });
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
            ...bookkeeping,
          },
        });
      } else {
        await tx.jobRun.create({
          data: {
            id: randomUUID(),
            jobName,
            status,
            completedAt: new Date(),
            ...bookkeeping,
          },
        });
      }
    });
  }
}
