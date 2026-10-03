import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import {
  CheckInController,
  KitchenCheckInController,
} from './check-in.controller.js';
import { CheckInService } from './check-in.service.js';

@Module({
  imports: [AuthModule, LocationsModule],
  controllers: [CheckInController, KitchenCheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
