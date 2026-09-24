import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PickupService } from './pickup.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

@Controller(['internal/api/v1/pickup', 'v1/internal/pickup', 'api/serving'])
@UseGuards(SessionGuard, PermissionsGuard)
export class InternalPickupController {
  constructor(private readonly pickupService: PickupService) {}

  @RequirePermission('kitchen.serve')
  @Post('resolve')
  async resolvePickup(
    @Body(new ZodValidationPipe(v1.ResolvePickupSchema))
    body: v1.ResolvePickupInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pickupService.resolvePickup(body, user);
  }

  @RequirePermission('kitchen.serve')
  @Post('confirm')
  async confirmPickup(
    @Body(new ZodValidationPipe(v1.ConfirmPickupSchema))
    body: v1.ConfirmPickupInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pickupService.confirmPickup(body, user);
  }
}
