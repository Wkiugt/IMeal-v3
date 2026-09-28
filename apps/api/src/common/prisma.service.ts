import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const PRISMA_CONNECT_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private ready = false;

  async onModuleInit(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.$connect(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Prisma connection timed out')),
            PRISMA_CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
      this.ready = true;
      this.logger.log('prisma.connected');
    } catch (error: unknown) {
      this.ready = false;
      this.logger.error('prisma.connection_failed');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
      this.logger.log('prisma.disconnected');
    } finally {
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
