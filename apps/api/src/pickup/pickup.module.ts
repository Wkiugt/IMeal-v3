import { Module } from '@nestjs/common';
import { PickupController } from './pickup.controller.js';
import { InternalPickupController } from './internal-pickup.controller.js';
import { PickupService } from './pickup.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { KitchenModule } from '../kitchen/kitchen.module.js';

@Module({
  imports: [AuthModule, KitchenModule],
  controllers: [PickupController, InternalPickupController],
  providers: [PickupService],
  exports: [PickupService],
})
export class PickupModule {}
