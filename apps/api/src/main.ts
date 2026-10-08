import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JsonStructuredLogger } from '@imeal/observability';
import { AppModule } from './app.module.js';
import {
  installShutdownHandlers,
  shutdownTimeoutMs,
  ShutdownCoordinator,
} from './common/shutdown-coordinator.js';
import {
  apiStartedFields,
  nestLoggerAdapter,
} from './common/nest-logger.adapter.js';
import {
  API_STRUCTURED_LOGGER,
  apiLogFields,
} from './common/structured-logger.js';
import { validateApiEnvironment } from './config/environment.js';
validateApiEnvironment();

async function bootstrap() {
  // trustProxy stays false. Client identity is resolved by the one-hop helper
  // so Fastify cannot walk a client-supplied X-Forwarded-For chain.
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
  logger.info('api.started', apiStartedFields('0.0.0.0', port));
}

bootstrap();
