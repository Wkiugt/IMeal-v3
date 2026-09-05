import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PickupWorkerService {
  private readonly logger = new Logger(PickupWorkerService.name);
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  // Frequent cron job to clean up expired pickup_sessions (every 10 seconds)
  @Cron('*/10 * * * * *')
  async cleanupExpiredSessions() {
    this.logger.debug('Cleaning up expired PickupSessions...');
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
        this.logger.log(`Cleaned up ${result.count} expired sessions.`);
      }
    } catch (error) {
      this.logger.error('Failed to clean up expired PickupSessions', error);
    }
  }
}
