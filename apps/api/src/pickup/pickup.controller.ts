import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { PickupService } from './pickup.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

@Controller('api/me')
@UseGuards(SessionGuard)
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Get('pickup-options')
  getPickupOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.pickupService.getPickupOptions(user.id);
  }

  @Post('qr')
  generateQr(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(v1.GenerateQrSchema))
    body: v1.GenerateQrInput,
  ) {
    return this.pickupService.generateQr(user.id, body);
  }
}
