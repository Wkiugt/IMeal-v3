import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { MetricRegistry } from '@imeal/observability';
import {
  API_STRUCTURED_LOGGER,
  createApiStructuredLogger,
} from './common/structured-logger.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import {
  ApiMetricsSourceAdapter,
  createWorkerMetricsHttpAggregator,
} from './common/api-metrics-source.js';
import { ApiMetricsService } from './common/metrics.service.js';
import { HttpLoggingInterceptor } from './common/http-logging.interceptor.js';
import { RequestIdInterceptor } from './common/request-id.interceptor.js';
import { ShutdownCoordinator } from './common/shutdown-coordinator.js';
import {
  API_METRICS_SCHEDULER_ENVIRONMENT,
  ApiMetricsSchedulerService,
} from './common/api-metrics-scheduler.service.js';
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
    ScheduleModule.forRoot(),
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
    {
      provide: MetricRegistry,
      useFactory: () => new MetricRegistry(),
    },
    ApiMetricsService,
    {
      provide: ApiMetricsSourceAdapter,
      useFactory: () =>
        new ApiMetricsSourceAdapter(createWorkerMetricsHttpAggregator()),
    },
    ShutdownCoordinator,
    {
      provide: API_METRICS_SCHEDULER_ENVIRONMENT,
      useFactory: () => process.env,
    },
    ApiMetricsSchedulerService,
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
      useFactory: (
        logger: StructuredLogger,
        shutdown: ShutdownCoordinator,
        metrics: ApiMetricsService,
      ) => new HttpLoggingInterceptor(logger, shutdown, metrics),
      inject: [
        API_STRUCTURED_LOGGER,
        HEALTH_SHUTDOWN_COORDINATOR,
        ApiMetricsService,
      ],
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
  exports: [
    PrismaService,
    MetricRegistry,
    ApiMetricsService,
    ApiMetricsSourceAdapter,
  ],
})
export class AppModule {}
