import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { LoggerService } from '@nestjs/common';
import { JsonStructuredLogger } from '@imeal/observability';
import { AppModule } from './app.module.js';
import { API_STRUCTURED_LOGGER } from './common/structured-logger.js';
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
  // Listen on 0.0.0.0 for Docker compatibility
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.info('api.started', {
    service: 'api',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event: 'api.started',
  });
}

bootstrap();
