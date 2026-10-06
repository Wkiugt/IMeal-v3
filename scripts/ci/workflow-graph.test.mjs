import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow() {
  return parse(await readFile(resolve(root, '.github/workflows/staging-readiness.yml'), 'utf8'));
}

test('workflow graph keeps exact aggregate context and complete producer job IDs', async () => {
  const jobs = (await workflow()).jobs;
  assert.equal(jobs.checks.name, 'Secretless qualification (disposable PostgreSQL)');
  assert.deepEqual(jobs.checks.needs, [
    'static',
    'suites',
    'mobile-export',
    'mobile-smoke',
    'db',
    'tooling',
    'security',
    'images',
  ]);
  assert.equal(jobs.checks.if, 'always()');
  assert.deepEqual(jobs.security.strategy.matrix.kind, ['audit', 'secrets']);
  assert.equal(jobs.security.strategy['fail-fast'], false);
  assert.deepEqual(jobs.images.strategy.matrix.service, ['api', 'worker', 'admin-web']);
  assert.equal(jobs.images.strategy['fail-fast'], false);
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
  for (const id of ['static', 'suites', 'mobile-export', 'mobile-smoke', 'db', 'tooling', 'security', 'images']) {
    const steps = jobs[id].steps ?? [];
    const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4');
    assert.ok(upload, `${id} must upload producer evidence`);
    assert.equal(upload.with.overwrite, true);
    assert.match(upload.with.name, /staging-qualification-/);
  }
  const expectedLanes = ['static', 'suites', 'mobile-export', 'mobile-smoke', 'db', 'tooling', 'security-audit', 'security-secrets', 'images-api', 'images-worker', 'images-admin-web'];
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
