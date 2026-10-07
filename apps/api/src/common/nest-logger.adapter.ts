import type { LoggerService } from '@nestjs/common';
import { JsonStructuredLogger, type SafeLogFields } from '@imeal/observability';

const NEST_STACK_FORMAT = /^(.)+\n\s+at .+:\d+:\d+/;

type NestLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal';
type StructuredMethod = 'debug' | 'info' | 'warn' | 'error';

const NEST_EVENTS: Record<
  NestLevel,
  { method: StructuredMethod; event: string }
> = {
  log: { method: 'info', event: 'nestjs.log' },
  warn: { method: 'warn', event: 'nestjs.warn' },
  error: { method: 'error', event: 'nestjs.error' },
  debug: { method: 'debug', event: 'nestjs.debug' },
  verbose: { method: 'debug', event: 'nestjs.verbose' },
  fatal: { method: 'error', event: 'nestjs.fatal' },
};

function nestMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return typeof value.message === 'string' ? value.message : undefined;
  }
  if (typeof value === 'function') return '[function]';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object' && value !== null) return 'Object';
  return undefined;
}

function nestContext(optionalParams: readonly unknown[]): string | undefined {
  const last = optionalParams[optionalParams.length - 1];
  if (typeof last !== 'string' || NEST_STACK_FORMAT.test(last)) {
    return undefined;
  }
  return last;
}

function nestFields(
  event: string,
  message: unknown,
  optionalParams: readonly unknown[],
): SafeLogFields {
  const fields: SafeLogFields = {
    service: 'api',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event,
  };
  const reduced = nestMessage(message);
  if (reduced !== undefined) fields.message = reduced;
  const context = nestContext(optionalParams);
  if (context !== undefined) fields.context = context;
  return fields;
}

export function nestLoggerAdapter(logger: JsonStructuredLogger): LoggerService {
  const write =
    (level: NestLevel) =>
    (message: unknown, ...optionalParams: unknown[]) => {
      const target = NEST_EVENTS[level];
      logger[target.method](
        target.event,
        nestFields(target.event, message, optionalParams),
      );
    };

  return {
    log: write('log'),
    warn: write('warn'),
    error: write('error'),
    debug: write('debug'),
    verbose: write('verbose'),
    fatal: write('fatal'),
  };
}

function coerceBoundPort(port: string | number): number | undefined {
  const value =
    typeof port === 'number'
      ? port
      : /^[0-9]+$/.test(port)
        ? Number(port)
        : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > 65535) return undefined;
  return value;
}

export function apiStartedFields(
  host: string,
  port: string | number,
): SafeLogFields {
  const boundPort = coerceBoundPort(port);
  const fields: SafeLogFields = {
    service: 'api',
    release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
    event: 'api.started',
    host,
    message:
      boundPort === undefined
        ? 'API listening'
        : `API listening on ${host}:${boundPort}`,
  };
  if (boundPort !== undefined) fields.port = boundPort;
  return fields;
}
