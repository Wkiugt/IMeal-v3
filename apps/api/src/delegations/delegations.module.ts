import { Module } from '@nestjs/common';
import { DelegationsController } from './delegations.controller.js';
import { DelegationsService } from './delegations.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [DelegationsController],
  providers: [DelegationsService],
  exports: [DelegationsService],
})
export class DelegationsModule {}
