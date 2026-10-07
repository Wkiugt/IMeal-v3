import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EXPECTED_JOB_IDS, EXPECTED_LANE_IDS } from './ci-contracts.mjs';
import {
  DEVELOP_REQUIRED_JOB_NAMES,
  DEVELOP_REQUIRED_STATUS_CHECKS,
  PROTECTED_STAGING_JOB_NAME,
  STAGING_BRANCH_REQUIRED_STATUS_CHECKS,
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
  assert.equal(jobs.security.name, 'Security matrix');
  assert.equal(jobs.security.strategy['fail-fast'], false);
  assert.deepEqual(jobs.security.strategy.matrix.kind, ['audit', 'secrets']);
  assert.equal(jobs.images.name, 'Image build scan SBOM matrix');
  assert.equal(jobs.images.strategy['fail-fast'], false);
  assert.deepEqual(jobs.images.strategy.matrix.service, ['api', 'worker', 'admin-web']);
  for (const id of ['security-audit', 'security-secrets', 'images-api', 'images-worker', 'images-admin-web']) {
    assert.equal(jobs[id], undefined, `${id} must not be a standalone job`);
  }
  assert.deepEqual(jobs.checks.needs, [...EXPECTED_JOB_IDS]);
  assert.equal(jobs.checks.name, 'Secretless qualification (disposable PostgreSQL)');
  const names = Object.values(jobs).map((job) => job.name);
  for (const name of names) {
    assert.equal(typeof name, 'string');
    assert.doesNotMatch(name, /\$\{\{|matrix\./);
  }
  assert.deepEqual([...DEVELOP_REQUIRED_JOB_NAMES], [
    'Secretless qualification (disposable PostgreSQL)',
  ]);
  assert.deepEqual([...DEVELOP_REQUIRED_STATUS_CHECKS], [
    'staging-readiness / Secretless qualification (disposable PostgreSQL)',
  ]);
  assert.deepEqual(
    [...STAGING_BRANCH_REQUIRED_STATUS_CHECKS],
    [...DEVELOP_REQUIRED_STATUS_CHECKS],
  );
  for (const name of DEVELOP_REQUIRED_JOB_NAMES) {
    assert.equal(names.filter((candidate) => candidate === name).length, 1, name);
  }
  assert.equal(names.includes(PROTECTED_STAGING_JOB_NAME), true);
  assert.equal(DEVELOP_REQUIRED_JOB_NAMES.includes(PROTECTED_STAGING_JOB_NAME), false);
  for (const name of [
    'Security audit',
    'Security secrets',
    'Image build scan SBOM api',
    'Image build scan SBOM worker',
    'Image build scan SBOM admin-web',
    'Security matrix (audit)',
    'Image build scan SBOM matrix (api)',
    'Static checks',
    'Workspace suites',
  ]) {
    assert.equal(DEVELOP_REQUIRED_JOB_NAMES.includes(name), false, name);
  }
  for (const id of ['static', 'suites', 'mobile-export', 'mobile-smoke', 'db', 'tooling']) {
    assert.equal(jobs[id].strategy, undefined, `${id} must not use a matrix`);
  }
  const downloads = jobs.checks.steps.filter((step) => step.uses === 'actions/download-artifact@v4');
  assert.deepEqual(
    downloads.map((step) => step.with.path),
    EXPECTED_LANE_IDS.map((lane) => `\${{ runner.temp }}/ci/evidence/${lane}`),
  );
  assert.deepEqual(
    downloads.map((step) => step.with.name),
    EXPECTED_LANE_IDS.map((lane) => `staging-qualification-\${{ env.RELEASE_ID }}-${lane}`),
  );
  const runbook = await readFile(resolve(root, 'docs/runbooks/branch-protection.md'), 'utf8');
  for (const check of DEVELOP_REQUIRED_STATUS_CHECKS) {
    assert.equal(runbook.includes(check), true, check);
  }
  assert.match(runbook, /not use a GitHub admin token/i);
  assert.match(runbook, /Security matrix \(audit\)/);
  assert.match(runbook, /Image build scan SBOM matrix \(api\)/);
  assert.match(runbook, /Do not require matrix child/);
  assert.match(runbook, /not be a required pull-request status check/);
});

test('protected staging path calls real gates and does not relabel secretless CI', async () => {
  const document = await workflow();
  const staging = document.jobs['staging-deploy'];
  assert.equal(staging.needs, 'checks');
  assert.equal(staging.environment.name, 'staging');
  assert.doesNotMatch(String(staging.if), /pull_request/);
  assert.equal(DEVELOP_REQUIRED_JOB_NAMES.includes(PROTECTED_STAGING_JOB_NAME), false);
  const text = await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8');
  assert.match(text, /protected-qualification\.mjs verify-images/);
  assert.match(text, /protected-qualification\.mjs wait-runtime/);
  assert.match(text, /--gate-service migrate/);
  assert.match(text, /protected-qualification\.mjs assert-artifacts/);
  assert.match(text, /protected-qualification\.mjs rollback-reference/);
  assert.match(text, /Secretless qualification \(disposable PostgreSQL\)/);
  assert.match(text, /strategy:\r?\n\s*fail-fast: false\r?\n\s*matrix:/);
});
