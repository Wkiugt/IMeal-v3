import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { EmployeePenaltiesService } from './employee-penalties.service.js';

@Controller('api/penalties')
@UseGuards(SessionGuard)
export class EmployeePenaltiesController {
  constructor(private readonly service: EmployeePenaltiesService) {}

  @Get()
  getList(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(v1.SelfPenaltyListQuerySchema))
    query: v1.SelfPenaltyListQuery,
  ) {
    return this.service.getList(user.id, query);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getDetail(user.id, id);
  }
}
