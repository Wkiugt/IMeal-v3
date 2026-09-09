import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { PickupService } from './pickup.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@Controller(['internal/api/v1/pickup', 'v1/internal/pickup', 'api/serving'])
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InternalPickupController {
  constructor(private readonly pickupService: PickupService) {}
  @RequirePermission('kitchen.serve')
  @Post('resolve')
  async resolvePickup(@Body() body: { qr?: string; qrPayload?: string }) {
    const qrString = body.qr || body.qrPayload || '';
    return this.pickupService.resolvePickup(qrString);
  }
  @RequirePermission('kitchen.serve')
  @Post('confirm')
  async confirmPickup(
    @Body()
    body: {
      pickupSessionId?: string;
      pickupSessionToken?: string;
      registrationIds?: string[];
      idempotencyKey?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pickupService.confirmPickup(body, user.id);
  }
}
