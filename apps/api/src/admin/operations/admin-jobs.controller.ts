import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminJobsService } from './admin-jobs.service.js';

@Controller(['v1/admin/jobs', 'admin/jobs'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('jobs.read')
export class AdminJobsController {
  constructor(private readonly service: AdminJobsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(v1.AdminJobsQuerySchema))
    query: v1.AdminJobsQuery,
  ) {
    return this.service.list(query);
  }
}
