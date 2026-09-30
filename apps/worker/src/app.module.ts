import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CutoffWorkerService } from './cutoff-worker.service.js';
import { PickupWorkerService } from './pickup-worker.service.js';
import { NoShowWorkerService } from './no-show-worker.service.js';
import { WorkerNotificationPublisher } from './worker-notification-publisher.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import { NotificationReminderService } from './notification-reminder.service.js';
import {
  OtpDeliveryWorker,
  WORKER_OTP_PROVIDER,
  WorkerConfiguredOtpProvider,
  WorkerOtpOutboxService,
} from './otp-delivery-worker.service.js';
import {
  WORKER_METRICS_TRANSPORT_TOKEN,
  MetricsController,
} from './metrics/metrics.controller.js';
import { WorkerMetricsService } from './metrics/metrics.service.js';
import {
  HealthService,
  WORKER_HEALTH_ENVIRONMENT_VALIDATED,
  WORKER_HEALTH_SHUTDOWN_COORDINATOR,
} from './health.service.js';
import { PrismaService } from './common/prisma.service.js';
import { HealthController } from './health.controller.js';
import { ShutdownCoordinator } from './shutdown-coordinator.js';
import {
  createWorkerStructuredLogger,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';
import { WORKER_METRICS_TRANSPORT_TOKEN_ENV } from '@imeal/observability';
import {
  AuthoritativeMetricsRuntimeService,
  WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER,
  WORKER_METRICS_COLLECTOR_SCHEDULER,
  WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER,
  WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
  WORKER_METRICS_RUNTIME_ENVIRONMENT,
  WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER,
} from './metrics/authoritative-metrics-runtime.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    AuthoritativeMetricsRuntimeService,
    {
      provide: WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
      useFactory: () => undefined,
    },
    {
      provide: WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER,
      useFactory: () => undefined,
    },
    {
      provide: WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER,
      useFactory: () => undefined,
    },
    {
      provide: WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER,
      useFactory: () => undefined,
    },
    {
      provide: WORKER_METRICS_COLLECTOR_SCHEDULER,
      useFactory: () => undefined,
    },
    {
      provide: WORKER_METRICS_RUNTIME_ENVIRONMENT,
      useFactory: () => process.env,
    },
    PrismaService,
    WorkerMetricsService,
    {
      provide: WORKER_METRICS_TRANSPORT_TOKEN,
      useFactory: () => process.env[WORKER_METRICS_TRANSPORT_TOKEN_ENV],
    },
    HealthService,
    ShutdownCoordinator,
    {
      provide: WORKER_HEALTH_SHUTDOWN_COORDINATOR,
      useExisting: ShutdownCoordinator,
    },
    {
      provide: WORKER_HEALTH_ENVIRONMENT_VALIDATED,
      useValue: true,
    },
    {
      provide: WORKER_STRUCTURED_LOGGER,
      useFactory: createWorkerStructuredLogger,
    },
    AppService,
    CutoffWorkerService,
    PickupWorkerService,
    NoShowWorkerService,
    WorkerNotificationPublisher,
    NotificationDispatchService,
    NotificationReminderService,
    WorkerOtpOutboxService,
    WorkerConfiguredOtpProvider,
    OtpDeliveryWorker,
    {
      provide: WORKER_OTP_PROVIDER,
      useExisting: WorkerConfiguredOtpProvider,
    },
  ],
})
export class AppModule {}
