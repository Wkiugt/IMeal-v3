import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Inject,
  NestInterceptor,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { REQUEST_ID_HEADER, resolveRequestId } from '@imeal/observability';
import type { StructuredLogger } from '@imeal/observability';
import { catchError, finalize, type Observable, tap, throwError } from 'rxjs';
import {
  firstHeader,
  requestIdFromRequest,
  type RequestContextRequest,
} from './request-context.js';
import { API_STRUCTURED_LOGGER } from './structured-logger.js';
import { ApiMetricsService } from './metrics.service.js';
import {
  HEALTH_SHUTDOWN_COORDINATOR,
  type ShutdownCoordinatorLike,
} from '../health/health.types.js';

export { API_STRUCTURED_LOGGER };

type HttpResponse = {
  statusCode?: number;
};

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(API_STRUCTURED_LOGGER)
    private readonly logger: StructuredLogger,
    @Optional()
    @Inject(HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: ShutdownCoordinatorLike,
    @Optional()
    private readonly metrics?: ApiMetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<RequestContextRequest>();
    const response = http.getResponse<HttpResponse>();
    const requestId = resolveRequestId(
      requestIdFromRequest(request) ??
        firstHeader(request.headers, REQUEST_ID_HEADER),
    );
    const method = request.method ?? 'UNKNOWN';
    const route = normalizeRoute(request);
    let metricsRecorded = false;
    const recordMetrics = (statusCode: number): void => {
      if (metricsRecorded || route === '/metrics') return;
      metricsRecorded = true;
      this.metrics?.recordHttpRequest(
        route,
        method,
        statusCode,
        Math.max(0, Date.now() - startedAt),
      );
    };
    const healthRoute = route === '/health' || route.startsWith('/health/');
    const release =
      healthRoute && this.shutdown?.isDraining?.()
        ? undefined
        : this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release && !healthRoute) {
      recordMetrics(503);
      return throwError(
        () =>
          new ServiceUnavailableException({
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service is shutting down.',
          }),
      );
    }

    const log = (
      statusCode: number,
      event: string,
      level: 'info' | 'error',
    ): void => {
      recordMetrics(statusCode);
      this.logger[level](event, {
        service: 'api',
        release: process.env.RELEASE_VERSION?.trim() || 'unconfigured',
        event,
        method,
        route,
        statusCode,
        durationMs: Math.max(0, Date.now() - startedAt),
        requestId,
      });
    };

    return next.handle().pipe(
      tap(() => log(response.statusCode ?? 200, 'http.request', 'info')),
      catchError((error: unknown) => {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : 500;
        log(statusCode, 'http.error', 'error');
        return throwError(() => error);
      }),
      finalize(() => release?.()),
    );
  }
}

function normalizeRoute(request: RequestContextRequest): string {
  const route =
    request.routeOptions?.url ?? request.route?.path ?? request.url ?? '/';
  const path = route.split('?')[0];
  return path || '/';
}
