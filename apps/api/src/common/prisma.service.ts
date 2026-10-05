import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createPrismaAdapter, PrismaClient } from '@imeal/core';

const PRISMA_CONNECT_TIMEOUT_MS = 10_000;

const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;
const MAX_SHUTDOWN_TIMEOUT_SECONDS = 300;

function shutdownTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SHUTDOWN_TIMEOUT_SECONDS?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return DEFAULT_SHUTDOWN_TIMEOUT_SECONDS * 1000;
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds)) {
    return DEFAULT_SHUTDOWN_TIMEOUT_SECONDS * 1000;
  }
  return Math.min(Math.max(seconds, 1), MAX_SHUTDOWN_TIMEOUT_SECONDS) * 1000;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  constructor() {
    super({
      adapter: createPrismaAdapter(process.env.DATABASE_URL ?? ''),
    });
  }
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
    this.ready = false;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.$disconnect(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Prisma disconnection timed out')),
            shutdownTimeoutMs(),
          );
        }),
      ]);
      this.logger.log('prisma.disconnected');
    } catch {
      this.logger.error('prisma.disconnect_failed');
    } finally {
      clearTimeout(timeout);
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
