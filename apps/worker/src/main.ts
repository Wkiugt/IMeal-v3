import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { nestLoggerAdapter } from './common/nest-logger.adapter.js';
import {
  installShutdownHandlers,
  shutdownTimeoutMs,
  ShutdownCoordinator,
} from './shutdown-coordinator.js';
import {
  WORKER_STRUCTURED_LOGGER,
  workerLogFields,
} from './common/structured-logger.js';
import type { StructuredLogger } from '@imeal/observability';
import { HealthService } from './health.service.js';
import { validateWorkerEnvironment } from './otp-delivery-worker.service.js';
import { validateMetricsEnvironment } from './metrics/metrics-environment.js';
import { WorkerMetricsService } from './metrics/metrics.service.js';

async function bootstrap() {
  validateWorkerEnvironment();
  validateMetricsEnvironment();
  const app = await NestFactory.create(AppModule);
  const logger = app.get<StructuredLogger>(WORKER_STRUCTURED_LOGGER);
  const metrics = app.get(WorkerMetricsService);
  if (metrics.configureWorkerApplicationMetadataFromEnvironment()) {
    metrics.publishWorkerApplicationSnapshot();
  }
  app.useLogger(nestLoggerAdapter(logger));
  const coordinator = app.get(ShutdownCoordinator);
  let resolveListenReady!: () => void;
  let rejectListenReady!: (error: unknown) => void;
  const listenReady = new Promise<void>((resolve, reject) => {
    resolveListenReady = resolve;
    rejectListenReady = reject;
  });
  void listenReady.catch(() => {});
  const disposeShutdownHandlers = installShutdownHandlers(
    app,
    coordinator,
    shutdownTimeoutMs(),
    listenReady,
    () =>
      logger.error(
        'worker.shutdown.close_failed',
        workerLogFields('worker.shutdown.close_failed', {
          errorCode: 'SHUTDOWN_CLOSE_FAILED',
        }),
      ),
  );
  // Listen on 0.0.0.0 for Docker compatibility
  const port = process.env.PORT ?? 3001;
  try {
    await app.listen(port, '0.0.0.0');
    app.get(HealthService).markSchedulerInitialized();
    resolveListenReady();
  } catch (error: unknown) {
    rejectListenReady(error);
    disposeShutdownHandlers();
    throw error;
  }
  logger.info('worker.started', {
    service: 'worker',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event: 'worker.started',
  });
}
bootstrap();
