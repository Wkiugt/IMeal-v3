import { assertNoSecrets } from './staging-lib.mjs';

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
const HISTOGRAM_BUCKETS = Object.freeze([
  '0.005',
  '0.01',
  '0.025',
  '0.05',
  '0.1',
  '0.25',
  '0.5',
  '1',
  '2.5',
  '5',
  '10',
  '+Inf',
]);
const HISTOGRAM_BUCKET_PATTERN = new RegExp(
  `^(?:${HISTOGRAM_BUCKETS.map((value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})$`,
);
const METRIC_LABELS = Object.freeze({
  imeal_http_requests_total: Object.freeze({
    route: /^\/health\/(?:live|ready)$|^(?:auth|api|serving|registrations|kitchen|notifications|delegations|admin|other)$/,
    method: /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
    status: /^(?:200|201|202|204|400|401|403|404|409|422|429|500|502|503|504)$/,
  }),
  imeal_http_request_duration_seconds_bucket: Object.freeze({
    route: /^\/health\/(?:live|ready)$|^(?:auth|api|serving|registrations|kitchen|notifications|delegations|admin|other)$/,
    method: /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
    status: /^(?:200|201|202|204|400|401|403|404|409|422|429|500|502|503|504)$/,
    le: HISTOGRAM_BUCKET_PATTERN,
  }),
  imeal_auth_attempts_total: Object.freeze({
    result: /^(?:success|failure|dependency_failure)$/,
  }),
  imeal_serving_confirm_total: Object.freeze({
    result: /^(?:success|error|failure)$/,
  }),
  imeal_serving_confirm_duration_seconds_bucket: Object.freeze({
    result: /^(?:success|error|failure)$/,
    le: HISTOGRAM_BUCKET_PATTERN,
  }),
  imeal_worker_runs_total: Object.freeze({
    job: /^(?:otp_delivery|notification_dispatch|registration_reminder|pickup_reminder|cutoff_lock|pickup_session_cleanup|no_show)$/,
    status: /^(?:success|failure|skipped)$/,
  }),
  imeal_worker_job_last_success_timestamp_seconds: Object.freeze({
    job: /^(?:otp_delivery|notification_dispatch|registration_reminder|pickup_reminder|cutoff_lock|pickup_session_cleanup|no_show)$/,
  }),
  imeal_worker_job_lag_seconds: Object.freeze({
    job: /^(?:otp_delivery|notification_dispatch|registration_reminder|pickup_reminder|cutoff_lock|pickup_session_cleanup|no_show)$/,
  }),
  imeal_postgres_connection_usage_ratio: Object.freeze({
    pool: /^(?:pgbouncer_client|postgres_backend)$/,
  }),
  imeal_object_storage_errors_total: Object.freeze({
    operation: /^(?:health|read|write)$/,
  }),
  imeal_security_boundary_violations_total: Object.freeze({
    category: /^(?:public_private_service_exposure|plaintext_bearer_transport|invalid_tls|unexpected_cors_origin|waf_or_rate_limit_violation|unexpected_public_internal_port)$/,
  }),
});
const HISTOGRAMS = Object.freeze({
  imeal_http_request_duration_seconds_bucket: Object.freeze({
    base: 'imeal_http_request_duration_seconds',
    labels: ['route', 'method', 'status'],
  }),
  imeal_serving_confirm_duration_seconds_bucket: Object.freeze({
    base: 'imeal_serving_confirm_duration_seconds',
    labels: ['result'],
  }),
});
const HISTOGRAM_AUXILIARY = new Map(
  Object.values(HISTOGRAMS).flatMap(({ base }) => [
    [`${base}_sum`, base],
    [`${base}_count`, base],
  ]),
);
const ALLOWED_METRIC_SERIES = new Set([
  ...HARDENING_METRIC_NAMES,
  ...HISTOGRAM_AUXILIARY.keys(),
]);
const HISTOGRAM_BASE_NAMES = new Set(
  Object.values(HISTOGRAMS).map(({ base }) => base),
);
const METRIC_TYPES = new Map(
  HARDENING_METRIC_NAMES.map((name) => [
    name,
    name.endsWith('_total') ? 'counter' : 'gauge',
  ]),
);
for (const name of HISTOGRAM_BASE_NAMES) METRIC_TYPES.set(name, 'histogram');
const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const SAMPLE_PATTERN =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^{}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/;
const NUMBER_PATTERN =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const UNSAFE_METRIC_TEXT_PATTERN =
  /(?:https?:\/\/|postgres(?:ql)?:\/\/|Bearer\s+\S+|\b(?:password|token|secret|api[_-]?key|otp)\b\s*[:=])/i;


function parseMetricLabels(raw, metricName) {
  const auxiliaryBase = HISTOGRAM_AUXILIARY.get(metricName);
  const histogram = auxiliaryBase
    ? Object.values(HISTOGRAMS).find(({ base }) => base === auxiliaryBase)
    : undefined;
  const expected =
    METRIC_LABELS[metricName] ??
    (histogram
      ? Object.fromEntries(
          histogram.labels.map((label) => [
            label,
            METRIC_LABELS[`${histogram.base}_bucket`][label],
          ]),
        )
      : {});
  if (!raw) {
    if (Object.keys(expected).length > 0) {
      throw new Error(`metric labels are missing: ${metricName}`);
    }
    return {};
  }
  const labels = {};
  let cursor = 0;
  while (cursor < raw.length) {
    if (raw[cursor] === ',') cursor += 1;
    while (raw[cursor] === ' ') cursor += 1;
    const match = raw
      .slice(cursor)
      .match(/^([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/);
    if (!match) throw new Error(`metric labels are invalid: ${metricName}`);
    const [, key, encoded] = match;
    if (Object.hasOwn(labels, key)) {
      throw new Error(`metric labels are duplicated: ${metricName}`);
    }
    if (!Object.hasOwn(expected, key)) {
      throw new Error(`metric label is not approved: ${metricName}`);
    }
    let value;
    try {
      value = JSON.parse(`"${encoded}"`);
    } catch {
      throw new Error(`metric label value is invalid: ${metricName}`);
    }
    if (!expected[key].test(value)) {
      throw new Error(`metric label value is not approved: ${metricName}`);
    }
    labels[key] = value;
    cursor += match[0].length;
    while (raw[cursor] === ' ') cursor += 1;
    if (cursor < raw.length && raw[cursor] !== ',') {
      throw new Error(`metric labels are invalid: ${metricName}`);
    }
  }
  if (Object.keys(labels).length !== Object.keys(expected).length) {
    throw new Error(`metric labels are incomplete: ${metricName}`);
  }
  return labels;
}

function metricFamilyFor(name) {
  if (HISTOGRAMS[name]) return { kind: 'bucket', histogram: HISTOGRAMS[name] };
  if (HISTOGRAM_AUXILIARY.has(name)) {
    return { kind: name.endsWith('_sum') ? 'sum' : 'count', base: HISTOGRAM_AUXILIARY.get(name) };
  }
  return { kind: 'scalar' };
}

export function validateMetricsText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('metrics body is empty');
  }
  if (UNSAFE_METRIC_TEXT_PATTERN.test(text)) {
    throw new Error('metrics body is unsafe');
  }
  try {
    assertNoSecrets(text);
  } catch {
    throw new Error('metrics body is not redacted');
  }
  const samplesByName = new Map();
  const sampleKeys = new Set();
  const histogramGroups = new Map();
  const typeDeclarations = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    if (line.startsWith('#')) {
      const type = line.match(/^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*) (counter|gauge|histogram)$/);
      const help = line.match(/^# HELP ([a-zA-Z_:][a-zA-Z0-9_:]*) /);
      if (type) {
        const [, name, declaredType] = type;
        if (
          !METRIC_NAME_PATTERN.test(name) ||
          !METRIC_TYPES.has(name) ||
          HISTOGRAM_AUXILIARY.has(name) ||
          name.endsWith('_bucket')
        ) {
          throw new Error(`metric declaration is not approved: ${name}`);
        }
        if (
          typeDeclarations.has(name) &&
          typeDeclarations.get(name) !== declaredType
        ) {
          throw new Error(`metric type is conflicting: ${name}`);
        }
        typeDeclarations.set(name, declaredType);
        if (declaredType !== METRIC_TYPES.get(name)) {
          throw new Error(`metric type is invalid: ${name}`);
        }
      } else if (help) {
        const [, name] = help;
        if (!METRIC_NAME_PATTERN.test(name) || !METRIC_TYPES.has(name)) {
          throw new Error(`metric declaration is not approved: ${name}`);
        }
      } else if (line !== '# EOF') {
        throw new Error('metrics comment is not approved');
      }
      continue;
    }
    const match = line.match(SAMPLE_PATTERN);
    if (!match) throw new Error('metric sample is invalid');
    const [, name, rawLabels, rawValue] = match;
    if (!ALLOWED_METRIC_SERIES.has(name)) {
      throw new Error(`metric name is not approved: ${name}`);
    }
    const family = metricFamilyFor(name);
    const value = Number(rawValue);
    if (
      !NUMBER_PATTERN.test(rawValue) ||
      !Number.isFinite(value) ||
      value < 0 ||
      ((METRIC_TYPES.get(name) === 'counter' ||
        family.kind === 'bucket' ||
        family.kind === 'count') &&
        !Number.isSafeInteger(value))
    ) {
      throw new Error(`metric value is invalid: ${name}`);
    }
    const labels = parseMetricLabels(rawLabels, name);
    const sampleKey = `${name}:${JSON.stringify(labels)}`;
    if (sampleKeys.has(sampleKey)) {
      throw new Error(`metric sample is duplicated: ${name}`);
    }
    sampleKeys.add(sampleKey);
    const sample = { labels, value };
    const samples = samplesByName.get(name) ?? [];
    samples.push(sample);
    samplesByName.set(name, samples);
    if (family.kind === 'bucket') {
      const histogram = family.histogram;
      const bucket = labels.le;
      const groupLabels = Object.fromEntries(
        histogram.labels.map((label) => [label, labels[label]]),
      );
      const groupKey = JSON.stringify(groupLabels);
      const group = histogramGroups.get(`${name}:${groupKey}`) ?? new Map();
      if (group.has(bucket)) {
        throw new Error(`metric bucket is duplicated: ${name}`);
      }
      group.set(bucket, value);
      histogramGroups.set(`${name}:${groupKey}`, group);
    }
  }
  for (const name of HARDENING_METRIC_NAMES) {
    if (!(samplesByName.get(name)?.length > 0)) {
      throw new Error(`required metric has no numeric sample: ${name}`);
    }
    const declarationName = HISTOGRAMS[name]?.base ?? name;
    if (!typeDeclarations.has(declarationName)) {
      throw new Error(`required metric type declaration is missing: ${declarationName}`);
    }
  }
  for (const [bucketName, histogram] of Object.entries(HISTOGRAMS)) {
    const bucketSamples = samplesByName.get(bucketName) ?? [];
    const expectedBuckets = new Set(HISTOGRAM_BUCKETS);
    const groups = [...histogramGroups.entries()].filter(([key]) =>
      key.startsWith(`${bucketName}:`),
    );
    if (groups.length === 0) {
      throw new Error(`histogram has no buckets: ${bucketName}`);
    }
    const groupKeys = new Set(groups.map(([key]) => key));
    for (const [, buckets] of groups) {
      if (
        buckets.size !== expectedBuckets.size ||
        [...expectedBuckets].some((value) => !buckets.has(value))
      ) {
        throw new Error(`histogram buckets are incomplete: ${bucketName}`);
      }
      let previous = 0;
      for (const bucket of HISTOGRAM_BUCKETS) {
        const value = buckets.get(bucket);
        if (value < previous) {
          throw new Error(`histogram buckets are not cumulative: ${bucketName}`);
        }
        previous = value;
      }
    }
    for (const suffix of ['_sum', '_count']) {
      const auxiliaryName = `${histogram.base}${suffix}`;
      const auxiliarySamples = samplesByName.get(auxiliaryName) ?? [];
      if (auxiliarySamples.length !== groups.length) {
        throw new Error(`histogram auxiliary series is incomplete: ${auxiliaryName}`);
      }
      const auxiliaryGroupKeys = new Set();
      for (const sample of auxiliarySamples) {
        const labels = Object.fromEntries(
          histogram.labels.map((label) => [label, sample.labels[label]]),
        );
        const groupKey = `${bucketName}:${JSON.stringify(labels)}`;
        if (!groupKeys.has(groupKey) || auxiliaryGroupKeys.has(groupKey)) {
          throw new Error(`histogram auxiliary labels are unmatched: ${auxiliaryName}`);
        }
        auxiliaryGroupKeys.add(groupKey);
        if (suffix === '_count') {
          const buckets = histogramGroups.get(groupKey);
          if (buckets.get('+Inf') !== sample.value) {
            throw new Error(`histogram +Inf count is inconsistent: ${bucketName}`);
          }
        }
      }
    }
    if (bucketSamples.some(({ value }) => value < 0)) {
      throw new Error(`histogram bucket value is negative: ${bucketName}`);
    }
  }
  return {
    sampleCount: [...samplesByName.values()].reduce((total, samples) => total + samples.length, 0),
    metricNames: [...samplesByName.keys()],
  };
}
export const HARDENING_RUNTIME_CONTRACT = Object.freeze({
  apiLivePath: '/health/live',
  apiReadyPath: '/health/ready',
  workerLivePath: '/health/live',
  workerReadyPath: '/health/ready',
  requestIdHeader: 'x-request-id',
  metricsPath: '/metrics',
});


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
  if (check === 'ready' && response.status !== 200) {
    throw new Error(`${service} ready must return HTTP 200`);
  }
  if (
    (check === 'live' && body.status !== 'ok') ||
    (check === 'ready' && body.status !== 'ok')
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
  try {
    validateMetricsText(text);
  } catch (error) {
    throw new Error(
      `${service} metrics contract is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
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
  const approvedMetrics = new Set(requiredMetrics);
  for (const metric of new Set(rulesText.match(/\bimeal_[a-z0-9_]+\b/g) ?? [])) {
    if (!approvedMetrics.has(metric)) {
      throw new Error(`alert rules reference an unapproved metric: ${metric}`);
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
  for (const [, statuses] of rulesText.matchAll(/status=~"([^"]+)"/g)) {
    if (statuses !== '500|502|503|504') {
      throw new Error('alert rules contain an unapproved HTTP status selector');
    }
  }
  const authResult = rulesText.match(
    /imeal_auth_attempts_total\{result=~"([^"]+)"/,
  );
  if (authResult?.[1] !== 'failure|dependency_failure') {
    throw new Error('alert rules contain an unapproved auth result selector');
  }
  const servingResult = rulesText.match(
    /imeal_serving_confirm_total\{result=~"([^"]+)"/,
  );
  if (servingResult?.[1] !== 'error|failure') {
    throw new Error('alert rules contain an unapproved serving result selector');
  }
}
