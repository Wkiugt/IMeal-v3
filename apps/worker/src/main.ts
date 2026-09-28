import { NestFactory } from '@nestjs/core';
import type { LoggerService } from '@nestjs/common';
import { AppModule } from './app.module.js';
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
function nestLoggerAdapter(logger: StructuredLogger): LoggerService {
  const fields = (event: string) => ({
    service: 'worker' as const,
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event,
  });
  return {
    log: () => logger.info('nestjs.log', fields('nestjs.log')),
    error: () => logger.error('nestjs.error', fields('nestjs.error')),
    warn: () => logger.warn('nestjs.warn', fields('nestjs.warn')),
    debug: () => logger.debug('nestjs.debug', fields('nestjs.debug')),
    verbose: () => logger.debug('nestjs.verbose', fields('nestjs.verbose')),
    fatal: () => logger.error('nestjs.fatal', fields('nestjs.fatal')),
  };
}

async function bootstrap() {
  validateWorkerEnvironment();
  const app = await NestFactory.create(AppModule);
  const logger = app.get<StructuredLogger>(WORKER_STRUCTURED_LOGGER);
  app.useLogger(nestLoggerAdapter(logger));
  const coordinator = app.get(ShutdownCoordinator);
  installShutdownHandlers(app, coordinator, shutdownTimeoutMs(), () =>
    logger.error(
      'worker.shutdown.close_failed',
      workerLogFields('worker.shutdown.close_failed', {
        errorCode: 'SHUTDOWN_CLOSE_FAILED',
      }),
    ),
  );
  // Listen on 0.0.0.0 for Docker compatibility
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  app.get(HealthService).markSchedulerInitialized();
  logger.info('worker.started', {
    service: 'worker',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event: 'worker.started',
  });
}
bootstrap();
