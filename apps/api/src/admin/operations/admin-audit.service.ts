import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@imeal/core';
import { v1 } from '@imeal/contracts';
import { PrismaService } from '../../common/prisma.service.js';
import { pageMeta, redactAuditDetails } from './audit-redaction.js';

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RESULT = /^[A-Z][A-Z0-9_]{0,63}$/;
const RESOURCE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function identifierFilter(
  column: 'targetUserId' | 'result' | 'resourceType',
  value: string,
  detailsKey: string,
): Prisma.AuditLogWhereInput {
  return {
    OR: [
      { [column]: value },
      {
        AND: [
          { [column]: null },
          { details: { contains: `"${detailsKey}":"${value}"` } },
        ],
      },
    ],
  };
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: v1.AdminAuditQuery): Promise<v1.AdminAuditListResponse> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('Audit time range is invalid.');
    }
    const filters: Prisma.AuditLogWhereInput[] = [];
    if (query.action) filters.push({ action: query.action });
    if (query.actorUserId) filters.push({ userId: query.actorUserId });
    if (query.targetUserId) {
      filters.push(identifierFilter('targetUserId', query.targetUserId, 'targetUserId'));
    }
    if (query.result) filters.push(identifierFilter('result', query.result, 'result'));
    if (query.resourceType) {
      filters.push(identifierFilter('resourceType', query.resourceType, 'resourceType'));
    }
    if (query.from || query.to) {
      filters.push({
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }
    const where: Prisma.AuditLogWhereInput = filters.length > 0 ? { AND: filters } : {};
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const items: v1.AdminAuditEntry[] = [];
    for (const row of rows) {
      const redacted = redactAuditDetails(row.details);
      const targetUserId =
        (typeof row.targetUserId === 'string' && OPAQUE_ID.test(row.targetUserId)
          ? row.targetUserId
          : null) ?? redacted.targetUserId;
      const result =
        (typeof row.result === 'string' && RESULT.test(row.result) ? row.result : null) ??
        redacted.result;
      const resourceType =
        (typeof row.resourceType === 'string' && RESOURCE.test(row.resourceType)
          ? row.resourceType
          : null) ?? redacted.resourceType;
      const parsed = v1.AdminAuditEntrySchema.safeParse({
        id: row.id,
        action: row.action,
        actorUserId:
          typeof row.userId === 'string' && OPAQUE_ID.test(row.userId) ? row.userId : null,
        targetUserId,
        result,
        resourceType,
        createdAt: row.createdAt.toISOString(),
        details: redacted.details,
        redacted: redacted.redacted,
      });
      if (!parsed.success) {
        throw new Error('Audit row failed safe mapping');
      }
      items.push(parsed.data);
    }
    return { items, pagination: pageMeta(query.page, query.limit, total) };
  }
}
