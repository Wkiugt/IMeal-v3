import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

export type AllowlistPurpose = 'SESSION_LOGIN';

export interface AllowlistUser {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
}

export interface AllowlistResolution {
  id: string;
  normalizedEmail: string;
  userId: string;
  user: AllowlistUser;
}

@Injectable()
export class AllowlistService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeEmail(email: string): string {
    return email.normalize('NFKC').trim().toLowerCase();
  }

  async findEligible(
    email: string,
    purpose: AllowlistPurpose,
    at: Date = new Date(),
  ): Promise<AllowlistResolution | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const record = await this.prisma.otpAllowlist.findFirst({
      where: {
        normalizedEmail,
        purpose,
        state: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      include: { user: true },
    });

    if (!record || !record.userId || !record.user || !record.user.isActive) {
      return null;
    }

    return {
      id: record.id,
      normalizedEmail: record.normalizedEmail,
      userId: record.userId,
      user: {
        id: record.user.id,
        email: record.user.email,
        name: record.user.name,
        isActive: record.user.isActive,
      },
    };
  }
}
