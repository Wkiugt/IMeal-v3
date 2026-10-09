import { BadRequestException, Injectable } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PrismaService } from '../../common/prisma.service.js';

@Injectable()
export class AllowlistService {
  constructor(private readonly prisma: PrismaService) {}

  async bulkUpsert(
    body: unknown,
    actorId: string,
  ): Promise<v1.AdminAllowlistBulkUpsertResponse> {
    const parsed = v1.AdminAllowlistBulkUpsertRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid allowlist bulk request.',
        details: parsed.error.issues,
      });
    }

    const input = parsed.data;
    const normalizedEmails = [...new Set(input.emails)];
    const duplicateCount = input.emails.length - normalizedEmails.length;
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

    return this.prisma.$transaction(async (tx) => {
      const [users, existingRecords] = await Promise.all([
        tx.user.findMany({
          select: { id: true, email: true },
        }),
        tx.otpAllowlist.findMany({
          where: {
            normalizedEmail: { in: normalizedEmails },
            purpose: 'SESSION_LOGIN',
          },
          select: { id: true, normalizedEmail: true, userId: true },
        }),
      ]);
      const usersByEmail = new Map<string, (typeof users)[number]>();
      const ambiguousEmails = new Set<string>();
      for (const user of users) {
        const normalizedEmail = user.email
          .normalize('NFKC')
          .trim()
          .toLowerCase();
        if (ambiguousEmails.has(normalizedEmail)) continue;
        if (usersByEmail.has(normalizedEmail)) {
          usersByEmail.delete(normalizedEmail);
          ambiguousEmails.add(normalizedEmail);
          continue;
        }
        usersByEmail.set(normalizedEmail, user);
      }
      const existingByEmail = new Map(
        existingRecords.map((record) => [record.normalizedEmail, record]),
      );

      let createdCount = 0;
      let updatedCount = 0;
      let linkedCount = 0;
      let unlinkedCount = 0;
      const items: v1.AdminAllowlistBulkUpsertItem[] = [];

      for (const normalizedEmail of normalizedEmails) {
        const existing = existingByEmail.get(normalizedEmail);
        const matchingUser = usersByEmail.get(normalizedEmail);
        const userId = existing?.userId ?? matchingUser?.id ?? null;
        const outcome = existing ? 'UPDATED' : 'CREATED';
        const userLink = userId ? 'LINKED' : 'UNLINKED';

        await tx.otpAllowlist.upsert({
          where: {
            normalizedEmail_purpose: {
              normalizedEmail,
              purpose: 'SESSION_LOGIN',
            },
          },
          update: {
            userId,
            state: input.state,
            effectiveFrom,
            effectiveTo,
            reason: input.reason ?? null,
            updatedBy: actorId,
          },
          create: {
            normalizedEmail,
            userId,
            state: input.state,
            purpose: 'SESSION_LOGIN',
            effectiveFrom,
            effectiveTo,
            reason: input.reason ?? null,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });

        if (outcome === 'CREATED') createdCount += 1;
        else updatedCount += 1;
        if (userLink === 'LINKED') linkedCount += 1;
        else unlinkedCount += 1;
        items.push({ normalizedEmail, outcome, userLink });
      }

      const result = {
        acceptedCount: normalizedEmails.length,
        createdCount,
        updatedCount,
        linkedCount,
        unlinkedCount,
        duplicateCount,
        items,
      } satisfies v1.AdminAllowlistBulkUpsertResponse;

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'ALLOWLIST_BULK_UPSERTED',
          details: JSON.stringify({
            acceptedCount: result.acceptedCount,
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
            linkedCount: result.linkedCount,
            unlinkedCount: result.unlinkedCount,
            duplicateCount: result.duplicateCount,
          }),
        },
      });

      return result;
    });
  }
}
