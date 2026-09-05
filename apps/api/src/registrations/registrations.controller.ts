import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common';
import { RegistrationsService } from './registrations.service.js';
import { BatchRegisterDto } from './dto/batch-register.dto.js';
import { CutoffSettingDto } from './dto/cutoff-setting.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@Controller('registrations')
@UseGuards(JwtAuthGuard)
export class RegistrationsController {
  constructor(private readonly service: RegistrationsService) {}

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
    @Body() dto: BatchRegisterDto,
  ) {
    return this.service.batchRegister(user.id, dto.registrations);
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
