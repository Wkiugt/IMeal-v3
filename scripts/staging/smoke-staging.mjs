import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoSecrets, parseArgs } from './staging-lib.mjs';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

function assertOrigin(value, label, localTestMode) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid origin`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must not include a path, query or fragment`);
  }
  if (parsed.protocol === 'https:') return parsed.origin;
  if (
    localTestMode &&
    parsed.protocol === 'http:' &&
    LOCAL_HOSTS.has(parsed.hostname)
  ) {
    return parsed.origin;
  }
  throw new Error(`${label} must use HTTPS unless local test mode is enabled`);
}

function assertRedirectOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('redirect origin must be a valid origin');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('redirect origin must be an HTTP origin');
  }
  return parsed.origin;
}

function getHeader(response, name) {
  const headers = response?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function safeRequestId(response) {
  const requestId = getHeader(response, 'x-request-id');
  return requestId && REQUEST_ID_PATTERN.test(requestId)
    ? requestId
    : undefined;
}

function safeBodyCheck(body) {
  if (body === undefined) return;
  try {
    assertNoSecrets(body);
  } catch {
    throw new Error('response body is not safe for evidence');
  }
  const serialized = JSON.stringify(body);
  if (
    /(?:postgres(?:ql)?:\/\/[^\s<]+@|\bBearer\s+(?!<redacted>)[^\s]+|\b(?:password|token|secret|api[_-]?key|otp)\b\s*[:=]\s*(?!<redacted>)[^\s,}\]]+)/i.test(
      serialized,
    )
  ) {
    throw new Error('response body is not redacted');
  }
}

async function parseBody(response) {
  try {
    if (typeof response?.json === 'function') return await response.json();
  } catch {
    // A non-JSON error body is handled as an unsafe envelope by the caller.
  }
  return undefined;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function passCheck(name, response, extra = {}) {
  const requestId = safeRequestId(response);
  return {
    name,
    result: 'PASS',
    statusCode: response?.status,
    ...(requestId ? { requestId } : {}),
    ...extra,
  };
}

function failCheck(name, reason, response) {
  const requestId = safeRequestId(response);
  return {
    name,
    result: 'FAIL',
    reason,
    ...(typeof response?.status === 'number'
      ? { statusCode: response.status }
      : {}),
    ...(requestId ? { requestId } : {}),
  };
}

async function checkHttp({
  name,
  url,
  fetchImpl,
  timeoutMs,
  expectedStatus,
  authorization,
  validateBody,
}) {
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...(authorization
            ? { authorization: `Bearer ${authorization}` }
            : {}),
        },
      },
      timeoutMs,
    );
  } catch {
    return failCheck(name, 'request failed or timed out');
  }
  const requestId = safeRequestId(response);
  if (!requestId) {
    return failCheck(
      name,
      'response is missing a valid X-Request-Id header',
      response,
    );
  }
  const statusMatches =
    typeof expectedStatus === 'function'
      ? expectedStatus(response.status)
      : response.status === expectedStatus;
  if (!statusMatches) {
    return failCheck(
      name,
      `unexpected HTTP status ${response.status}`,
      response,
    );
  }
  const body = await parseBody(response);
  try {
    safeBodyCheck(body);
    validateBody?.(body);
  } catch (error) {
    return failCheck(name, error.message, response);
  }
  return passCheck(name, response);
}

async function checkRedirect({ origin, expectedOrigin, fetchImpl, timeoutMs }) {
  const url = new URL('/health/live', origin).href;
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: 'GET', redirect: 'manual', headers: { accept: 'text/plain' } },
      timeoutMs,
    );
  } catch {
    return failCheck(
      'https-redirect',
      'HTTP redirect request failed or timed out',
    );
  }
  if (!safeRequestId(response)) {
    return failCheck(
      'https-redirect',
      'redirect response is missing a valid X-Request-Id header',
      response,
    );
  }
  const location = getHeader(response, 'location');
  let parsedLocation;
  try {
    parsedLocation = new URL(location);
  } catch {
    parsedLocation = undefined;
  }
  if (
    !REDIRECT_STATUSES.has(response.status) ||
    !parsedLocation ||
    parsedLocation.protocol !== 'https:' ||
    parsedLocation.origin !== expectedOrigin ||
    parsedLocation.pathname !== '/health/live' ||
    parsedLocation.search ||
    parsedLocation.hash ||
    parsedLocation.username ||
    parsedLocation.password
  ) {
    return failCheck(
      'https-redirect',
      'HTTP origin did not redirect to the expected HTTPS origin/path',
      response,
    );
  }
  return passCheck('https-redirect', response);
}

async function writeSmokeReport(outputPath, report) {
  const directory = resolve(outputPath, '..');
  await mkdir(directory, { recursive: true });
  assertNoSecrets(report);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  try {
    await writeFile(outputPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o440,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`smoke report already exists: ${outputPath}`);
    }
    throw error;
  }
}

export async function runSmoke({
  apiOrigin,
  adminOrigin,
  sessionToken,
  fetchImpl = globalThis.fetch,
  outputPath,
  timeoutMs = 5000,
  localTestMode = false,
  redirectOrigin,
}) {
  const api = assertOrigin(apiOrigin, 'API origin', localTestMode);
  const admin = assertOrigin(adminOrigin, 'Admin origin', localTestMode);
  if (typeof fetchImpl !== 'function')
    throw new TypeError('fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error('smoke timeout must be between 1 and 120000 milliseconds');
  }
  if (typeof outputPath !== 'string' || outputPath.trim() === '') {
    throw new Error('smoke output path is required');
  }
  if (
    sessionToken !== undefined &&
    (typeof sessionToken !== 'string' || sessionToken.trim() === '')
  ) {
    throw new Error('session token must be non-empty when supplied');
  }
  const checks = [];
  if (localTestMode) {
    checks.push({
      name: 'https-redirect',
      result: 'SKIP',
      reason: 'explicit local test mode',
    });
  } else {
    const redirect = assertRedirectOrigin(
      redirectOrigin ?? api.replace(/^https:/, 'http:'),
    );
    checks.push(
      await checkRedirect({
        origin: redirect,
        expectedOrigin: api,
        fetchImpl,
        timeoutMs,
      }),
    );
  }
  checks.push(
    await checkHttp({
      name: 'api-live',
      url: new URL('/health/live', api).href,
      fetchImpl,
      timeoutMs,
      expectedStatus: 200,
      validateBody: (body) => {
        if (!body || body.status !== 'ok')
          throw new Error('API liveness is not ok');
      },
    }),
    await checkHttp({
      name: 'api-ready',
      url: new URL('/health/ready', api).href,
      fetchImpl,
      timeoutMs,
      expectedStatus: 200,
      validateBody: (body) => {
        if (!body || body.status !== 'ok')
          throw new Error('API readiness is not ok');
      },
    }),
    await checkHttp({
      name: 'admin-health',
      url: new URL('/health', admin).href,
      fetchImpl,
      timeoutMs,
      expectedStatus: 200,
      validateBody: (body) => {
        if (!body || body.status !== 'ok')
          throw new Error('Admin health is not ok');
      },
    }),
    await checkHttp({
      name: 'safe-error-envelope',
      url: new URL('/__staging_smoke_not_found__', api).href,
      fetchImpl,
      timeoutMs,
      expectedStatus: (status) => status >= 400 && status < 500,
      validateBody: (body) => {
        if (
          !body ||
          typeof body !== 'object' ||
          typeof body.message !== 'string'
        ) {
          throw new Error('error envelope is not safe');
        }
      },
    }),
  );
  if (sessionToken !== undefined) {
    checks.push(
      await checkHttp({
        name: 'auth-me',
        url: new URL('/auth/me', api).href,
        fetchImpl,
        timeoutMs,
        expectedStatus: 200,
        authorization: sessionToken,
        validateBody: (body) => {
          if (!body || typeof body !== 'object')
            throw new Error('auth profile is not safe');
        },
      }),
    );
  }
  const report = {
    result: checks.some(({ result }) => result === 'FAIL') ? 'FAIL' : 'PASS',
    apiOrigin: api,
    adminOrigin: admin,
    checks,
    businessWorkflow: {
      result: 'NOT_RUN',
      command: null,
      reason:
        'business workflows are executed by the existing domain and end-to-end suites',
    },
  };
  await writeSmokeReport(resolve(outputPath), report);
  return report;
}

async function main(argv) {
  const args = parseArgs(argv, {
    'api-origin': { type: 'string', required: true },
    'admin-origin': { type: 'string', required: true },
    'session-token-env': { type: 'string' },
    output: { type: 'string', required: true },
    'timeout-ms': { type: 'string', default: '5000' },
    'local-test-mode': { type: 'boolean' },
    'redirect-origin': { type: 'string' },
  });
  const timeoutMs = Number(args['timeout-ms']);
  if (!Number.isInteger(timeoutMs))
    throw new Error('smoke timeout must be an integer');
  const sessionToken = args['session-token-env']
    ? process.env[args['session-token-env']]
    : undefined;
  const report = await runSmoke({
    apiOrigin: args['api-origin'],
    adminOrigin: args['admin-origin'],
    sessionToken,
    outputPath: args.output,
    timeoutMs,
    localTestMode: args['local-test-mode'],
    redirectOrigin: args['redirect-origin'],
  });
  process.stdout.write(
    `${JSON.stringify({ result: report.result, output: args.output })}\n`,
  );
  if (report.result !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || 'staging smoke failed'}\n`);
    process.exitCode = 1;
  });
}
