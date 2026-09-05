import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PushTransportService } from './push-transport.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushTransportService],
  exports: [PushTransportService], // Export it so other modules can use it
})
export class NotificationsModule {}
