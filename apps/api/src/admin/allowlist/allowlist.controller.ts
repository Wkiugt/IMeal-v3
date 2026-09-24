import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SessionGuard } from '../../auth/session.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';

const AllowlistInputSchema = z
  .object({
    email: z.string().trim().email(),
    userId: z.string().min(1).nullable().optional(),
    state: z.enum(['ACTIVE', 'DISABLED']),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}
function emailHash(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!value.endsWith('Z') || !Number.isFinite(date.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Effective dates must be UTC ISO instants.',
    });
  }
  return date;
}

@Controller(['v1/admin/allowlist', 'admin/allowlist'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('allowlist.manage')
export class AllowlistController {
  private readonly prisma = new PrismaClient();

  @Get()
  list() {
    return this.prisma.otpAllowlist.findMany({
      orderBy: { normalizedEmail: 'asc' },
      select: {
        id: true,
        normalizedEmail: true,
        userId: true,
        state: true,
        purpose: true,
        effectiveFrom: true,
        effectiveTo: true,
        reason: true,
        createdBy: true,
        updatedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.save(body, actor.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.save(body, actor.id, id);
  }

  private async save(body: unknown, actorId: string, id?: string) {
    const parsed = AllowlistInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid allowlist record.',
      });
    }
    const normalizedEmail = normalizeEmail(parsed.data.email);
    const effectiveFrom = parseDate(parsed.data.effectiveFrom);
    const effectiveTo = parsed.data.effectiveTo
      ? parseDate(parsed.data.effectiveTo)
      : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException({
        code: 'INVALID_EFFECTIVE_RANGE',
        message: 'Effective end must be after effective start.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const record = id
        ? await tx.otpAllowlist.update({
            where: { id },
            data: {
              normalizedEmail,
              userId: parsed.data.userId ?? null,
              state: parsed.data.state,
              effectiveFrom,
              effectiveTo,
              reason: parsed.data.reason ?? null,
              updatedBy: actorId,
            },
          })
        : await tx.otpAllowlist.upsert({
            where: {
              normalizedEmail_purpose: {
                normalizedEmail,
                purpose: 'SESSION_LOGIN',
              },
            },
            update: {
              userId: parsed.data.userId ?? null,
              state: parsed.data.state,
              effectiveFrom,
              effectiveTo,
              reason: parsed.data.reason ?? null,
              updatedBy: actorId,
            },
            create: {
              normalizedEmail,
              userId: parsed.data.userId ?? null,
              state: parsed.data.state,
              purpose: 'SESSION_LOGIN',
              effectiveFrom,
              effectiveTo,
              reason: parsed.data.reason ?? null,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: id ? 'ALLOWLIST_UPDATED' : 'ALLOWLIST_UPSERTED',
          details: JSON.stringify({
            allowlistId: record.id,
            emailHash: emailHash(normalizedEmail),
            state: parsed.data.state,
          }),
        },
      });
      return record;
    });
  }
}
