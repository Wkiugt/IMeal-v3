import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { CheckInService } from './check-in.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

function hasGpsField(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'gps' in value &&
    value.gps !== undefined &&
    value.gps !== null
  );
}

function validationError(value: unknown): BadRequestException {
  if (!hasGpsField(value)) {
    return new BadRequestException({
      code: 'GPS_REQUIRED',
      message: 'A fresh foreground location is required for check-in.',
    });
  }
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Validation failed.',
  });
}

@Controller('api/me/check-in')
@UseGuards(SessionGuard)
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get()
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.checkInService.getStatus(user);
  }

  @Post('resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = v1.ResolveCheckInSchema.safeParse(body);
    if (!parsed.success) throw validationError(body);
    return this.checkInService.resolve(user, parsed.data);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = v1.ConfirmCheckInSchema.safeParse(body);
    if (!parsed.success) throw validationError(body);
    return this.checkInService.confirm(user, parsed.data);
  }
}

@Controller('api/kitchen/check-in')
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('kitchen.serve')
export class KitchenCheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('qr')
  getQr(
    @CurrentUser() user: AuthenticatedUser,
    @Query('locationId') locationId?: string,
  ) {
    return this.checkInService.getKitchenQr(user, locationId);
  }

  @Get('dashboard')
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.checkInService.getKitchenDashboard(user, date, locationId);
  }
}
