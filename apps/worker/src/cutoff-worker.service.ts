import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { StructuredLogger } from '@imeal/observability';
import { PrismaService } from './common/prisma.service.js';
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

@Injectable()
export class CutoffWorkerService {
  private readonly logger: StructuredLogger;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
    @Optional() private readonly metrics?: WorkerMetricsService,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
  }

  // 14:00 VN time every day
  @Cron('0 14 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleCutoffLock() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Normalize to midnight UTC for querying (depends on exact timezone implementation)
    const targetDateStr = tomorrow.toISOString().split('T')[0];
    const jobName = `cutoff_lock_${targetDateStr}`;
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.metrics?.recordWorkerRun('cutoff_lock', 'skipped');
      this.logger.info(
        'worker.cutoff.skipped',
        workerLogFields('worker.cutoff.skipped', {
          jobName,
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return;
    }
    let status: 'success' | 'skipped' = 'success';
    try {
      this.logger.info(
        'worker.cutoff.started',
        workerLogFields('worker.cutoff.started', { jobName }),
      );

      await this.prisma.$transaction(async (tx) => {
        // Idempotency check
        const existingJob = await tx.jobRun.findFirst({
          where: { jobName },
        });

        if (existingJob) {
          status = 'skipped';
          this.logger.info(
            'worker.cutoff.skipped',
            workerLogFields('worker.cutoff.skipped', { jobName }),
          );
          return;
        }

        await tx.jobRun.create({
          data: {
            jobName,
            status: 'COMPLETED',
            completedAt: new Date(),
            ...jobRunBookkeeping({
              status: 'COMPLETED',
              successCount: 1,
              failureCount: 0,
            }),
          },
        });

        await tx.auditLog.create({
          data: {
            action: 'cutoff_lock',
            details: `System locked menus for ${targetDateStr}`,
          },
        });

        this.logger.info(
          'worker.cutoff.completed',
          workerLogFields('worker.cutoff.completed', { jobName }),
        );
      });
      this.metrics?.recordWorkerRun('cutoff_lock', status);
    } catch (error) {
      this.metrics?.recordWorkerRun('cutoff_lock', 'failure');
      throw error;
    } finally {
      release?.();
    }
  }
}
