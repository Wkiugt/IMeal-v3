import type { LoggerService } from '@nestjs/common';
import { JsonStructuredLogger } from '@imeal/observability';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { apiStartedFields, nestLoggerAdapter } from './nest-logger.adapter.js';

type CapturedLogger = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

function captureLogger(): CapturedLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function restoreRelease(previous: string | undefined) {
  if (previous === undefined) {
    delete process.env.RELEASE_VERSION;
    return;
  }
  process.env.RELEASE_VERSION = previous;
}

describe('nestLoggerAdapter', () => {
  it.each([
    ['log', 'info', 'nestjs.log'],
    ['warn', 'warn', 'nestjs.warn'],
    ['error', 'error', 'nestjs.error'],
    ['debug', 'debug', 'nestjs.debug'],
    ['verbose', 'debug', 'nestjs.verbose'],
    ['fatal', 'error', 'nestjs.fatal'],
  ] as const)(
    '%s keeps the Nest message and context on %s %s',
    (level, method, event) => {
      const previous = process.env.RELEASE_VERSION;
      process.env.RELEASE_VERSION = 'rel-nest';
      try {
        const sink = captureLogger();
        const adapter = nestLoggerAdapter(
          sink as unknown as JsonStructuredLogger,
        );
        const write = adapter[level] as (
          message: string,
          context: string,
        ) => void;

        write('Routes mapped', 'RoutesResolver');

        expect(sink[method]).toHaveBeenCalledWith(
          event,
          expect.objectContaining({
            service: 'api',
            release: 'rel-nest',
            event,
            message: 'Routes mapped',
            context: 'RoutesResolver',
          }),
        );
      } finally {
        restoreRelease(previous);
      }
    },
  );

  it('keeps the error message and handler context when a stack is present', () => {
    const sink = captureLogger();
    const adapter = nestLoggerAdapter(sink as unknown as JsonStructuredLogger);
    const stack = 'Error: boom\n    at Foo.bar (file.js:1:2)';

    adapter.error('boom', stack, 'ExceptionsHandler');

    expect(sink.error).toHaveBeenCalledWith(
      'nestjs.error',
      expect.objectContaining({
        message: 'boom',
        context: 'ExceptionsHandler',
      }),
    );
    const fields = sink.error.mock.calls[0][1];
    expect(fields.context).toBe('ExceptionsHandler');
    expect(JSON.stringify(fields)).not.toContain('file.js');
    expect(JSON.stringify(fields)).not.toContain('at Foo.bar');
  });

  it('does not treat a trailing stack as context', () => {
    const sink = captureLogger();
    const adapter = nestLoggerAdapter(sink as unknown as JsonStructuredLogger);
    const stack = 'Error: boom\n    at Foo.bar (file.js:1:2)';

    adapter.error('boom', stack);

    const fields = sink.error.mock.calls[0][1];
    expect(fields.message).toBe('boom');
    expect(fields.context).toBeUndefined();
    expect(JSON.stringify(fields)).not.toContain('file.js');
  });

  it('reduces Error, function, and object messages without leaking values', () => {
    const sink = captureLogger();
    const adapter = nestLoggerAdapter(sink as unknown as JsonStructuredLogger);
    const secret = 'super-secret-error-detail';
    const error = new Error('connection failed');
    (error as Error & { token: string }).token = secret;
    const called = vi.fn(() => secret);

    adapter.log(error, 'NestFactory');
    adapter.warn(called, 'NestFactory');
    adapter.debug?.({ password: secret }, 'NestFactory');
    adapter.verbose?.([secret], 'NestFactory');

    expect(called).not.toHaveBeenCalled();
    expect(sink.info).toHaveBeenCalledWith(
      'nestjs.log',
      expect.objectContaining({
        message: 'connection failed',
        context: 'NestFactory',
      }),
    );
    expect(sink.warn).toHaveBeenCalledWith(
      'nestjs.warn',
      expect.objectContaining({ message: '[function]' }),
    );
    expect(sink.debug).toHaveBeenNthCalledWith(
      1,
      'nestjs.debug',
      expect.objectContaining({ message: 'Object' }),
    );
    expect(sink.debug).toHaveBeenNthCalledWith(
      2,
      'nestjs.verbose',
      expect.objectContaining({ message: 'Array' }),
    );
    expect(JSON.stringify(sink.info.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(sink.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(sink.debug.mock.calls)).not.toContain(secret);
  });
});

describe('apiStartedFields', () => {
  it('records the numeric bind target and trimmed release', () => {
    const previous = process.env.RELEASE_VERSION;
    process.env.RELEASE_VERSION = ' rel-9 ';
    try {
      const fields = apiStartedFields('0.0.0.0', '3000');

      expect(fields).toMatchObject({
        host: '0.0.0.0',
        port: 3000,
        service: 'api',
        event: 'api.started',
        release: 'rel-9',
      });
      expect(fields.port).toBe(3000);
      expect(fields.message).toContain('0.0.0.0:3000');
      expect(fields.message).toMatch(/listen|bound|start/i);
    } finally {
      restoreRelease(previous);
    }
  });

  it('uses unconfigured when release is blank', () => {
    const previous = process.env.RELEASE_VERSION;
    process.env.RELEASE_VERSION = '   ';
    try {
      const fields = apiStartedFields('0.0.0.0', 3000);

      expect(fields.release).toBe('unconfigured');
      expect(fields.host).toBe('0.0.0.0');
      expect(fields.port).toBe(3000);
      expect(fields.event).toBe('api.started');
      expect(fields.service).toBe('api');
      expect(fields.message).toContain('0.0.0.0:3000');
    } finally {
      restoreRelease(previous);
    }
  });
});

describe('structured startup regression', () => {
  it('emits Nest and api.started lines through JsonStructuredLogger', () => {
    const previous = process.env.RELEASE_VERSION;
    process.env.RELEASE_VERSION = 'rel-bind';
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'rel-bind', (line) =>
      lines.push(line),
    );
    try {
      const adapter: LoggerService = nestLoggerAdapter(logger);
      adapter.log('Nest application successfully started', 'NestApplication');
      logger.info('api.started', apiStartedFields('0.0.0.0', 3000));

      const nestLine = JSON.parse(lines[0]);
      expect(nestLine).toMatchObject({
        event: 'nestjs.log',
        message: 'Nest application successfully started',
        context: 'NestApplication',
        service: 'api',
      });
      const started = JSON.parse(lines[1]);
      expect(started).toMatchObject({
        host: '0.0.0.0',
        port: 3000,
        service: 'api',
        release: 'rel-bind',
        event: 'api.started',
      });
      expect(started.message).toContain('0.0.0.0:3000');
    } finally {
      restoreRelease(previous);
    }
  });
});
