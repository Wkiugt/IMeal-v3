import { Module } from '@nestjs/common';
import { KitchenEventsService } from './kitchen-events.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [KitchenEventsService],
  exports: [KitchenEventsService],
})
export class KitchenModule {}
