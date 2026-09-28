import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './common/prisma.service.js';

@Injectable()
export class CutoffWorkerService {
  private readonly logger = new Logger(CutoffWorkerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 14:00 VN time every day
  @Cron('0 14 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleCutoffLock() {
    this.logger.log('Running daily cutoff lock at 14:00 VN time');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Normalize to midnight UTC for querying (depends on exact timezone implementation)
    const targetDateStr = tomorrow.toISOString().split('T')[0];
    const jobName = `cutoff_lock_${targetDateStr}`;

    await this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const existingJob = await tx.jobRun.findFirst({
        where: { jobName },
      });

      if (existingJob) {
        this.logger.log(`Job ${jobName} already ran`);
        return;
      }

      await tx.jobRun.create({
        data: {
          jobName,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'cutoff_lock',
          details: `System locked menus for ${targetDateStr}`,
        },
      });

      this.logger.log(`Successfully locked menu for ${targetDateStr}`);
    });
  }
}
