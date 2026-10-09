import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsService } from './locations.service.js';
import { LocationsController } from '../admin/locations/locations.controller.js';
import { RosterImportService } from '../admin/roster/roster-import.service.js';
import { AllowlistService } from '../admin/allowlist/allowlist.service.js';
import { RosterController } from '../admin/roster/roster.controller.js';
import { AllowlistController } from '../admin/allowlist/allowlist.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController, RosterController, AllowlistController],
  providers: [LocationsService, RosterImportService, AllowlistService],
  exports: [LocationsService, RosterImportService],
})
export class LocationsModule {}
