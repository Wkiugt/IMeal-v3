import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DelegationsModule } from './delegations/delegations.module.js';
import { WeeklyMenusModule } from './admin/weekly-menus/weekly-menus.module.js';
import { PenaltiesModule } from './admin/penalties/penalties.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PickupModule } from './pickup/pickup.module.js';
import { KitchenModule } from './kitchen/kitchen.module.js';

@Module({
  imports: [
    AuthModule,
    DelegationsModule,
    WeeklyMenusModule,
    PenaltiesModule,
    RegistrationsModule,
    NotificationsModule,
    PickupModule,
    KitchenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
