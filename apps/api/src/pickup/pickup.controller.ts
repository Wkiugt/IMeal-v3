import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { PickupService } from './pickup.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@Controller('api/me')
@UseGuards(JwtAuthGuard)
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Get('pickup-options')
  getPickupOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.pickupService.getPickupOptions(user.id);
  }

  @Post('qr')
  generateQr(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { registrationIds?: string[] },
  ) {
    return this.pickupService.generateQr(user.id, body?.registrationIds || []);
  }
}
