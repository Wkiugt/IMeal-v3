import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { REQUEST_ID_HEADER, resolveRequestId } from '@imeal/observability';
import type { StructuredLogger } from '@imeal/observability';
import { API_STRUCTURED_LOGGER } from './structured-logger.js';
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
  message?: unknown;
  details?: unknown;
};

function defaultErrorCode(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  return 'INTERNAL_SERVER_ERROR';
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
    const request = http.getRequest<RequestLike>();
    const reply = http.getResponse<ReplyLike>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body: ExceptionBody =
      response && typeof response === 'object' && !Array.isArray(response)
        ? response
        : {};
    const id =
      requestIdFromRequest(request) ??
      resolveRequestId(firstHeader(request.headers, REQUEST_ID_HEADER));
    request.requestId = id;
    const code =
      typeof body.code === 'string' ? body.code : defaultErrorCode(status);
    const message =
      typeof body.message === 'string'
        ? body.message
        : typeof response === 'string'
          ? response
          : status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? 'Internal server error'
            : 'Request failed';

    const structuredDetails = Array.isArray(response)
      ? { issues: response }
      : Array.isArray(body.message)
        ? { issues: body.message }
        : Array.isArray(body.details)
          ? { issues: body.details }
          : body.details &&
              typeof body.details === 'object' &&
              !Array.isArray(body.details)
            ? (body.details as Record<string, unknown>)
            : undefined;
    const error: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    } = {
      code,
      message,
      ...(structuredDetails ? { details: structuredDetails } : {}),
    };

    this.logger?.error('http.exception', {
      service: 'api',
      release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
      event: 'http.exception',
      requestId: id,
      statusCode: status,
      errorCode: code,
    });
    setResponseRequestId(reply, id);
    reply.status(status).send({
      error,
      requestId: id,
    });
  }
}
