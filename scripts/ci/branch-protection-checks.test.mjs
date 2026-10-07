import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EXPECTED_JOB_IDS } from './ci-contracts.mjs';
import {
  DEVELOP_REQUIRED_JOB_NAMES,
  DEVELOP_REQUIRED_STATUS_CHECKS,
  PROTECTED_STAGING_JOB_NAME,
  WORKFLOW_NAME,
} from './branch-protection-checks.mjs';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow() {
  return parse(await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8'));
}

test('required branch-protection job names are literal and stable', async () => {
  const document = await workflow();
  assert.equal(document.name, WORKFLOW_NAME);
  const jobs = document.jobs;
  assert.deepEqual(jobs.checks.needs, [...EXPECTED_JOB_IDS]);
  const names = Object.values(jobs).map((job) => job.name);
  for (const name of names) {
    assert.equal(typeof name, 'string');
    assert.doesNotMatch(name, /\$\{\{|matrix\./);
  }
  for (const name of DEVELOP_REQUIRED_JOB_NAMES) {
    assert.equal(names.filter((candidate) => candidate === name).length, 1, name);
  }
  assert.equal(names.includes(PROTECTED_STAGING_JOB_NAME), true);
  assert.equal(DEVELOP_REQUIRED_JOB_NAMES.includes(PROTECTED_STAGING_JOB_NAME), false);
  for (const id of EXPECTED_JOB_IDS) {
    assert.equal(jobs[id].strategy, undefined, `${id} must not use a matrix`);
  }
  assert.equal(jobs.security, undefined);
  assert.equal(jobs.images, undefined);
  const runbook = await readFile(resolve(root, 'docs/runbooks/branch-protection.md'), 'utf8');
  for (const check of DEVELOP_REQUIRED_STATUS_CHECKS) {
    assert.equal(runbook.includes(check), true, check);
  }
  assert.match(runbook, /not use a GitHub admin token/i);
});

test('protected staging path calls real gates and does not relabel secretless CI', async () => {
  const text = await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8');
  assert.match(text, /protected-qualification\.mjs verify-images/);
  assert.match(text, /protected-qualification\.mjs wait-runtime/);
  assert.match(text, /--gate-service migrate/);
  assert.match(text, /protected-qualification\.mjs assert-artifacts/);
  assert.match(text, /protected-qualification\.mjs rollback-reference/);
  assert.match(text, /Secretless qualification \(disposable PostgreSQL\)/);
  assert.doesNotMatch(text, /strategy:\s*\n\s*fail-fast:[\s\S]*matrix:/);
});
