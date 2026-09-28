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

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [
    PrismaService,
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
