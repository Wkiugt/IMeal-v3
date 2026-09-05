import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

export interface ProcessNoShowsOptions {
  force?: boolean;
  currentTime?: Date;
}

@Injectable()
export class NoShowWorkerService {
  private readonly logger = new Logger(NoShowWorkerService.name);
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
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

    // 1. Fetch active registrations without meal serving for targetDate
    const candidates = await this.prisma.registration.findMany({
      where: {
        mealDate: targetDate,
        status: 'ACTIVE',
        mealServing: null,
      },
    });

    this.logger.log(
      `Found ${candidates.length} active registration candidate(s) for no-show processing on ${dateStr}`,
    );

    let processedCount = 0;

    // 2. Transactional processing and idempotency enforcement
    await this.prisma.$transaction(async (tx) => {
      for (const reg of candidates) {
        // Re-verify status = 'ACTIVE' and mealServing is null
        const currentReg = await tx.registration.findUnique({
          where: { id: reg.id },
          include: { mealServing: true },
        });

        if (
          !currentReg ||
          currentReg.status !== 'ACTIVE' ||
          currentReg.mealServing !== null
        ) {
          this.logger.warn(
            `Registration ${reg.id} is no longer eligible for no-show (status: ${currentReg?.status}, served: ${!!currentReg?.mealServing})`,
          );
          continue;
        }

        // Update registration status to NO_SHOW
        await tx.registration.update({
          where: { id: reg.id },
          data: { status: 'NO_SHOW' },
        });

        // Idempotently create Penalty (50,000 VND)
        const penaltyReason = `NO_SHOW_PENALTY_${dateStr}_${reg.id}`;
        const existingPenalty = await tx.penalty.findFirst({
          where: {
            userId: reg.userId,
            reason: penaltyReason,
          },
        });

        if (!existingPenalty) {
          await tx.penalty.create({
            data: {
              userId: reg.userId,
              amount: 50000,
              reason: penaltyReason,
            },
          });
        }

        // Create Notification
        await tx.notification.create({
          data: {
            userId: reg.userId,
            content: `Bạn bị phạt 50.000đ do không nhận suất ăn ngày ${dateStr}.`,
            isRead: false,
          },
        });

        // Create AuditLog
        await tx.auditLog.create({
          data: {
            action: 'NO_SHOW_PROCESSED',
            userId: reg.userId,
            details: JSON.stringify({
              registrationId: reg.id,
              mealDate: dateStr,
              amount: 50000,
            }),
          },
        });

        processedCount++;
      }

      // Creates/updates JobRun
      const jobName = `no_show_worker_${dateStr}`;
      const existingJob = await tx.jobRun.findFirst({
        where: { jobName },
      });

      if (existingJob) {
        await tx.jobRun.update({
          where: { id: existingJob.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      } else {
        await tx.jobRun.create({
          data: {
            jobName,
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      }
    });

    this.logger.log(
      `Successfully completed no-show processing for ${dateStr}. Processed: ${processedCount}/${candidates.length}`,
    );

    return {
      success: true,
      dateStr,
      processedCount,
      candidateCount: candidates.length,
    };
  }
}
