import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('production release is dispatch-only and fails closed before deploy', async () => {
  const text = await readFile(resolve(root, '.github/workflows/production-release.yml'), 'utf8');
  const workflow = parse(text);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.pull_request, undefined);
  assert.equal(workflow.jobs.release.name, 'Production release');
  assert.equal(workflow.jobs.release.environment.name, 'production');
  assert.equal(workflow.jobs.release.if, "github.event_name == 'workflow_dispatch'");
  const inputs = workflow.on.workflow_dispatch.inputs;
  for (const name of [
    'release_sha',
    'release_id',
    'image_digests_json',
    'migration_gate_digest',
    'rollback_artifact',
    'staging_evidence_run_id',
    'staging_evidence_artifact',
    'approved_lineage',
  ]) {
    assert.equal(inputs[name].required, true, name);
  }
  assert.equal(workflow.jobs.release['runs-on'], '${{ vars.PRODUCTION_RUNNER_LABEL }}');
  assert.doesNotMatch(String(workflow.jobs.release['runs-on']), /ubuntu-latest|ubuntu-24\.04/);
  assert.doesNotMatch(text, /runs-on:\s*ubuntu-(?:latest|24\.04)/);
  assert.doesNotMatch(text, /compose[^\n]*\bdown\b|--volumes|--remove-orphans/);
  assert.doesNotMatch(text, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  const runnerStep = workflow.jobs.release.steps[0];
  assert.match(String(runnerStep.run), /PRODUCTION_RUNNER_LABEL/);
  assert.match(String(runnerStep.run), /ubuntu-latest/);
  assert.match(String(runnerStep.run), /ubuntu-24\.04/);
  assert.match(String(runnerStep.run), /exit 1/);
  const steps = workflow.jobs.release.steps;
  const gate = steps.find((step) => String(step.run).includes('--exit-code-from migration-gate migration-gate'));
  assert.ok(gate, 'migration gate step is required');
  const script = String(gate.run);
  assert.ok(script.indexOf('IMEAL_PRODUCTION_DEPLOY') < script.indexOf('docker compose'));
  assert.match(script, /workflow_dispatch/);
  const deploy = steps.find((step) => String(step.run).includes('up --detach --no-build api worker admin-web caddy'));
  assert.ok(deploy, 'production service deploy step is required');
  const deployScript = String(deploy.run);
  assert.ok(deployScript.indexOf('IMEAL_PRODUCTION_DEPLOY') < deployScript.indexOf('docker compose'));
  assert.match(deployScript, /workflow_dispatch/);
  assert.ok(steps.indexOf(gate) < steps.indexOf(deploy));
  assert.ok(steps.indexOf(deploy) < steps.findIndex((step) => String(step.run).includes('wait-runtime')));
  const joined = JSON.stringify(workflow.jobs.release.steps);
  for (const command of [
    'verify-staging-evidence',
    'verify-images',
    'scan-digests',
    'verify:production-boundary',
    'scripts/backup/cli.mjs backup',
    'scripts/backup/cli.mjs verify',
    'phase0-preflight.mjs',
    'wait-runtime',
    'runtime-health',
    'staging:smoke',
    'staging:manifest',
    'rollback-reference',
    'assert-artifacts',
  ]) {
    assert.equal(joined.includes(command), true, command);
  }
});
