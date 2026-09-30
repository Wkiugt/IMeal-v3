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
import { PrismaService } from './common/prisma.service.js';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics/metrics.controller.js';
import { WorkerMetricsService } from './metrics/metrics.service.js';
import {
  HealthService,
  WORKER_HEALTH_ENVIRONMENT_VALIDATED,
  WORKER_HEALTH_SHUTDOWN_COORDINATOR,
} from './health.service.js';
import { ShutdownCoordinator } from './shutdown-coordinator.js';
import {
  createWorkerStructuredLogger,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    PrismaService,
    WorkerMetricsService,
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
