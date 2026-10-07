import { Injectable } from '@nestjs/common';
import { Prisma } from '@imeal/core';
import { v1 } from '@imeal/contracts';
import { parseMealDate } from '../../common/business-time.js';
import { PrismaService } from '../../common/prisma.service.js';
import { pageMeta } from './audit-redaction.js';

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,80}$/;
type ServingRow = {
  id: string;
  servedAt: Date;
  mealDate: Date | null;
  registrationId: string;
  ownerUserId: string | null;
  ownerNameSnapshot: string | null;
  presenterUserId: string | null;
  receiverType: 'SELF' | 'PROXY' | null;
  locationId: string | null;
  locationShortCode: string | null;
  locationNameSnapshot: string | null;
  menuRevisionId: string | null;
  menuNameSnapshot: string | null;
  menuDescriptionSnapshot: string | null;
  checkInSessionId: string | null;
  delegationId: string | null;
  pickupSessionId: string | null;
  registration: {
    status: 'ACTIVE' | 'CANCELLED' | 'SERVED' | 'NO_SHOW';
    employeeCodeSnapshot: string | null;
    ownerNameSnapshot: string | null;
    userId: string;
    serviceLocationAssignment: { employeeCode: string } | null;
    user: { name: string | null } | null;
  };
  ownerUser: { name: string | null } | null;
  presenterUser: { name: string | null } | null;
};

function text(value: string | null | undefined, max = 500): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function id(value: string | null | undefined): string | null {
  return value && OPAQUE_ID.test(value) ? value : null;
}

function mealDate(value: Date | null): string | null {
  if (!value) return null;
  const key = value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

@Injectable()
export class AdminServingAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: v1.AdminServingAuditQuery): Promise<v1.AdminServingAuditResponse> {
    const where: Prisma.MealServingWhereInput = {};
    if (query.mealDate) where.mealDate = parseMealDate(query.mealDate);
    if (query.locationId) where.locationId = query.locationId;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.registrationStatus || query.employeeCode) {
      where.registration = {
        ...(query.registrationStatus ? { status: query.registrationStatus } : {}),
        ...(query.employeeCode
          ? {
              OR: [
                { employeeCodeSnapshot: query.employeeCode },
                {
                  serviceLocationAssignment: {
                    is: { employeeCode: query.employeeCode },
                  },
                },
              ],
            }
          : {}),
      };
    }
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      this.prisma.mealServing.findMany({
        where,
        orderBy: [{ servedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
        select: {
          id: true,
          servedAt: true,
          mealDate: true,
          registrationId: true,
          ownerUserId: true,
          ownerNameSnapshot: true,
          presenterUserId: true,
          receiverType: true,
          locationId: true,
          locationShortCode: true,
          locationNameSnapshot: true,
          menuRevisionId: true,
          menuNameSnapshot: true,
          menuDescriptionSnapshot: true,
          checkInSessionId: true,
          delegationId: true,
          pickupSessionId: true,
          registration: {
            select: {
              status: true,
              employeeCodeSnapshot: true,
              ownerNameSnapshot: true,
              userId: true,
              serviceLocationAssignment: { select: { employeeCode: true } },
              user: { select: { name: true } },
            },
          },
          ownerUser: { select: { name: true } },
          presenterUser: { select: { name: true } },
        },
      }),
      this.prisma.mealServing.count({ where }),
    ]);
    const servingIds = rows.map((row) => row.id);
    const confirmations =
      servingIds.length === 0
        ? []
        : await this.prisma.servingConfirmRequest.findMany({
            where: {
              status: 'SUCCESS',
              resultServingIds: { hasSome: servingIds },
            },
            orderBy: { id: 'asc' },
            select: { id: true, callerUserId: true, resultServingIds: true },
          });
    const actorByServing = new Map<string, string>();
    for (const confirmation of confirmations) {
      for (const servingId of confirmation.resultServingIds) {
        if (!actorByServing.has(servingId)) {
          actorByServing.set(servingId, confirmation.callerUserId);
        }
      }
    }
    const items = (rows as ServingRow[]).map((row) => this.mapRow(row, actorByServing));
    return { items, pagination: pageMeta(query.page, query.limit, total) };
  }

  private mapRow(
    row: ServingRow,
    actorByServing: ReadonlyMap<string, string>,
  ): v1.AdminServingAuditItem {
    const historicalProxy =
      row.receiverType === 'PROXY' ||
      row.delegationId !== null ||
      row.pickupSessionId !== null;
    const authenticatedActorUserId =
      id(actorByServing.get(row.id)) ??
      (row.receiverType === 'SELF' ? id(row.presenterUserId) ?? id(row.ownerUserId) : null);
    const parsed = v1.AdminServingAuditItemSchema.safeParse({
      servingId: row.id,
      servedAt: row.servedAt.toISOString(),
      mealDate: mealDate(row.mealDate),
      registrationId: row.registrationId,
      registrationStatus: row.registration.status,
      ownerUserId: id(row.ownerUserId) ?? id(row.registration.userId),
      ownerName: text(
        row.ownerNameSnapshot ??
          row.registration.ownerNameSnapshot ??
          row.ownerUser?.name ??
          row.registration.user?.name,
      ),
      employeeCode: text(
        row.registration.employeeCodeSnapshot ??
          row.registration.serviceLocationAssignment?.employeeCode,
        64,
      ),
      locationId: id(row.locationId),
      locationShortCode: text(row.locationShortCode, 32),
      locationName: text(row.locationNameSnapshot),
      menuRevisionId: id(row.menuRevisionId),
      menuName: text(row.menuNameSnapshot),
      menuDescription: text(row.menuDescriptionSnapshot),
      checkInSessionId: id(row.checkInSessionId),
      authenticatedActorUserId,
      presenterUserId: id(row.presenterUserId),
      receiverType: row.receiverType,
      delegationId: id(row.delegationId),
      pickupSessionId: id(row.pickupSessionId),
      historicalProxy,
    });
    if (!parsed.success) throw new Error('Serving audit row failed safe mapping');
    return parsed.data;
  }
}
