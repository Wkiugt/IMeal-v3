import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RosterImportService } from './roster-import.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import type { RosterImportBatchInput } from './roster-import.service.js';

const RosterImportRequestSchema = z
  .object({
    source: z.string().trim().min(1),
    rows: z
      .array(
        z
          .object({
            email: z.string(),
            name: z.string(),
            employeeCode: z.string(),
            isActive: z.boolean(),
            role: z.string(),
            serviceLocationCode: z.string(),
            effectiveFrom: z.string(),
            effectiveTo: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

@Controller(['v1/admin/roster', 'admin/roster'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('roster.manage')
export class RosterController {
  constructor(private readonly rosterImportService: RosterImportService) {}

  @Post('preview')
  preview(@Body() body: unknown) {
    const parsed = RosterImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid roster import.',
      });
    }
    return this.rosterImportService.preview(
      parsed.data as RosterImportBatchInput,
    );
  }

  @Post(':batchId/commit')
  commit(
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rosterImportService.commit(batchId, user.id);
  }
}
