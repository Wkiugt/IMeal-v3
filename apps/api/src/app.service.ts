import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AppService {
  private prisma = new PrismaClient();

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<any> {
    try {
      // Execute a simple query to verify DB connectivity
      await this.prisma.$executeRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: 'error',
        db: 'disconnected',
        error: error?.message || String(error),
      };
    }
  }
}
