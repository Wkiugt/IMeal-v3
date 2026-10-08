import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAudit } from './security-audit.mjs';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function report({ packageName = 'braces', version = '3.0.3', advisoryId = 1240992, ghsa = 'GHSA-vfj7-8cjw-p6xm', severity = 'high', vulnerableVersions = '<=3.0.3', id, url, treeVersions } = {}) {
  return JSON.stringify({
    value: packageName,
    children: {
      ID: id ?? advisoryId,
      URL: url ?? `https://github.com/advisories/${ghsa}`,
      Severity: severity,
      'Vulnerable Versions': vulnerableVersions,
      'Tree Versions': treeVersions ?? [version],
      Dependents: ['test-dependent@npm:1.0.0'],
    },
  });
}


test('accepts the exact braces and node-forge exceptions before expiry', () => {
  const decision = evaluateAudit({
    stdout: [
      report(),
      report({ packageName: 'node-forge', version: '1.4.0', advisoryId: 1240912, ghsa: 'GHSA-86w9-cpqp-85rv', vulnerableVersions: '<=1.4.0' }),
    ].join('\n'),
    exitCode: 1,
    now: NOW,
  });
  assert.equal(decision.accepted, true);
  assert.match(decision.messages.join('\n'), /accepted braces@3\.0\.3/);
  assert.match(decision.messages.join('\n'), /accepted node-forge@1\.4\.0/);
});

test('rejects unknown advisories at every severity', () => {
  for (const severity of ['critical', 'high', 'moderate', 'low']) {
    const decision = evaluateAudit({
      stdout: report({ packageName: 'other-package', version: '9.9.9', advisoryId: 9876543, ghsa: 'GHSA-unknown-unknown-unknown', severity, vulnerableVersions: '<10' }),
      exitCode: 1,
      now: NOW,
    });
    assert.equal(decision.accepted, false);
    assert.match(decision.messages[0], /unapproved/);
  }
});

test('rejects changed package, version, URL, advisory ID, range, severity, and mixed versions', () => {
  const changed = [
    report({ packageName: 'other-package' }),
    report({ version: '3.0.2', treeVersions: ['3.0.2'] }),
    report({ url: 'https://github.com/advisories/GHSA-other-other-other' }),
    report({ advisoryId: 9999999 }),
    report({ vulnerableVersions: '<3.0.3' }),
    report({ severity: 'critical' }),
    report({ treeVersions: ['3.0.3', '3.0.2'] }),
  ];
  for (const stdout of changed) {
    assert.equal(evaluateAudit({ stdout, exitCode: 1, now: NOW }).accepted, false);
  }
});

test('rejects exceptions at and after the UTC expiry', () => {
  for (const now of [new Date('2026-11-06T00:00:00.000Z'), new Date('2026-11-07T00:00:00.000Z')]) {
    const decision = evaluateAudit({ stdout: report(), exitCode: 1, now });
    assert.equal(decision.accepted, false);
    assert.match(decision.messages.join('\n'), /expired/);
  }
});

test('accepts the clean Yarn JSON shape and rejects malformed or incomplete reports', () => {
  assert.equal(evaluateAudit({ stdout: '', stderr: '', exitCode: 0, now: NOW }).accepted, true);
  assert.equal(evaluateAudit({ stdout: '{not-json', stderr: '', exitCode: 1, now: NOW }).accepted, false);
  assert.equal(evaluateAudit({ stdout: JSON.stringify({ value: 'braces', children: {} }), stderr: '', exitCode: 1, now: NOW }).accepted, false);
  assert.equal(evaluateAudit({ stdout: '', stderr: '', exitCode: 1, now: NOW }).accepted, false);
  assert.equal(evaluateAudit({ stdout: report(), stderr: 'registry lookup failed', exitCode: 1, now: NOW }).accepted, false);
});

test('rejects unsupported process exits and invalid exception clocks', () => {
  for (const exitCode of [2, 7, 137]) {
    assert.equal(evaluateAudit({ stdout: report(), stderr: '', exitCode, now: NOW }).accepted, false);
  }
  assert.equal(evaluateAudit({ stdout: report(), stderr: '', exitCode: 1, now: new Date('invalid') }).accepted, false);
});
