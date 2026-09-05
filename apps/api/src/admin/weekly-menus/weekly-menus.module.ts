import { Module } from '@nestjs/common';
import { WeeklyMenusController } from './weekly-menus.controller.js';
import { WeeklyMenusService } from './weekly-menus.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [WeeklyMenusController],
  providers: [WeeklyMenusService],
})
export class WeeklyMenusModule {}
