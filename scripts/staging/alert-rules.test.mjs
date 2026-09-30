import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HARDENING_METRIC_NAMES,
  assertAlertRules,
} from './runtime-integration.mjs';

const RULES_PATH = new URL(
  '../../infra/staging/alert-rules.yml',
  import.meta.url,
);

async function rulesText() {
  return readFile(RULES_PATH, 'utf8');
}

test('requires every hardening-owned observability metric in the alert rules', async () => {
  const text = await rulesText();
  assert.doesNotThrow(() =>
    assertAlertRules({
      rulesText: text,
      requiredMetrics: HARDENING_METRIC_NAMES,
    }),
  );
});

test('guards approved initial alert semantics, owners/actions and edge prerequisite', async () => {
  const text = await rulesText();
  assert.match(
    text,
    /alert: ImealApiReadinessFailure[\s\S]*?increase\([\s\S]*?\) >= 2[\s\S]*?for: 1m/,
  );
  assert.match(
    text,
    /alert: ImealApiErrorRateHigh[\s\S]*?> 0\.05[\s\S]*?for: 5m/,
  );
  assert.match(text, /alert: ImealApiLatencyHigh[\s\S]*?> 1[\s\S]*?for: 10m/);
  assert.match(text, /alert: ImealOtpBacklog[\s\S]*?> 300/);
  assert.match(text, /alert: ImealWorkerStale[\s\S]*?time\(\) - 600/);
  assert.match(text, /alert: ImealBackupStale[\s\S]*?> 93600/);
  assert.match(text, /alert: ImealSecurityBoundaryViolation[\s\S]*?> 0/);
  assert.match(text, /owner:/);
  assert.match(text, /action:/);
  assert.match(text, /alert_test_route:/);
  assert.match(text, /approved edge WAF or rate-limit control/i);
  assert.doesNotMatch(text, /password|token|secret|api[_-]?key/i);
});
test('uses exact bounded status and result label selectors with absence coverage', async () => {
  const text = await rulesText();
  assert.match(text, /status=~"500\|502\|503\|504"/);
  assert.doesNotMatch(text, /status=~"5\.\."/);
  assert.match(
    text,
    /imeal_auth_attempts_total\{result=~"failure\|dependency_failure"\}/,
  );
  assert.match(
    text,
    /imeal_serving_confirm_total\{result=~"error\|failure"\}/,
  );
  assert.doesNotMatch(
    text,
    /imeal_auth_attempts_total\{result=~"(?:failure\|error|success)"/,
  );
  for (const metric of [
    'imeal_http_requests_total',
    'imeal_http_request_duration_seconds_bucket',
    'imeal_auth_attempts_total',
    'imeal_serving_confirm_total',
    'imeal_serving_confirm_duration_seconds_bucket',
    'imeal_idempotency_conflicts_total',
  ]) {
    assert.match(text, new RegExp(`absent\\(${metric}(?:\\{|\\))`));
  }
  for (const job of [
    'otp_delivery',
    'notification_dispatch',
    'registration_reminder',
    'pickup_reminder',
    'cutoff_lock',
    'pickup_session_cleanup',
    'no_show',
  ]) {
    assert.match(
      text,
      new RegExp(
        `absent\\(imeal_worker_job_(?:last_success_timestamp_seconds|lag_seconds)\\{job="${job}"\\}\\)`,
      ),
    );
  }
});


test('assertAlertRules rejects unapproved selectors and metric names', async () => {
  const text = await rulesText();
  assert.throws(
    () =>
      assertAlertRules({
        rulesText: text.replace('status=~"500|502|503|504"', 'status=~"501|599"'),
        requiredMetrics: HARDENING_METRIC_NAMES,
      }),
    /unapproved HTTP status selector/,
  );
  assert.throws(
    () =>
      assertAlertRules({
        rulesText: text.replace(
          'result=~"failure|dependency_failure"',
          'result=~"failure|unknown"',
        ),
        requiredMetrics: HARDENING_METRIC_NAMES,
      }),
    /unapproved auth result selector/,
  );
  assert.throws(
    () =>
      assertAlertRules({
        rulesText: `${text}\nimeal_unapproved_metric`,
        requiredMetrics: HARDENING_METRIC_NAMES,
      }),
    /unapproved metric/,
  );
});

test('rejects missing metrics, unsafe labels and unsupported stock directives', () => {
  assert.throws(
    () =>
      assertAlertRules({
        rulesText: 'groups:\n  - name: test\n    rules: []',
        requiredMetrics: ['imeal_http_requests_total'],
      }),
    /missing required metric/,
  );
  assert.throws(
    () =>
      assertAlertRules({
        rulesText: 'imeal_http_requests_total password: leaked rate_limit:',
        requiredMetrics: ['imeal_http_requests_total'],
      }),
    /unsafe|unsupported/i,
  );
});
