import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminServingAuditService } from './admin-serving.service.js';

@Controller(['v1/admin/servings', 'admin/servings'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('serving.read')
export class AdminServingAuditController {
  constructor(private readonly service: AdminServingAuditService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(v1.AdminServingAuditQuerySchema))
    query: v1.AdminServingAuditQuery,
  ) {
    return this.service.list(query);
  }
}
