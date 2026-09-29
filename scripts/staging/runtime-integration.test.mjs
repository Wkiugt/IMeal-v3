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
const METRICS = `${HARDENING_METRIC_NAMES.map((name) => `# HELP ${name} fixture\n${name} 1`).join('\n')}\n`;

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
  });
});

test('reports API and worker readiness dependency failures without weakening live checks', async () => {
  const result = await runRuntimeIntegration({
    apiOrigin: API_ORIGIN,
    workerOrigin: WORKER_ORIGIN,
    expectedRelease: RELEASE,
    fetchImpl: fetchFixture({ apiReadyStatus: 503, workerReadyStatus: 503 }),
  });
  assert.equal(result.api.live, 200);
  assert.equal(result.api.ready, 503);
  assert.equal(result.worker.live, 200);
  assert.equal(result.worker.ready, 503);
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
