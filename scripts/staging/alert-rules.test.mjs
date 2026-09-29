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
