import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { PrismaService } from '../common/prisma.service.js';
import {
  serializeEmployeeRegistrationBase,
  toNullableIso,
} from '../common/employee-activity.js';

const selfPenaltySelect = {
  id: true,
  amount: true,
  reason: true,
  status: true,
  mealDate: true,
  createdAt: true,
  paidAt: true,
  waivedAt: true,
  waiveReason: true,
  registration: {
    select: {
      userId: true,
      id: true,
      mealDate: true,
      status: true,
      mealChoice: true,
      menuRevisionId: true,
      menuNameSnapshot: true,
      menuDescriptionSnapshot: true,
      menuImageSnapshot: true,
      serviceLocationId: true,
      serviceLocationAssignmentId: true,
      serviceLocationCode: true,
      serviceLocationName: true,
      serviceLocationAddress: true,
      serviceLocationEffectiveFrom: true,
      serviceLocationSnapshotAt: true,
      registeredAt: true,
      cancelledAt: true,
      noShowAt: true,
      createdAt: true,
      updatedAt: true,
      mealServing: { select: { servedAt: true } },
    },
  },
} satisfies Prisma.PenaltySelect;

type SelfPenaltyRow = Prisma.PenaltyGetPayload<{
  select: typeof selfPenaltySelect;
}>;

type SelfPenaltyRegistration = NonNullable<SelfPenaltyRow['registration']>;

function serializeRegistrationContext(
  registration: SelfPenaltyRegistration | null,
  userId: string,
): v1.SelfPenaltyRegistrationContext | null {
  if (!registration || registration.userId !== userId) return null;
  return serializeEmployeeRegistrationBase(registration);
}

function serializePenalty(
  penalty: SelfPenaltyRow,
  userId: string,
): v1.SelfPenalty {
  return {
    id: penalty.id,
    amount: penalty.amount,
    reason: penalty.reason,
    status: penalty.status,
    mealDate: penalty.mealDate?.toISOString().slice(0, 10) ?? null,
    createdAt: penalty.createdAt.toISOString(),
    paidAt: toNullableIso(penalty.paidAt),
    waivedAt: toNullableIso(penalty.waivedAt),
    waiveReason: penalty.waiveReason,
    registration: serializeRegistrationContext(penalty.registration, userId),
  };
}

@Injectable()
export class EmployeePenaltiesService {
  constructor(private readonly prisma: PrismaService) {}

  async getList(
    userId: string,
    query: v1.SelfPenaltyListQuery,
  ): Promise<v1.SelfPenaltyListResponse> {
    const where: Prisma.PenaltyWhereInput = { userId };
    if (query.status) where.status = query.status;
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      this.prisma.penalty.findMany({
        where,
        select: selfPenaltySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.penalty.count({ where }),
    ]);
    const totalPages = Math.ceil(total / query.limit);
    return {
      data: rows.map((row) => serializePenalty(row, userId)),
      meta: {
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
        },
      },
    };
  }

  async getDetail(
    userId: string,
    id: string,
  ): Promise<v1.SelfPenaltyDetailResponse> {
    const penalty = await this.prisma.penalty.findFirst({
      where: { id, userId },
      select: selfPenaltySelect,
    });
    if (!penalty) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Penalty not found',
      });
    }
    return { data: serializePenalty(penalty, userId) };
  }
}
