import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runSmoke } from './smoke-staging.mjs';

function response(
  status,
  body,
  requestId = '550e8400-e29b-41d4-a716-446655440000',
  headers = {},
) {
  return {
    status,
    headers: new Map(
      Object.entries({
        'x-request-id': requestId,
        'content-type': 'application/json',
        ...headers,
      }),
    ),
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function outputPath() {
  const directory = await mkdtemp(join(tmpdir(), 'staging-smoke-'));
  return join(directory, 'smoke-infrastructure.json');
}

test('runs a local explicit mock smoke without faking business workflows', async () => {
  const output = await outputPath();
  const calls = [];
  const report = await runSmoke({
    apiOrigin: 'http://127.0.0.1:3100',
    adminOrigin: 'http://127.0.0.1:4173',
    localTestMode: true,
    sessionToken: 'super-secret-session-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/health/live')) return response(200, { status: 'ok' });
      if (url.endsWith('/health/ready')) return response(200, { status: 'ok' });
      if (url.endsWith('/health')) return response(200, { status: 'ok' });
      if (url.endsWith('/auth/me'))
        return response(200, { user: { id: 'synthetic-user' } });
      return response(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
      });
    },
    timeoutMs: 100,
    outputPath: output,
  });
  assert.equal(report.result, 'PASS');
  assert.equal(report.businessWorkflow.result, 'NOT_RUN');
  assert.ok(calls.some(({ url }) => url.endsWith('/health/live')));
  assert.ok(calls.some(({ url }) => url.endsWith('/health/ready')));
  assert.ok(calls.some(({ url }) => url.endsWith('/health')));
  assert.ok(calls.some(({ url }) => url.endsWith('/auth/me')));
  assert.ok(
    calls.every(({ options }) => options.signal instanceof AbortSignal),
  );
  const serialized = await readFile(output, 'utf8');
  assert.doesNotMatch(serialized, /super-secret-session-token|Bearer/);
});

test('aborts fetches at the configured timeout', async () => {
  const output = await outputPath();
  let aborted = false;
  const report = await runSmoke({
    apiOrigin: 'http://127.0.0.1:3100',
    adminOrigin: 'http://127.0.0.1:4173',
    localTestMode: true,
    timeoutMs: 5,
    fetchImpl: async (_url, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve(response(503, { message: 'timeout' }));
          },
          { once: true },
        );
      }),
    outputPath: output,
  });
  assert.equal(report.result, 'FAIL');
  assert.equal(aborted, true);
});

test('reports API readiness failure and preserves a safe report', async () => {
  const output = await outputPath();
  const report = await runSmoke({
    apiOrigin: 'https://staging.example.test',
    adminOrigin: 'https://admin.staging.example.test',
    fetchImpl: async (url) => {
      if (url.endsWith('/health/live')) return response(200, { status: 'ok' });
      if (url.endsWith('/health/ready'))
        return response(503, {
          status: 'not_ready',
          error: 'database unavailable',
        });
      if (url.endsWith('/health')) return response(200, { status: 'ok' });
      return response(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
      });
    },
    outputPath: output,
  });
  assert.equal(report.result, 'FAIL');
  assert.equal(
    report.checks.find(({ name }) => name === 'api-ready').result,
    'FAIL',
  );
  assert.doesNotMatch(await readFile(output, 'utf8'), /database unavailable/);
});

test('requires HTTPS unless explicit local test mode is enabled', async () => {
  await assert.rejects(
    runSmoke({
      apiOrigin: 'http://staging.example.test',
      adminOrigin: 'https://admin.staging.example.test',
      fetchImpl: async () => response(200, { status: 'ok' }),
      outputPath: await outputPath(),
    }),
    /HTTPS|local test mode/i,
  );
});

test('checks the HTTP to HTTPS redirect and requires request IDs', async () => {
  const output = await outputPath();
  const report = await runSmoke({
    apiOrigin: 'https://staging.example.test',
    adminOrigin: 'https://admin.staging.example.test',
    redirectOrigin: 'http://staging.example.test',
    fetchImpl: async (url) => {
      if (url.startsWith('http://')) {
        return response(308, {}, undefined, {
          location: 'https://staging.example.test/health/live',
        });
      }
      return response(200, { status: 'ok' }, undefined, { 'x-request-id': '' });
    },
    outputPath: output,
  });
  assert.equal(report.result, 'FAIL');
  assert.equal(
    report.checks.find(({ name }) => name === 'https-redirect').result,
    'PASS',
  );
  assert.match(
    report.checks.find(({ name }) => name === 'api-live').reason,
    /request[- ]id/i,
  );
});
