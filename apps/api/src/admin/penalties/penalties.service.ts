import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@imeal/core';
import { PrismaService } from '../../common/prisma.service.js';
import { v1 } from '@imeal/contracts';

type PenaltyWithUser = Prisma.PenaltyGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
}>;

@Injectable()
export class PenaltiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockPenalty(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT id
        FROM penalties
        WHERE id = ${id}
        FOR UPDATE
      `,
    );
  }

  private formatPenalty(item: PenaltyWithUser): v1.PenaltyItemDto {
    return {
      id: item.id,
      userId: item.userId,
      userName: item.user?.name ?? null,
      userEmail: item.user?.email ?? '',
      amount: item.amount,
      reason: item.reason,
      status: item.status as v1.PenaltyStatus,
      paidAt: item.paidAt ? item.paidAt.toISOString() : null,
      waivedAt: item.waivedAt ? item.waivedAt.toISOString() : null,
      waiveReason: item.waiveReason,
      waivedByUserId: item.waivedByUserId,
      registrationId: item.registrationId ?? null,
      mealDate: item.mealDate ? item.mealDate.toISOString().slice(0, 10) : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async getPenalties(
    query: v1.PenaltyListQueryDto,
  ): Promise<v1.PenaltyListResponseDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PenaltyWhereInput = {};

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.search && query.search.trim() !== '') {
      const search = query.search.trim();
      where.OR = [
        { reason: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = query.endDate.includes('T')
          ? new Date(query.endDate)
          : new Date(`${query.endDate}T23:59:59.999Z`);
        where.createdAt.lte = end;
      }
    }

    const metricsWhere: Prisma.PenaltyWhereInput = {};
    if (where.createdAt) {
      metricsWhere.createdAt = where.createdAt;
    }

    const [items, total, pendingAgg, paidAgg, waivedAgg, totalAgg] =
      await Promise.all([
        this.prisma.penalty.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.penalty.count({ where }),
        this.prisma.penalty.aggregate({
          where: { ...metricsWhere, status: 'PENDING' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.penalty.aggregate({
          where: { ...metricsWhere, status: 'PAID' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.penalty.aggregate({
          where: { ...metricsWhere, status: 'WAIVED' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.penalty.aggregate({
          where: metricsWhere,
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

    const formattedItems: v1.PenaltyItemDto[] = items.map((item) =>
      this.formatPenalty(item),
    );

    const metrics: v1.PenaltyMetricsDto = {
      totalInvoiced: totalAgg._sum.amount ?? 0,
      outstandingAmount: pendingAgg._sum.amount ?? 0,
      pendingCount: pendingAgg._count._all ?? 0,
      paidCount: paidAgg._count._all ?? 0,
      waivedCount: waivedAgg._count._all ?? 0,
      paidAmount: paidAgg._sum.amount ?? 0,
      waivedAmount: waivedAgg._sum.amount ?? 0,
    };

    return {
      items: formattedItems,
      metrics,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async markAsPaid(
    id: string,
    adminUserId?: string,
  ): Promise<v1.PenaltyItemDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPenalty(tx, id);
      const penalty = await tx.penalty.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (!penalty) {
        throw new NotFoundException(`Penalty with ID ${id} not found`);
      }

      if (penalty.status !== 'PENDING') {
        throw new BadRequestException(
          `Cannot mark as paid: Penalty is already ${penalty.status}. Only PENDING penalties can transition to PAID.`,
        );
      }

      const now = new Date();
      const updated = await tx.penalty.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: now,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'PENALTY_PAID',
          userId: adminUserId ?? null,
          details: JSON.stringify({
            penaltyId: id,
            targetUserId: penalty.userId,
            amount: penalty.amount,
            paidAt: now.toISOString(),
          }),
        },
      });

      return this.formatPenalty(updated);
    });
  }

  async waivePenalty(
    id: string,
    reason: string,
    adminUserId?: string,
  ): Promise<v1.PenaltyItemDto> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException(
        'Waive reason must be at least 5 characters long',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockPenalty(tx, id);
      const penalty = await tx.penalty.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (!penalty) {
        throw new NotFoundException(`Penalty with ID ${id} not found`);
      }

      if (penalty.status !== 'PENDING') {
        throw new BadRequestException(
          `Cannot waive penalty: Penalty is already ${penalty.status}. Only PENDING penalties can transition to WAIVED.`,
        );
      }

      const now = new Date();
      const trimmedReason = reason.trim();

      const updated = await tx.penalty.update({
        where: { id },
        data: {
          status: 'WAIVED',
          waivedAt: now,
          waiveReason: trimmedReason,
          waivedByUserId: adminUserId ?? null,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'PENALTY_WAIVED',
          userId: adminUserId ?? null,
          details: JSON.stringify({
            penaltyId: id,
            targetUserId: penalty.userId,
            amount: penalty.amount,
            waiveReason: trimmedReason,
            waivedAt: now.toISOString(),
            waivedByUserId: adminUserId ?? null,
          }),
        },
      });

      return this.formatPenalty(updated);
    });
  }
}
