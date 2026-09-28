import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { LoggerService } from '@nestjs/common';
import { JsonStructuredLogger } from '@imeal/observability';
import { AppModule } from './app.module.js';
import {
  installShutdownHandlers,
  shutdownTimeoutMs,
  ShutdownCoordinator,
} from './common/shutdown-coordinator.js';
import {
  API_STRUCTURED_LOGGER,
  apiLogFields,
} from './common/structured-logger.js';
import { validateApiEnvironment } from './config/environment.js';
validateApiEnvironment();

function nestLoggerAdapter(logger: JsonStructuredLogger): LoggerService {
  const fields = (event: string) => ({
    service: 'api' as const,
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
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: false }),
  );
  const logger = app.get<JsonStructuredLogger>(API_STRUCTURED_LOGGER);
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
        'api.shutdown.close_failed',
        apiLogFields('api.shutdown.close_failed', {
          errorCode: 'SHUTDOWN_CLOSE_FAILED',
        }),
      ),
  );
  // Listen on 0.0.0.0 for Docker compatibility
  const port = process.env.PORT ?? 3000;
  try {
    await app.listen(port, '0.0.0.0');
    resolveListenReady();
  } catch (error: unknown) {
    rejectListenReady(error);
    disposeShutdownHandlers();
    throw error;
  }
  logger.info('api.started', {
    service: 'api',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event: 'api.started',
  });
}

bootstrap();
