import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CutoffWorkerService } from './cutoff-worker.service.js';
import { NoShowWorkerService } from './no-show-worker.service.js';
import { WorkerNotificationPublisher } from './worker-notification-publisher.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import { NotificationReminderService } from './notification-reminder.service.js';
import {
  OtpDeliveryWorker,
  WORKER_OTP_PROVIDER,
  WorkerOtpOutboxService,
} from './otp-delivery-worker.service.js';
import { GmailSmtpOtpProvider } from './gmail-smtp-otp-provider.js';
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
  WORKER_METRICS_SOURCE_TRANSPORT,
} from './metrics/authoritative-metrics-runtime.service.js';
import {
  validateMetricsSourceRegistryConfiguration,
  type WorkerMetricsSourceRegistryConfiguration,
} from './metrics/metrics-environment.js';
import {
  createAuthoritativeSourceResolver,
  createAuthoritativeSourceTransport,
  type AuthoritativeSourceTransport,
} from './metrics/sources/authoritative-source-transport.js';
import { createPostgresAuthoritativeSourceProvider } from './metrics/sources/postgres-authoritative-source.provider.js';
import { createObjectStorageAuthoritativeSourceProvider } from './metrics/sources/object-storage-authoritative-source.provider.js';
import { createBackupRestoreAuthoritativeSourceProvider } from './metrics/sources/backup-restore-authoritative-source.provider.js';
import { createSecurityBoundaryAuthoritativeSourceProvider } from './metrics/sources/security-boundary-authoritative-source.provider.js';

function createWorkerMetricsSourceTransport(
  environment: NodeJS.ProcessEnv,
): AuthoritativeSourceTransport {
  let registry: WorkerMetricsSourceRegistryConfiguration;
  try {
    registry = validateMetricsSourceRegistryConfiguration(environment);
  } catch {
    return createAuthoritativeSourceTransport(undefined);
  }
  if (!registry.registryUrl) {
    return createAuthoritativeSourceTransport(undefined);
  }

  return createAuthoritativeSourceTransport(
    createAuthoritativeSourceResolver({
      registryUrl: registry.registryUrl,
      ...(registry.bearerToken ? { accessToken: registry.bearerToken } : {}),
      privateSource: true,
    }),
  );
}

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    AuthoritativeMetricsRuntimeService,
    {
      provide: WORKER_METRICS_RUNTIME_ENVIRONMENT,
      useFactory: () => process.env,
    },
    {
      provide: WORKER_METRICS_SOURCE_TRANSPORT,
      useFactory: (environment: NodeJS.ProcessEnv) =>
        createWorkerMetricsSourceTransport(environment),
      inject: [WORKER_METRICS_RUNTIME_ENVIRONMENT],
    },
    {
      provide: WORKER_METRICS_POSTGRES_SOURCE_PROVIDER,
      useFactory: (
        transport: AuthoritativeSourceTransport,
        environment: NodeJS.ProcessEnv,
      ) =>
        createPostgresAuthoritativeSourceProvider({
          transport,
          targetFingerprint:
            environment.WORKER_METRICS_TARGET_FINGERPRINT?.trim() ?? '',
        }),
      inject: [
        WORKER_METRICS_SOURCE_TRANSPORT,
        WORKER_METRICS_RUNTIME_ENVIRONMENT,
      ],
    },
    {
      provide: WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER,
      useFactory: (
        transport: AuthoritativeSourceTransport,
        environment: NodeJS.ProcessEnv,
      ) =>
        createObjectStorageAuthoritativeSourceProvider({
          transport,
          targetFingerprint:
            environment.WORKER_METRICS_TARGET_FINGERPRINT?.trim() ?? '',
        }),
      inject: [
        WORKER_METRICS_SOURCE_TRANSPORT,
        WORKER_METRICS_RUNTIME_ENVIRONMENT,
      ],
    },
    {
      provide: WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER,
      useFactory: (
        transport: AuthoritativeSourceTransport,
        environment: NodeJS.ProcessEnv,
      ) =>
        createBackupRestoreAuthoritativeSourceProvider({
          transport,
          targetFingerprint:
            environment.WORKER_METRICS_TARGET_FINGERPRINT?.trim() ?? '',
          release: environment.RELEASE_VERSION?.trim() ?? '',
        }),
      inject: [
        WORKER_METRICS_SOURCE_TRANSPORT,
        WORKER_METRICS_RUNTIME_ENVIRONMENT,
      ],
    },
    {
      provide: WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER,
      useFactory: (transport: AuthoritativeSourceTransport) =>
        createSecurityBoundaryAuthoritativeSourceProvider({ transport }),
      inject: [WORKER_METRICS_SOURCE_TRANSPORT],
    },
    {
      provide: WORKER_METRICS_COLLECTOR_SCHEDULER,
      useFactory: () => undefined,
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
    NoShowWorkerService,
    WorkerNotificationPublisher,
    NotificationDispatchService,
    NotificationReminderService,
    WorkerOtpOutboxService,
    {
      provide: GmailSmtpOtpProvider,
      useFactory: () => new GmailSmtpOtpProvider(),
    },
    OtpDeliveryWorker,
    {
      provide: WORKER_OTP_PROVIDER,
      useExisting: GmailSmtpOtpProvider,
    },
  ],
})
export class AppModule {}
