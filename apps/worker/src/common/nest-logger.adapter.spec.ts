import type { StructuredLogger } from '@imeal/observability';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { nestLoggerAdapter } from './nest-logger.adapter.js';

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

describe('worker nestLoggerAdapter', () => {
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
      process.env.RELEASE_VERSION = 'rel-worker-nest';
      try {
        const sink = captureLogger();
        const adapter = nestLoggerAdapter(
          sink as unknown as StructuredLogger,
        );
        const write = adapter[level] as (
          message: string,
          context: string,
        ) => void;

        write('Routes mapped', 'RoutesResolver');

        expect(sink[method]).toHaveBeenCalledWith(
          event,
          expect.objectContaining({
            service: 'worker',
            release: 'rel-worker-nest',
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

  it('keeps safe error metadata without recording raw stack data', () => {
    const sink = captureLogger();
    const adapter = nestLoggerAdapter(sink as unknown as StructuredLogger);
    const stack = 'Error: boom\n    at Foo.bar (file.js:1:2)';

    adapter.error('boom', stack, 'ExceptionsHandler');

    expect(sink.error).toHaveBeenCalledWith(
      'nestjs.error',
      expect.objectContaining({
        service: 'worker',
        message: 'boom',
        context: 'ExceptionsHandler',
      }),
    );
    const fields = sink.error.mock.calls[0][1];
    expect(JSON.stringify(fields)).not.toContain('file.js');
    expect(JSON.stringify(fields)).not.toContain('at Foo.bar');
  });

  it('reduces structured messages without evaluating or leaking values', () => {
    const sink = captureLogger();
    const adapter = nestLoggerAdapter(sink as unknown as StructuredLogger);
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
        service: 'worker',
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
