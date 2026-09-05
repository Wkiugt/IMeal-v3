import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { PushTransportService } from './push-transport.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { GetNotificationsQuerySchema } from './dto/get-notifications.dto.js';
import type { GetNotificationsQueryDto } from './dto/get-notifications.dto.js';
import { RegisterPushTokenSchema } from './dto/register-push-token.dto.js';
import type { RegisterPushTokenDto } from './dto/register-push-token.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@UseGuards(JwtAuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushTransportService: PushTransportService,
  ) {}

  @Post('push-token')
  async registerPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RegisterPushTokenSchema))
    body: RegisterPushTokenDto,
  ) {
    try {
      await this.pushTransportService.registerToken(user.id, body.token);
      return { success: true };
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Push token registration failed',
      );
    }
  }

  @Get()
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(GetNotificationsQuerySchema))
    query: GetNotificationsQueryDto,
  ) {
    return this.notificationsService.getNotifications(
      user.id,
      query.page,
      query.limit,
    );
  }

  @Put(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(user.id, id);
  }
}
