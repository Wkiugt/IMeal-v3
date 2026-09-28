import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type RequestLike = {
  id?: string;
  headers?: Record<string, string | string[] | undefined>;
};

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


const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstHeader(
  headers: RequestLike['headers'],
  name: string,
): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestId(request: RequestLike): string {
  const supplied = firstHeader(request.headers, REQUEST_ID_HEADER);
  return supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}

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
      response &&
      typeof response === 'object' &&
      !Array.isArray(response)
        ? response
        : {};
    const id = requestId(request);
    const code =
      typeof body.code === 'string'
        ? body.code
        : defaultErrorCode(status);
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

    reply.header('X-Request-Id', id).status(status).send({
      error,
      requestId: id,
    });
  }
}
