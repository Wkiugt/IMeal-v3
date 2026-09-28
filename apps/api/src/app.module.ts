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
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { StructuredLogger } from '@imeal/observability';
import {
  API_STRUCTURED_LOGGER,
  createApiStructuredLogger,
} from './common/structured-logger.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { HttpLoggingInterceptor } from './common/http-logging.interceptor.js';
import { RequestIdInterceptor } from './common/request-id.interceptor.js';
import { ShutdownCoordinator } from './common/shutdown-coordinator.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import {
  HEALTH_ENVIRONMENT_VALIDATED,
  HEALTH_SHUTDOWN_COORDINATOR,
} from './health/health.types.js';
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
    ShutdownCoordinator,
    {
      provide: HEALTH_SHUTDOWN_COORDINATOR,
      useExisting: ShutdownCoordinator,
    },
    AppService,
    HealthService,
    { provide: HEALTH_ENVIRONMENT_VALIDATED, useValue: true },
    {
      provide: API_STRUCTURED_LOGGER,
      useFactory: createApiStructuredLogger,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (logger: StructuredLogger, shutdown: ShutdownCoordinator) =>
        new HttpLoggingInterceptor(logger, shutdown),
      inject: [API_STRUCTURED_LOGGER, HEALTH_SHUTDOWN_COORDINATOR],
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
