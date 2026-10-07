import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { EXPECTED_JOB_IDS, EXPECTED_LANE_IDS } from './ci-contracts.mjs';
import {
  DEVELOP_REQUIRED_JOB_NAMES,
  PROTECTED_STAGING_JOB_NAME,
} from './branch-protection-checks.mjs';
const require = createRequire(import.meta.url);

const { parse } = require('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow() {
  return parse(await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8'));
}

test('workflow graph keeps exact aggregate context and grouped matrix producers', async () => {
  const document = await workflow();
  assert.equal(document.name, 'staging-readiness');
  const jobs = document.jobs;
  assert.equal(jobs.checks.name, 'Secretless qualification (disposable PostgreSQL)');
  assert.deepEqual(jobs.checks.needs, [...EXPECTED_JOB_IDS]);
  assert.equal(jobs.checks.if, 'always()');

  assert.equal(jobs.security.name, 'Security matrix');
  assert.equal(jobs.security.strategy['fail-fast'], false);
  assert.deepEqual(jobs.security.strategy.matrix.kind, ['audit', 'secrets']);
  assert.doesNotMatch(jobs.security.name, /\$\{\{|matrix\./);

  assert.equal(jobs.images.name, 'Image build scan SBOM matrix');
  assert.equal(jobs.images.strategy['fail-fast'], false);
  assert.deepEqual(jobs.images.strategy.matrix.service, ['api', 'worker', 'admin-web']);
  assert.doesNotMatch(jobs.images.name, /\$\{\{|matrix\./);

  for (const id of ['security-audit', 'security-secrets', 'images-api', 'images-worker', 'images-admin-web']) {
    assert.equal(jobs[id], undefined, `${id} must not be a standalone job`);
  }
  for (const id of ['static', 'suites', 'mobile-export', 'mobile-smoke', 'db', 'tooling']) {
    assert.equal(jobs[id].strategy, undefined, `${id} must not use a matrix`);
  }

  const securityRun = jobs.security.steps.find((step) => step.id === 'produce').run;
  assert.ok(securityRun.includes('node scripts/ci/checks.mjs --lane "security-${{ matrix.kind }}"'));
  assert.ok(securityRun.includes('node scripts/ci/ci-dispatcher.mjs --allow-docker --release-id "$RELEASE_ID" --lane-id "security-${{ matrix.kind }}" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT" --source-sha "$GITHUB_SHA" --workflow-sha "$GITHUB_WORKFLOW_SHA"'));
  const securityUpload = jobs.security.steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  assert.equal(securityUpload.if, 'always()');
  assert.equal(securityUpload.with.name, 'staging-qualification-${{ env.RELEASE_ID }}-security-${{ matrix.kind }}');
  assert.equal(securityUpload.with.path, '${{ runner.temp }}/ci/security-${{ matrix.kind }}');
  assert.equal(securityUpload.with['if-no-files-found'], 'error');
  assert.equal(securityUpload.with.overwrite, true);
  assert.equal(securityUpload.with['retention-days'], 14);

  const imagesRun = jobs.images.steps.find((step) => step.id === 'produce').run;
  for (const fragment of [
    'node scripts/ci/checks.mjs --lane "images-${{ matrix.service }}"',
    'set +e',
    'node scripts/ci/ci-dispatcher.mjs --allow-docker --release-id "$RELEASE_ID" --lane-id "images-${{ matrix.service }}" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT" --source-sha "$GITHUB_SHA" --workflow-sha "$GITHUB_WORKFLOW_SHA"',
    'dispatch_status=$?',
    'set -e',
    'docker image inspect --format \'{{.Id}}\' "imeal/${{ matrix.service }}:${GITHUB_SHA}"',
    'build-image-sbom-${{ matrix.service }}.spdx.json',
    'sha256sum',
    'image-inspection.txt',
    'node scripts/ci/record-built-image.mjs',
    '"${{ matrix.service }}" "$GITHUB_SHA"',
    'test -f "$RUNNER_TEMP/ci/images-${{ matrix.service }}/producer-result.json"',
    'exit "$dispatch_status"',
  ]) {
    assert.equal(imagesRun.includes(fragment), true, fragment);
  }
  const imagesUpload = jobs.images.steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  assert.equal(imagesUpload.if, 'always()');
  assert.equal(imagesUpload.with.name, 'staging-qualification-${{ env.RELEASE_ID }}-images-${{ matrix.service }}');
  assert.equal(imagesUpload.with.path, '${{ runner.temp }}/ci/images-${{ matrix.service }}');
  assert.equal(imagesUpload.with['if-no-files-found'], 'error');
  assert.equal(imagesUpload.with.overwrite, true);
  assert.equal(imagesUpload.with['retention-days'], 14);
});

test('mobile production and HTTP smoke jobs are independent mandatory lanes', async () => {
  const jobs = (await workflow()).jobs;
  assert.equal(jobs['mobile-export'].strategy, undefined);
  assert.equal(jobs['mobile-smoke'].strategy, undefined);
  assert.match(jobs['mobile-export'].name, /production export/);
  assert.match(jobs['mobile-smoke'].name, /HTTP smoke/);
});

test('producer uploads and aggregate downloads use explicit stable lane references', async () => {
  const jobs = (await workflow()).jobs;
  for (const id of EXPECTED_JOB_IDS) {
    const steps = jobs[id].steps ?? [];
    const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4');
    assert.ok(upload, `${id} must upload producer evidence`);
    assert.equal(upload.with.overwrite, true);
    assert.match(upload.with.name, /staging-qualification-/);
  }
  const expectedLanes = [...EXPECTED_LANE_IDS];
  const aggregateSteps = (await workflow()).jobs.checks.steps ?? [];
  const downloads = aggregateSteps.filter((step) => step.uses === 'actions/download-artifact@v4');
  assert.deepEqual(downloads.map((step) => step.with.path), expectedLanes.map((lane) => `\${{ runner.temp }}/ci/evidence/${lane}`));
  assert.deepEqual(downloads.map((step) => step.with.name), expectedLanes.map((lane) => `staging-qualification-\${{ env.RELEASE_ID }}-${lane}`));
  assert.ok(downloads.every((step) => step.if === 'always() && !cancelled()'));
  const cancellationMarker = aggregateSteps.find((step) => step.id === 'global_cancellation');
  assert.equal(cancellationMarker.if, 'cancelled()');
  assert.match(cancellationMarker.run, /cancelled=true/);
  const aggregate = aggregateSteps.find((step) => JSON.stringify(step).includes('aggregate-qualification.mjs'));
  assert.equal(aggregate.if, 'always()');
  assert.match(aggregate.run, /--cancelled "\$\{\{ steps\.global_cancellation\.outputs\.cancelled \|\| 'false' \}\}"/);
  const successUpload = aggregateSteps.find((step) => step.uses === 'actions/upload-artifact@v4' && String(step.with.name).startsWith('staging-readiness-inputs-'));
  assert.match(successUpload.if, /success\(\).*!cancelled\(\)/);
  const diagnosticsUpload = aggregateSteps.find((step) => step.uses === 'actions/upload-artifact@v4' && String(step.with.name).startsWith('staging-qualification-diagnostics-'));
  assert.match(diagnosticsUpload.if, /always\(\).*cancelled\(\)/);
  const finalFailure = aggregateSteps.find((step) => step.run === 'exit 1');
  assert.equal(finalFailure.if, 'always() && (cancelled() || steps.aggregate.outcome != \'success\')');
  const protectedUpload = jobs['staging-deploy'].steps.find((step) => step.uses === 'actions/upload-artifact@v4' && String(step.with.name).startsWith('staging-release-'));
  assert.match(protectedUpload.with.name, /-attempt\$\{\{ github\.run_attempt \}\}$/);
});

test('protected staging qualification remains environment-gated and off the PR gate', async () => {
  const staging = (await workflow()).jobs['staging-deploy'];
  assert.equal(staging.name, PROTECTED_STAGING_JOB_NAME);
  assert.equal(staging.needs, 'checks');
  assert.equal(staging.environment.name, 'staging');
  const eligibility = String(staging.if);
  assert.match(eligibility, /needs\.checks\.result == 'success'/);
  assert.match(eligibility, /github\.event_name == 'push'/);
  assert.match(eligibility, /github\.ref == 'refs\/heads\/deploy\/staging'/);
  assert.match(eligibility, /github\.event_name == 'workflow_dispatch'/);
  assert.match(eligibility, /inputs\.deploy_staging == true/);
  assert.doesNotMatch(eligibility, /pull_request/);
  assert.equal(DEVELOP_REQUIRED_JOB_NAMES.includes(PROTECTED_STAGING_JOB_NAME), false);
  const text = await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8');
  assert.match(text, /protected-qualification\.mjs verify-images/);
  assert.match(text, /protected-qualification\.mjs wait-runtime/);
  assert.match(text, /--gate-service migrate/);
  assert.match(text, /protected-qualification\.mjs assert-artifacts/);
  assert.match(text, /protected-qualification\.mjs rollback-reference/);
  for (const name of [
    'STAGING_ENV_FILE',
    'STAGING_SMOKE_SESSION_TOKEN',
    'STAGING_API_ORIGIN',
    'STAGING_WORKER_ORIGIN',
    'STAGING_ADMIN_ORIGIN',
    'STAGING_IMAGE_DIGESTS_JSON',
    'STAGING_ROLLBACK_ARTIFACT',
  ]) {
    assert.equal(text.includes(name), true, name);
  }
  const teardown = staging.steps.find((step) => String(step.name).includes('Tear down'));
  assert.equal(teardown.if, 'always()');
  assert.match(teardown.run, /docker compose/);
  assert.match(teardown.run, /down/);
});
