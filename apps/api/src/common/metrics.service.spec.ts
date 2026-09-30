import { describe, expect, it } from 'vitest';
import { ApiMetricsService } from './metrics.service.js';

describe('ApiMetricsService', () => {
  it('records one bounded request counter and duration observation', () => {
    const metrics = new ApiMetricsService();

    metrics.recordHttpRequest('/registrations/:id', 'GET', 200, 250);

    const output = metrics.serialize();
    expect(output).toContain(
      'imeal_http_requests_total{method="GET",route="registrations",status="200"} 1',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_count{method="GET",route="registrations",status="200"} 1',
    );
    expect(output).toContain(
      'imeal_http_request_duration_seconds_sum{method="GET",route="registrations",status="200"} 0.25',
    );
  });
  it('fails closed for unsupported method and status instead of relabeling', () => {
    const unsupportedMethod = new ApiMetricsService();
    unsupportedMethod.recordHttpRequest('/api/orders', 'TRACE', 200, 10);
    expect(unsupportedMethod.serialize()).toBe('');

    const unsupportedStatus = new ApiMetricsService();
    unsupportedStatus.recordHttpRequest('/api/orders', 'GET', 418, 10);
    expect(unsupportedStatus.serialize()).toBe('');
  });

  it('records bounded authentication and serving outcome taxonomies without sensitive labels', () => {
    const metrics = new ApiMetricsService();

    metrics.recordAuthAttempt('failure');
    metrics.recordAuthAttempt('dependency_failure');
    metrics.recordServingConfirmation('success', 20);
    metrics.recordServingConfirmation('error', 10);
    metrics.recordServingConfirmation('failure', 30);
    metrics.recordIdempotencyConflict();

    const output = metrics.serialize();
    expect(output).toContain('imeal_auth_attempts_total{result="failure"} 1');
    expect(output).toContain(
      'imeal_auth_attempts_total{result="dependency_failure"} 1',
    );
    expect(output).toContain('imeal_serving_confirm_total{result="success"} 1');
    expect(output).toContain('imeal_serving_confirm_total{result="error"} 1');
    expect(output).toContain('imeal_serving_confirm_total{result="failure"} 1');
    expect(output).toContain('imeal_idempotency_conflicts_total 1');
    expect(output).not.toContain('employee@example');
    expect(output).not.toContain('123456');
  });

  it('excludes the API metrics route before recording', () => {
    const metrics = new ApiMetricsService();

    metrics.recordHttpRequest('/metrics', 'GET', 200, 1);

    expect(metrics.serialize()).toBe('');
  });
});
