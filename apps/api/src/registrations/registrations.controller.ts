import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { RegistrationsService } from './registrations.service.js';
import { CutoffSettingDto } from './dto/cutoff-setting.dto.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@Controller('api/registrations')
@UseGuards(SessionGuard)
export class RegistrationsController {
  constructor(private readonly service: RegistrationsService) {}
  @Get('history')
  getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(v1.RegistrationHistoryQuerySchema))
    query: v1.RegistrationHistoryQuery,
  ) {
    return this.service.getHistory(user.id, query);
  }

  @Get('stats')
  getStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(v1.RegistrationStatsQuerySchema))
    query: v1.RegistrationStatsQuery,
  ) {
    return this.service.getStats(user.id, query);
  }

  @Get('week')
  getWeekData(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate: string,
  ) {
    return this.service.getWeekData(user.id, startDate);
  }

  @Put('batch')
  batchRegister(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(v1.BatchRegistrationRequestSchema))
    body: v1.BatchRegistrationRequest,
  ) {
    return this.service.batchRegister(user.id, body.registrations);
  }

  @Get('cutoff')
  getCutoff() {
    return this.service.getCutoffTime();
  }

  @Put('cutoff')
  @UseGuards(PermissionsGuard)
  @RequirePermission('registration.cutoff.manage')
  setCutoff(@Body() dto: CutoffSettingDto) {
    return this.service.setCutoffTime(dto.cutoffTime, dto.version);
  }
}
