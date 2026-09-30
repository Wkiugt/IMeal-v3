import { createHash } from 'node:crypto';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  HARDENING_RUNTIME_CONTRACT,
  HARDENING_METRIC_NAMES,
  STAGING_QUALIFICATION_PREREQUISITES,
  runRuntimeIntegration,
} from './runtime-integration.mjs';

const API_ORIGIN = 'https://staging.example.test';
const WORKER_ORIGIN = 'http://worker.internal:3001';
const RELEASE = 'imeal-staging-release';
const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const HISTOGRAM_BUCKETS = ['0.005', '0.01', '0.025', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10', '+Inf'];
const HISTOGRAM_NAMES = new Map([
  ['imeal_http_request_duration_seconds_bucket', ['route="api"', 'method="GET"', 'status="200"']],
  ['imeal_serving_confirm_duration_seconds_bucket', ['result="success"']],
]);
const METRIC_LABELS = {
  imeal_http_requests_total: ['route="api"', 'method="GET"', 'status="200"'],
  imeal_auth_attempts_total: ['result="success"'],
  imeal_serving_confirm_total: ['result="success"'],
  imeal_worker_runs_total: ['job="otp_delivery"', 'status="success"'],
  imeal_worker_job_last_success_timestamp_seconds: ['job="otp_delivery"'],
  imeal_worker_job_lag_seconds: ['job="otp_delivery"'],
  imeal_postgres_connection_usage_ratio: ['pool="postgres_backend"'],
  imeal_object_storage_errors_total: ['operation="health"'],
  imeal_security_boundary_violations_total: ['category="invalid_tls"'],
};
const METRICS = `${HARDENING_METRIC_NAMES.map((name) => {
  const histogramLabels = HISTOGRAM_NAMES.get(name);
  if (histogramLabels) {
    const base = name.replace(/_bucket$/, '');
    const buckets = HISTOGRAM_BUCKETS.map(
      (le) => `${name}{${[...histogramLabels, `le="${le}"`].join(',')}} 1`,
    );
    return [
      `# HELP ${base} fixture`,
      `# TYPE ${base} histogram`,
      ...buckets,
      `${base}_sum{${histogramLabels.join(',')}} 1`,
      `${base}_count{${histogramLabels.join(',')}} 1`,
    ].join('\n');
  }
  const labels = METRIC_LABELS[name];
  const suffix = labels ? `{${labels.join(',')}}` : '';
  const type = name.endsWith('_total') ? 'counter' : 'gauge';
  return `# HELP ${name} fixture\n# TYPE ${name} ${type}\n${name}${suffix} 1`;
}).join('\n')}\n`;

function response(status, body, requestId = REQUEST_ID, extraHeaders = {}) {
  return {
    status,
    headers: new Map(
      Object.entries({
        'content-type': 'application/json',
        'x-request-id': requestId,
        ...extraHeaders,
      }),
    ),
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function healthBody(service, status = 'ok', release = RELEASE) {
  return {
    status,
    service,
    release,
    checks: {
      environment: 'ok',
      database: 'ok',
      migration: 'ok',
      draining: 'ok',
      ...(service === 'worker' ? { scheduler: 'ok', lastLoop: 'ok' } : {}),
    },
    requestId: REQUEST_ID,
  };
}

function fetchFixture({ apiReadyStatus = 200, workerReadyStatus = 200 } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/metrics' && parsed.origin === API_ORIGIN) {
      return response(404, { message: 'not found' }, undefined);
    }
    if (parsed.pathname === '/metrics' && parsed.origin === WORKER_ORIGIN) {
      return response(200, METRICS, undefined, {
        'content-type': 'text/plain',
      });
    }
    if (parsed.origin === API_ORIGIN) {
      if (parsed.pathname === HARDENING_RUNTIME_CONTRACT.apiLivePath) {
        return response(200, healthBody('api', 'ok', null));
      }
      if (parsed.pathname === HARDENING_RUNTIME_CONTRACT.apiReadyPath) {
        const status = apiReadyStatus === 200 ? 'ok' : 'error';
        return response(apiReadyStatus, healthBody('api', status));
      }
    }
    if (parsed.origin === WORKER_ORIGIN) {
      if (parsed.pathname === HARDENING_RUNTIME_CONTRACT.workerLivePath) {
        return response(200, healthBody('worker', 'ok', null));
      }
      if (parsed.pathname === HARDENING_RUNTIME_CONTRACT.workerReadyPath) {
        const status = workerReadyStatus === 200 ? 'ok' : 'error';
        return response(workerReadyStatus, healthBody('worker', status));
      }
    }
    throw new Error(`unexpected fixture URL ${url}`);
  };
}
function fetchWithWorkerMetrics(body) {
  return async (url) => {
    if (url.endsWith('/metrics') && url.startsWith(WORKER_ORIGIN)) {
      return response(200, body, undefined, { 'content-type': 'text/plain' });
    }
    return fetchFixture()(url);
  };
}

test('consumes the hardening health, request-ID and internal metrics contracts', async () => {
  const result = await runRuntimeIntegration({
    apiOrigin: API_ORIGIN,
    workerOrigin: WORKER_ORIGIN,
    expectedRelease: RELEASE,
    fetchImpl: fetchFixture(),
  });
  assert.deepEqual(result, {
    api: { live: 200, ready: 200, requestId: REQUEST_ID },
    worker: { live: 200, ready: 200 },
    metricsInternalOnly: true,
    metricsSnapshotSource: 'worker-internal',
    metricsSnapshotDigest: createHash('sha256').update(METRICS, 'utf8').digest('hex'),
  });
});

test('rejects API and worker readiness dependency failures for qualification', async () => {
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchFixture({ apiReadyStatus: 503 }),
    }),
    /api ready must return HTTP 200/,
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchFixture({ workerReadyStatus: 503 }),
    }),
    /worker ready must return HTTP 200/,
  );
});
test('rejects an HTTP 200 readiness response whose body is not ok', async () => {
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (
          url.endsWith('/health/ready') &&
          url.startsWith(API_ORIGIN)
        ) {
          return response(200, healthBody('api', 'error'));
        }
        return fetchFixture()(url);
      },
    }),
    /api ready response status is inconsistent/,
  );
});

test('rejects a live response whose body status is not healthy', async () => {
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (url.endsWith('/health/live') && url.startsWith(API_ORIGIN)) {
          return response(200, healthBody('api', 'error'));
        }
        return fetchFixture()(url);
      },
    }),
    /status is inconsistent/,
  );
});

test('rejects invalid request IDs and does not expose response secrets', async () => {
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (url.endsWith('/health/live')) {
          return response(200, healthBody('api'), 'Bearer fixture-token');
        }
        return fetchFixture()(url);
      },
    }),
    (error) => {
      assert.doesNotMatch(String(error), /Bearer|fixture-token/);
      return true;
    },
  );
});

test('rejects a public metrics response and metrics with secret-bearing content', async () => {
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (url.endsWith('/metrics') && url.startsWith(API_ORIGIN)) {
          return response(200, METRICS, undefined, {
            'content-type': 'text/plain',
          });
        }
        return fetchFixture()(url);
      },
    }),
    /metrics must remain internal/,
  );

  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (url.endsWith('/metrics') && url.startsWith(WORKER_ORIGIN)) {
          return response(200, `authorization: Bearer fixture-token\n`);
        }
        return fetchFixture()(url);
      },
    }),
    (error) => {
      assert.doesNotMatch(String(error), /Bearer|fixture-token/);
      return true;
    },
  );
});
test('rejects HELP/TYPE-only metrics and unsafe or unapproved series', async () => {
  const helpOnly = METRICS
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .join('\n');
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(helpOnly),
    }),
    /required metric has no numeric sample/,
  );

  const unsafeLabel = METRICS.replace(
    'imeal_http_requests_total{route="api",method="GET",status="200"} 1',
    'imeal_http_requests_total{route="api",method="GET",status="200",unsafe="x"} 1',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(unsafeLabel),
    }),
    /metric label is not approved/,
  );

  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(`${METRICS}imeal_unapproved_series 1\n`),
    }),
    /metric name is not approved/,
  );
});

test('rejects malformed histogram buckets and every successful public metrics response', async () => {
  const missingBucket = METRICS.replace(
    'imeal_http_request_duration_seconds_bucket{route="api",method="GET",status="200",le="0.005"} 1\n',
    '',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(missingBucket),
    }),
    /histogram buckets are incomplete/,
  );
  const invalidType = METRICS.replace(
    '# TYPE imeal_http_request_duration_seconds histogram',
    '# TYPE imeal_http_request_duration_seconds gauge',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(invalidType),
    }),
    /metric type is invalid/,
  );

  const decreasing = METRICS.replace(
    'imeal_http_request_duration_seconds_bucket{route="api",method="GET",status="200",le="0.01"} 1',
    'imeal_http_request_duration_seconds_bucket{route="api",method="GET",status="200",le="0.01"} 0',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(decreasing),
    }),
    /histogram buckets are not cumulative/,
  );

  const mismatchedCount = METRICS.replace(
    'imeal_http_request_duration_seconds_count{route="api",method="GET",status="200"} 1',
    'imeal_http_request_duration_seconds_count{route="api",method="GET",status="200"} 2',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(mismatchedCount),
    }),
    /histogram \+Inf count is inconsistent/,
  );

  const mismatchedSumLabels = METRICS.replace(
    'imeal_http_request_duration_seconds_sum{route="api",method="GET",status="200"} 1',
    'imeal_http_request_duration_seconds_sum{route="other",method="GET",status="200"} 1',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(mismatchedSumLabels),
    }),
    /histogram auxiliary labels are unmatched/,
  );

  const missingType = METRICS.replace(
    '# TYPE imeal_auth_attempts_total counter\n',
    '',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(missingType),
    }),
    /required metric type declaration is missing/,
  );

  const fractionalCounter = METRICS.replace(
    'imeal_auth_attempts_total{result="success"} 1',
    'imeal_auth_attempts_total{result="success"} 1.5',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(fractionalCounter),
    }),
    /metric value is invalid/,
  );

  const negativeGauge = METRICS.replace(
    'imeal_otp_outbox_oldest_age_seconds 1',
    'imeal_otp_outbox_oldest_age_seconds -1',
  );
  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: fetchWithWorkerMetrics(negativeGauge),
    }),
    /metric value is invalid/,
  );


  await assert.rejects(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url) => {
        if (url.endsWith('/metrics') && url.startsWith(API_ORIGIN)) {
          return response(204, '', undefined, { 'content-type': 'text/plain' });
        }
        return fetchFixture()(url);
      },
    }),
    /metrics must remain internal/,
  );
});
test('uses manual redirect handling while accepting only non-2xx public metrics probes', async () => {
  let observedOptions;
  await runRuntimeIntegration({
    apiOrigin: API_ORIGIN,
    workerOrigin: WORKER_ORIGIN,
    expectedRelease: RELEASE,
    fetchImpl: async (url, options) => {
      observedOptions = options;
      return fetchFixture()(url);
    },
  });
  assert.equal(observedOptions.redirect, 'manual');

  await assert.doesNotReject(
    runRuntimeIntegration({
      apiOrigin: API_ORIGIN,
      workerOrigin: WORKER_ORIGIN,
      expectedRelease: RELEASE,
      fetchImpl: async (url, options) => {
        if (url.endsWith('/metrics') && url.startsWith(API_ORIGIN)) {
          return response(301, '', undefined, { location: `${API_ORIGIN}/metrics` });
        }
        return fetchFixture()(url, options);
      },
    }),
  );
});


test('declares the external edge control as an explicit qualification prerequisite', async () => {
  const rulesText = await readFile(
    resolve('infra/staging/alert-rules.yml'),
    'utf8',
  );
  assert.ok(
    STAGING_QUALIFICATION_PREREQUISITES.includes(
      'approved-edge-rate-limit-control',
    ),
  );
  assert.match(rulesText, /approved edge WAF or rate-limit control/i);
});
