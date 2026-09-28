import { Injectable } from '@nestjs/common';
import { PrismaService } from './common/prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<{
    status: 'ok' | 'error';
    db: 'connected' | 'disconnected';
    timestamp: string;
  }> {
    try {
      await this.prisma.$executeRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'error',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
