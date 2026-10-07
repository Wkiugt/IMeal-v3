import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminAuditService } from './admin-audit.service.js';

@Controller(['v1/admin/audit', 'admin/audit'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('audit.read')
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(v1.AdminAuditQuerySchema))
    query: v1.AdminAuditQuery,
  ) {
    return this.service.list(query);
  }
}
