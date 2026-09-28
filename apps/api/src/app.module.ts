import { Global, Module } from '@nestjs/common';
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
import { LocationsModule } from './locations/locations.module.js';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { HEALTH_ENVIRONMENT_VALIDATED } from './health/health.types.js';
import { PrismaService } from './common/prisma.service.js';

@Global()
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
    LocationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    PrismaService,
    AppService,
    HealthService,
    { provide: HEALTH_ENVIRONMENT_VALIDATED, useValue: true },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
