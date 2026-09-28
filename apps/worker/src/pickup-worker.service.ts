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

@Injectable()
export class PickupWorkerService {
  private readonly logger: StructuredLogger;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
  }

  // Frequent cron job to clean up expired pickup_sessions (every 10 seconds)
  @Cron('*/10 * * * * *')
  async cleanupExpiredSessions() {
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.logger.debug(
        'worker.pickup.skipped',
        workerLogFields('worker.pickup.skipped', {
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return;
    }
    this.logger.debug(
      'worker.pickup.cleanup_started',
      workerLogFields('worker.pickup.cleanup_started'),
    );
    try {
      const now = new Date();
      const result = await this.prisma.pickupSession.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      });
      if (result.count > 0) {
        this.logger.info(
          'worker.pickup.cleanup_completed',
          workerLogFields('worker.pickup.cleanup_completed', {
            count: result.count,
          }),
        );
      }
    } catch {
      this.logger.error(
        'worker.pickup.cleanup_failed',
        workerLogFields('worker.pickup.cleanup_failed', {
          errorCode: 'DATABASE_ERROR',
        }),
      );
    } finally {
      release?.();
    }
  }
}
