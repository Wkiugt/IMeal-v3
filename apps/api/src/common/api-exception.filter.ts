import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  sanitizeLogText,
  type StructuredLogger,
} from '@imeal/observability';
import { v1 } from '@imeal/contracts';
import { API_STRUCTURED_LOGGER, apiLogFields } from './structured-logger.js';
import { SERVICE_UNAVAILABLE_MESSAGE } from './api-error-messages.js';
import {
  firstHeader,
  requestIdFromRequest,
  setResponseRequestId,
  type RequestContextRequest,
} from './request-context.js';

type RequestLike = RequestContextRequest;

type ReplyLike = {
  header(name: string, value: string): ReplyLike;
  status(code: number): ReplyLike;
  send(body: unknown): void;
};

type ExceptionBody = {
  code?: unknown;
  errorCode?: unknown;
  message?: unknown;
  details?: unknown;
};

const CANONICAL_MESSAGES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]:
    'The provided information is not valid. Please check it and try again.',
  [HttpStatus.UNAUTHORIZED]:
    'Your session is no longer valid. Please sign in again.',
  [HttpStatus.FORBIDDEN]:
    'You do not have permission to perform this action.',
  [HttpStatus.NOT_FOUND]: 'The requested information could not be found.',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'This action is currently unavailable.',
  [HttpStatus.REQUEST_TIMEOUT]: 'The request took too long. Please try again.',
  [HttpStatus.CONFLICT]:
    'The information has changed. Please refresh and try again.',
  [HttpStatus.GONE]: 'This information is no longer available.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'The submitted data is too large.',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]:
    'This file or data format is not supported.',
  [HttpStatus.UNPROCESSABLE_ENTITY]:
    'Some provided information could not be accepted. Please check it and try again.',
  [HttpStatus.TOO_MANY_REQUESTS]:
    'Too many attempts were made. Please wait a moment and try again.',
  [HttpStatus.INTERNAL_SERVER_ERROR]:
    'Something went wrong on our side. Please try again later.',
  [HttpStatus.NOT_IMPLEMENTED]: 'This feature is currently unavailable.',
  [HttpStatus.BAD_GATEWAY]:
    'A connected service is currently having problems. Please try again later.',
  [HttpStatus.SERVICE_UNAVAILABLE]: SERVICE_UNAVAILABLE_MESSAGE,
  [HttpStatus.GATEWAY_TIMEOUT]:
    'A connected service is taking too long to respond. Please try again later.',
};

const UNKNOWN_CLIENT_ERROR_MESSAGE =
  'The request could not be completed. Please check the information and try again.';
const UNKNOWN_SERVER_ERROR_MESSAGE =
  'The service is temporarily experiencing a problem. Please try again later.';
const DEFAULT_CLIENT_ERROR_MESSAGE = 'The request could not be processed.';
const DEFAULT_SERVER_ERROR_MESSAGE = 'Internal server error.';

function genericMessage(status: number): string {
  const canonicalMessage = CANONICAL_MESSAGES[status];
  if (canonicalMessage) return canonicalMessage;
  if (status >= 400 && status < 500) return UNKNOWN_CLIENT_ERROR_MESSAGE;
  if (status >= 500 && status < 600) return UNKNOWN_SERVER_ERROR_MESSAGE;
  return status >= HttpStatus.INTERNAL_SERVER_ERROR
    ? DEFAULT_SERVER_ERROR_MESSAGE
    : DEFAULT_CLIENT_ERROR_MESSAGE;
}

function defaultErrorCode(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.METHOD_NOT_ALLOWED) return 'METHOD_NOT_ALLOWED';
  if (status === HttpStatus.REQUEST_TIMEOUT) return 'REQUEST_TIMEOUT';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.GONE) return 'GONE';
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) return 'PAYLOAD_TOO_LARGE';
  if (status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) {
    return 'UNSUPPORTED_MEDIA_TYPE';
  }
  if (status === HttpStatus.UNPROCESSABLE_ENTITY) {
    return 'UNPROCESSABLE_ENTITY';
  }
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  if (status === HttpStatus.NOT_IMPLEMENTED) return 'NOT_IMPLEMENTED';
  if (status === HttpStatus.BAD_GATEWAY) return 'BAD_GATEWAY';
  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return 'SERVICE_UNAVAILABLE';
  }
  if (status === HttpStatus.GATEWAY_TIMEOUT) return 'GATEWAY_TIMEOUT';
  if (status >= HttpStatus.BAD_REQUEST && status < HttpStatus.INTERNAL_SERVER_ERROR) {
    return 'BAD_REQUEST';
  }
  return 'INTERNAL_SERVER_ERROR';
}

function selectErrorCode(status: number, ...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      Object.hasOwn(v1.PUBLIC_ERROR_CODES, candidate)
    ) {
      return candidate;
    }
  }
  return defaultErrorCode(status);
}


function normalizeRoute(request: RequestLike): string {
  const routeValue =
    typeof request.routeOptions?.url === 'string'
      ? request.routeOptions.url
      : typeof request.route?.path === 'string'
        ? request.route.path
        : typeof request.url === 'string'
          ? request.url
          : '/';
  const path = routeValue.split('?')[0];
  return path || '/';
}

function normalizePath(request: RequestLike): string {
  const pathValue =
    typeof request.url === 'string'
      ? request.url
      : typeof request.routeOptions?.url === 'string'
        ? request.routeOptions.url
        : typeof request.route?.path === 'string'
          ? request.route.path
          : '/';
  const path = pathValue.split('?')[0];
  return path || '/';
}

const STACK_MAX_LENGTH = 4096;

function unexpectedServerDiagnostics(
  exception: unknown,
): { message?: string; stack?: string } {
  if (!(exception instanceof Error)) return {};
  const cause =
    typeof exception.cause === 'string'
      ? exception.cause
      : exception.cause instanceof Error
        ? exception.cause.message
        : undefined;
  const message = [exception.message, cause]
    .filter((value): value is string => Boolean(value))
    .join('; cause: ');
  return {
    ...(message ? { message: sanitizeLogText(message) } : {}),
    ...(exception.stack
      ? { stack: sanitizeLogText(exception.stack, STACK_MAX_LENGTH) }
      : {}),
  };
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional()
    @Inject(API_STRUCTURED_LOGGER)
    private readonly logger?: StructuredLogger,
  ) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike | null | undefined>() ?? {};
    const reply = http.getResponse<ReplyLike>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const serverError =
      status >= HttpStatus.INTERNAL_SERVER_ERROR && status < 600;
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body: ExceptionBody =
      response && typeof response === 'object' && !Array.isArray(response)
        ? response
        : {};
    const id = resolveRequestId(
      requestIdFromRequest(request) ??
        firstHeader(request.headers, REQUEST_ID_HEADER),
    );
    request.requestId = id;
    const code = selectErrorCode(status, body.errorCode, body.code);
    const message = genericMessage(status);
    const publicMessageValue =
      status === HttpStatus.SERVICE_UNAVAILABLE &&
      code === 'SERVICE_UNAVAILABLE' &&
      body.message === 'Service is shutting down.'
        ? body.message
        : message;
    const method =
      typeof request.method === 'string' && request.method
        ? sanitizeLogText(request.method)
        : 'UNKNOWN';
    const path = sanitizeLogText(normalizePath(request));
    const route = sanitizeLogText(normalizeRoute(request));
    const errorClass =
      serverError
        ? 'SERVER_ERROR'
        : status >= HttpStatus.BAD_REQUEST && status < HttpStatus.INTERNAL_SERVER_ERROR
          ? 'CLIENT_ERROR'
          : undefined;
    const diagnostics = serverError
      ? unexpectedServerDiagnostics(exception)
      : {};

    this.logger?.error(
      'http.exception',
      apiLogFields('http.exception', {
        method,
        path,
        route,
        statusCode: status,
        errorCode: sanitizeLogText(code),
        requestId: id,
        ...(errorClass ? { errorClass } : {}),
        ...diagnostics,
      }),
    );
    setResponseRequestId(reply, id);
    reply.status(status).send({
      statusCode: status,
      errorCode: code,
      message: publicMessageValue,
      requestId: id,
    });
  }
}
