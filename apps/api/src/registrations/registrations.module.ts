import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { KitchenModule } from '../kitchen/kitchen.module.js';

@Module({
  imports: [AuthModule, NotificationsModule, KitchenModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
