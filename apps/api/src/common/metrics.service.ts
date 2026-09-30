import { Injectable, Optional } from '@nestjs/common';
import {
  METRIC_CONTRACT,
  MetricRegistry,
  type MetricName,
} from '@imeal/observability';

type HttpRouteLabel =
  | '/health/live'
  | '/health/ready'
  | 'auth'
  | 'api'
  | 'serving'
  | 'registrations'
  | 'kitchen'
  | 'notifications'
  | 'delegations'
  | 'admin'
  | 'other';
type HttpMethodLabel =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';
type HttpStatusLabel =
  | '200'
  | '201'
  | '202'
  | '204'
  | '400'
  | '401'
  | '403'
  | '404'
  | '409'
  | '422'
  | '429'
  | '500'
  | '502'
  | '503'
  | '504';
type AuthResult = 'success' | 'failure' | 'dependency_failure';
type ServingResult = 'success' | 'error' | 'failure';

const HTTP_REQUEST_ROW =
  METRIC_CONTRACT.find((row) => row.name === 'imeal_http_requests_total') ??
  (() => {
    throw new Error('Missing HTTP request metric contract row');
  })();

function isHttpRoute(value: string): value is HttpRouteLabel {
  return HTTP_REQUEST_ROW.labels.route.includes(value);
}

function isHttpMethod(value: string): value is HttpMethodLabel {
  return HTTP_REQUEST_ROW.labels.method.includes(value);
}

function isHttpStatus(value: string): value is HttpStatusLabel {
  return HTTP_REQUEST_ROW.labels.status.includes(value);
}

function normalizeRoute(route: string): HttpRouteLabel | null {
  const path = route.split('?')[0] || '/';
  if (path === '/metrics') return null;
  if (path === '/health/live') return '/health/live';
  if (path === '/health/ready') return '/health/ready';
  const prefixMap: readonly [string, HttpRouteLabel][] = [
    ['/auth', 'auth'],
    ['/api', 'api'],
    ['/serving', 'serving'],
    ['/registrations', 'registrations'],
    ['/kitchen', 'kitchen'],
    ['/notifications', 'notifications'],
    ['/delegations', 'delegations'],
    ['/admin', 'admin'],
  ];
  return (
    prefixMap.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ??
    'other'
  );
}

function normalizeMethod(method: string): HttpMethodLabel {
  return isHttpMethod(method) ? method : 'OPTIONS';
}

function normalizeStatus(statusCode: number): HttpStatusLabel {
  const value = String(statusCode);
  if (isHttpStatus(value)) return value;
  if (statusCode >= 500) return '500';
  if (statusCode >= 400) return '400';
  if (statusCode >= 300) return '200';
  return '200';
}

function normalizedDurationSeconds(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return durationMs / 1000;
}

@Injectable()
export class ApiMetricsService {
  readonly registry: MetricRegistry;

  constructor(@Optional() registry?: MetricRegistry) {
    this.registry = registry ?? new MetricRegistry();
  }

  recordHttpRequest(
    route: string,
    method: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const normalizedRoute = normalizeRoute(route);
    if (!normalizedRoute) return;
    const labels = {
      route: normalizedRoute,
      method: normalizeMethod(method),
      status: normalizeStatus(statusCode),
    };
    this.withoutThrowing(() => {
      this.registry.increment('imeal_http_requests_total', labels);
      this.registry.observeHistogram(
        'imeal_http_request_duration_seconds_bucket',
        labels,
        normalizedDurationSeconds(durationMs),
      );
    });
  }

  recordAuthAttempt(result: AuthResult): void {
    this.withoutThrowing(() =>
      this.registry.increment('imeal_auth_attempts_total', { result }),
    );
  }

  recordServingConfirmation(result: ServingResult, durationMs: number): void {
    this.withoutThrowing(() => {
      this.registry.increment('imeal_serving_confirm_total', { result });
      this.registry.observeHistogram(
        'imeal_serving_confirm_duration_seconds_bucket',
        { result },
        normalizedDurationSeconds(durationMs),
      );
    });
  }

  recordIdempotencyConflict(): void {
    this.withoutThrowing(() =>
      this.registry.increment('imeal_idempotency_conflicts_total'),
    );
  }

  serialize(): string {
    return this.registry.serialize();
  }

  private withoutThrowing(operation: () => void): void {
    try {
      operation();
    } catch {
      // Metrics must never change the API response or transaction outcome.
    }
  }
}

export type { AuthResult, HttpMethodLabel, HttpRouteLabel, HttpStatusLabel, ServingResult };
export type ApiMetricName = MetricName;
