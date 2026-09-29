import { assertNoSecrets } from './staging-lib.mjs';

export const HARDENING_RUNTIME_CONTRACT = Object.freeze({
  apiLivePath: '/health/live',
  apiReadyPath: '/health/ready',
  workerLivePath: '/health/live',
  workerReadyPath: '/health/ready',
  requestIdHeader: 'x-request-id',
  metricsPath: '/metrics',
});

export const HARDENING_METRIC_NAMES = Object.freeze([
  'imeal_http_requests_total',
  'imeal_http_request_duration_seconds_bucket',
  'imeal_auth_attempts_total',
  'imeal_otp_delivery_total',
  'imeal_otp_delivery_retries_total',
  'imeal_otp_delivery_failures_total',
  'imeal_otp_outbox_oldest_age_seconds',
  'imeal_serving_confirm_total',
  'imeal_serving_confirm_duration_seconds_bucket',
  'imeal_idempotency_conflicts_total',
  'imeal_worker_runs_total',
  'imeal_worker_job_last_success_timestamp_seconds',
  'imeal_worker_job_lag_seconds',
  'imeal_postgres_connection_usage_ratio',
  'imeal_postgres_transaction_errors_total',
  'imeal_postgres_lock_waits_total',
  'imeal_postgres_disk_usage_ratio',
  'imeal_object_storage_capacity_bytes',
  'imeal_object_storage_errors_total',
  'imeal_backup_age_seconds',
  'imeal_backup_checksum_failures_total',
  'imeal_restore_test_failures_total',
  'imeal_security_boundary_violations_total',
]);

export const STAGING_QUALIFICATION_PREREQUISITES = Object.freeze([
  'approved-edge-rate-limit-control',
]);

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_STATES = new Set(['ok', 'down', 'not_configured']);
const SENSITIVE_TEXT_PATTERN =
  /(?:postgres(?:ql)?:\/\/[^\s<]+@|\bBearer\s+(?!<redacted>)[^\s]+|\b(?:password|token|secret|api[_-]?key|otp)\b\s*[:=]\s*(?!<redacted>)[^\s,}\]]+)/i;

function assertOrigin(value, label, requireHttps = false) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid origin`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${label} must be an origin without credentials or a path`);
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
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
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (
      key.toLowerCase() === wanted &&
      typeof value === 'string' &&
      value.trim() !== ''
    ) {
      return value;
    }
  }
  return undefined;
}

function safeRequestId(response, label) {
  const requestId = getHeader(
    response,
    HARDENING_RUNTIME_CONTRACT.requestIdHeader,
  );
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error(`${label} response has an invalid request ID`);
  }
  return requestId;
}

function safeBody(body, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${label} response body is invalid`);
  }
  try {
    assertNoSecrets(body);
  } catch {
    throw new Error(`${label} response body is not redacted`);
  }
  const serialized = JSON.stringify(body);
  if (SENSITIVE_TEXT_PATTERN.test(serialized)) {
    throw new Error(`${label} response body is not redacted`);
  }
  return body;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new Error('request failed or timed out');
  } finally {
    clearTimeout(timeout);
  }
}

async function readHealth({
  fetchImpl,
  origin,
  path,
  service,
  check,
  expectedRelease,
  timeoutMs,
}) {
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${origin}${path}`, timeoutMs);
  } catch {
    throw new Error(`${service} ${check} request failed or timed out`);
  }
  const requestId = safeRequestId(response, `${service} ${check}`);
  let body;
  try {
    body = safeBody(await response.json(), `${service} ${check}`);
  } catch {
    throw new Error(`${service} ${check} response body is invalid`);
  }
  if (body.service !== service || body.requestId !== requestId) {
    throw new Error(`${service} ${check} response identity is invalid`);
  }
  if (body.status !== 'ok' && body.status !== 'error') {
    throw new Error(`${service} ${check} response status is invalid`);
  }
  if (!body.checks || typeof body.checks !== 'object') {
    throw new Error(`${service} ${check} checks are missing`);
  }
  for (const state of Object.values(body.checks)) {
    if (typeof state !== 'string' || !HEALTH_STATES.has(state)) {
      throw new Error(`${service} ${check} checks are invalid`);
    }
  }
  if (check === 'live' && response.status !== 200) {
    throw new Error(`${service} live must return HTTP 200`);
  }
  if (check === 'ready' && response.status !== 200 && response.status !== 503) {
    throw new Error(`${service} ready must return HTTP 200 or 503`);
  }
  if (
    (check === 'live' && body.status !== 'ok') ||
    (check === 'ready' &&
      ((response.status === 200 && body.status !== 'ok') ||
        (response.status === 503 && body.status !== 'error')))
  ) {
    throw new Error(`${service} ${check} response status is inconsistent`);
  }
  if (check === 'ready' && body.release !== expectedRelease) {
    throw new Error(
      `${service} ready release does not match the expected release`,
    );
  }
  return { status: response.status, requestId };
}

async function readMetrics({
  fetchImpl,
  origin,
  service,
  timeoutMs,
  publicProbe,
}) {
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${origin}${HARDENING_RUNTIME_CONTRACT.metricsPath}`,
      timeoutMs,
    );
  } catch {
    if (publicProbe) return { reachable: false };
    throw new Error(`${service} metrics request failed or timed out`);
  }
  if (publicProbe) {
    if (response.status >= 200 && response.status < 300) {
      throw new Error('public metrics must remain internal');
    }
    return { reachable: false };
  }
  if (response.status !== 200) {
    throw new Error(`${service} metrics must return HTTP 200 internally`);
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(`${service} metrics body is invalid`);
  }
  if (typeof text !== 'string') {
    throw new Error(`${service} metrics body is invalid`);
  }
  try {
    assertNoSecrets(text);
  } catch {
    throw new Error(`${service} metrics body is not redacted`);
  }
  if (SENSITIVE_TEXT_PATTERN.test(text)) {
    throw new Error(`${service} metrics body is not redacted`);
  }
  for (const metric of HARDENING_METRIC_NAMES) {
    const metricPattern = new RegExp(
      `(?:^|\\n)(?:# (?:HELP|TYPE) )?${metric}(?:\\{|\\s|$)`,
    );
    if (!metricPattern.test(text)) {
      throw new Error(`internal metrics missing required metric: ${metric}`);
    }
  }
  return { reachable: true };
}

export async function runRuntimeIntegration({
  apiOrigin,
  workerOrigin,
  expectedRelease,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
}) {
  const api = assertOrigin(apiOrigin, 'API origin', true);
  const worker = assertOrigin(workerOrigin, 'worker origin');
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }
  if (typeof expectedRelease !== 'string' || expectedRelease.trim() === '') {
    throw new Error('expected release is required');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new RangeError('timeout must be an integer between 1 and 120000 ms');
  }

  const apiLive = await readHealth({
    fetchImpl,
    origin: api,
    path: HARDENING_RUNTIME_CONTRACT.apiLivePath,
    service: 'api',
    check: 'live',
    expectedRelease,
    timeoutMs,
  });
  const apiReady = await readHealth({
    fetchImpl,
    origin: api,
    path: HARDENING_RUNTIME_CONTRACT.apiReadyPath,
    service: 'api',
    check: 'ready',
    expectedRelease,
    timeoutMs,
  });
  const workerLive = await readHealth({
    fetchImpl,
    origin: worker,
    path: HARDENING_RUNTIME_CONTRACT.workerLivePath,
    service: 'worker',
    check: 'live',
    expectedRelease,
    timeoutMs,
  });
  const workerReady = await readHealth({
    fetchImpl,
    origin: worker,
    path: HARDENING_RUNTIME_CONTRACT.workerReadyPath,
    service: 'worker',
    check: 'ready',
    expectedRelease,
    timeoutMs,
  });
  await readMetrics({
    fetchImpl,
    origin: api,
    service: 'api',
    timeoutMs,
    publicProbe: true,
  });
  const internalMetrics = await readMetrics({
    fetchImpl,
    origin: worker,
    service: 'worker',
    timeoutMs,
    publicProbe: false,
  });

  return {
    api: {
      live: apiLive.status,
      ready: apiReady.status,
      requestId: apiLive.requestId,
    },
    worker: { live: workerLive.status, ready: workerReady.status },
    metricsInternalOnly: !internalMetrics.reachable ? false : true,
  };
}

export function assertAlertRules({ rulesText, requiredMetrics }) {
  if (typeof rulesText !== 'string' || rulesText.trim() === '') {
    throw new Error('alert rules text is required');
  }
  if (!Array.isArray(requiredMetrics) || requiredMetrics.length === 0) {
    throw new Error('required alert metrics are required');
  }
  if (/\brate_limit\b/i.test(rulesText)) {
    throw new Error('unsupported stock rate-limit directive is forbidden');
  }
  if (/password|token|secret|api[_-]?key/i.test(rulesText)) {
    throw new Error('alert rules contain unsafe secret labels');
  }
  for (const metric of requiredMetrics) {
    if (
      typeof metric !== 'string' ||
      !/^imeal_[a-z0-9_]+$/.test(metric) ||
      !rulesText.includes(metric)
    ) {
      throw new Error(`missing required metric: ${metric}`);
    }
  }
  if (!/owner:\s*\S+/.test(rulesText) || !/action:\s*\S/.test(rulesText)) {
    throw new Error('alert rules require bounded owner and action metadata');
  }
  if (!/alert_test_route:\s*\S+/.test(rulesText)) {
    throw new Error('alert rules require an alert delivery test route');
  }
  if (!/approved edge WAF or rate-limit control/i.test(rulesText)) {
    throw new Error(
      'approved edge WAF or rate-limit control prerequisite is required',
    );
  }
}
