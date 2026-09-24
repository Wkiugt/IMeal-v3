import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { NotificationsService } from './notifications.service.js';
import { PushDevicesService } from './push-devices.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

@UseGuards(SessionGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushDevicesService: PushDevicesService,
  ) {}

  @Get()
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = v1.NotificationListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw badRequest('INVALID_NOTIFICATION_CURSOR', 'Notification cursor is invalid');
    }
    return this.notificationsService.getNotifications(
      user.id,
      parsed.data.cursor,
      parsed.data.limit,
    );
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Patch('preferences')
  async updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = v1.NotificationPreferencesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(
        'INVALID_NOTIFICATION_PREFERENCE',
        'At least one notification preference is required',
      );
    }
    return this.notificationsService.updatePreferences(user.id, parsed.data);
  }

  @Post('push-devices')
  async registerPushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = v1.RegisterPushDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest('INVALID_PUSH_TOKEN', 'Invalid Expo push token');
    }
    const device = await this.pushDevicesService.register(
      user.id,
      parsed.data.token,
      parsed.data.platform,
    );
    return { data: device };
  }

  @Delete('push-devices')
  async revokePushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = v1.RevokePushDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest('INVALID_PUSH_TOKEN', 'Invalid Expo push token');
    }
    const result = await this.pushDevicesService.revoke(user.id, parsed.data.token);
    return { data: result };
  }

  @Get(':id')
  async getNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) id: string,
  ) {
    return this.notificationsService.getNotification(user.id, id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) id: string,
  ) {
    return this.notificationsService.markAsRead(user.id, id);
  }
}
