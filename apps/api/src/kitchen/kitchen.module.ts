import { Module } from '@nestjs/common';
import { KitchenDashboardController } from './kitchen-dashboard.controller.js';
import { KitchenDashboardService } from './kitchen-dashboard.service.js';
import { KitchenEventsService } from './kitchen-events.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [KitchenDashboardController],
  providers: [KitchenDashboardService, KitchenEventsService],
  exports: [KitchenDashboardService, KitchenEventsService],
})
export class KitchenModule {}
