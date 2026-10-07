import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertArtifactTree,
  assertDeployedDigests,
  assertMigrationGateEvidence,
  assertRequiredInputs,
  classifyQualification,
  evaluateRuntimeHealth,
  parseComposePs,
  scanProtectedDigests,
  verifyProtectedImages,
  verifyStagingReleaseEvidence,
  waitForProtectedRuntime,
} from './protected-qualification.mjs';

const digest = (char) => `${'a'.repeat(63)}${char}`;
const image = (name, char) => `registry.example/imeal/${name}@sha256:${digest(char)}`;
const images = {
  api: image('api', '1'),
  worker: image('worker', '2'),
  adminWeb: image('admin', '3'),
};
const migrationGate = image('migration', '4');
const trivy = `aquasec/trivy@sha256:${digest('5')}`;

function envFile() {
  return [
    `API_IMAGE=${images.api}`,
    `WORKER_IMAGE=${images.worker}`,
    `ADMIN_WEB_IMAGE=${images.adminWeb}`,
    `MIGRATION_GATE_IMAGE=${migrationGate}`,
    'RELEASE_VERSION=release-1',
  ].join('\n');
}

test('image contract requires immutable api, worker, admin, and migration-gate digests', () => {
  const report = verifyProtectedImages({ images, envText: envFile() });
  assert.equal(report.migrationGate, migrationGate);
  assert.throws(() => verifyProtectedImages({ images, envText: 'RELEASE_VERSION=release-1\n' }), /required in the protected env contract/);
  assert.throws(
    () => verifyProtectedImages({ images: { ...images, api: 'registry.example/imeal/api:latest' }, envText: envFile() }),
    /repository@sha256/,
  );
  assert.throws(() => assertRequiredInputs({ STAGING_ENV_FILE: '' }), /missing protected input: STAGING_ENV_FILE/);
});

test('artifact scan rejects env files and credential URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-artifacts-'));
  await writeFile(join(directory, 'notes.json'), '{"result":"PASS"}\n');
  await assertArtifactTree(directory);
  await writeFile(join(directory, 'staging.env'), 'TOKEN=value\n');
  await assert.rejects(assertArtifactTree(directory), /not uploadable/);
  const other = await mkdtemp(join(tmpdir(), 'imeal-artifacts-'));
  await writeFile(join(other, 'leak.json'), '{"url":"postgres://user:pass@db.example/imeal"}\n');
  await assert.rejects(assertArtifactTree(other), /not redacted/);
});

test('migration gate, health, and deployed digests fail closed', () => {
  const evidence = {
    release: 'release-1',
    migration: '20260928000000',
    targetSchema: 'public',
    approvalId: 'approval-1',
    completedAt: '2026-10-06T10:00:00.000Z',
  };
  assert.equal(assertMigrationGateEvidence(evidence, 'release-1').result, 'PASS');
  assert.throws(() => assertMigrationGateEvidence({ ...evidence, release: 'other' }, 'release-1'), /does not match/);
  const services = parseComposePs(
    [
      '{"Service":"migrate","State":"exited","Health":"","ExitCode":0}',
      '{"Service":"api","State":"running","Health":"healthy","ExitCode":0}',
      '{"Service":"worker","State":"running","Health":"healthy","ExitCode":0}',
      '{"Service":"admin-web","State":"running","Health":"healthy","ExitCode":0}',
    ].join('\n'),
  );
  assert.equal(evaluateRuntimeHealth(services).result, 'PASS');
  assert.throws(
    () => evaluateRuntimeHealth(services.map((service) => (service.service === 'api' ? { ...service, health: 'unhealthy' } : service))),
    /api is not healthy/,
  );
  assert.throws(
    () =>
      assertDeployedDigests({
        expected: { ...images, migrationGate },
        observed: {
          api: [],
          worker: [images.worker],
          'admin-web': [images.adminWeb],
          'migration-gate': [migrationGate],
        },
      }),
    /digest mismatch/,
  );
});

test('secretless classification is not staging qualification and missing evidence is not synthesized', async () => {
  assert.equal(classifyQualification('Secretless qualification (disposable PostgreSQL)').stagingQualification, false);
  const directory = await mkdtemp(join(tmpdir(), 'imeal-evidence-'));
  await assert.rejects(
    verifyStagingReleaseEvidence({
      directory,
      artifactName: 'staging-readiness-inputs-imeal',
      expectedSha: 'a'.repeat(40),
      approvedLineage: 'approval-1',
    }),
    /not staging qualification/,
  );
  assert.deepEqual(await readdir(directory), []);
});

test('digest scan does not skip an unscannable reference', async () => {
  const calls = [];
  await assert.rejects(
    scanProtectedDigests({
      images: { ...images, migrationGate: 'registry.example/imeal/migration:latest' },
      trivyImage: trivy,
      outputDirectory: await mkdtemp(join(tmpdir(), 'imeal-scan-')),
      commandRunner: async (...args) => {
        calls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    }),
    /repository@sha256/,
  );
  assert.equal(calls.length, 0);
});

test('runtime wait records gate evidence and compares deployed digests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-wait-'));
  const evidence = {
    release: 'release-1',
    migration: '20260928000000',
    targetSchema: 'public',
    approvalId: 'approval-1',
    completedAt: '2026-10-06T10:00:00.000Z',
  };
  const ps = [
    '{"Service":"migrate","State":"exited","Health":"","ExitCode":0}',
    '{"Service":"api","State":"running","Health":"healthy","ExitCode":0}',
    '{"Service":"worker","State":"running","Health":"healthy","ExitCode":0}',
    '{"Service":"admin-web","State":"running","Health":"healthy","ExitCode":0}',
  ].join('\n');
  const digests = {
    api: [images.api],
    worker: [images.worker],
    'admin-web': [images.adminWeb],
    migrate: [migrationGate],
  };
  let lastService = 'api';
  const result = await waitForProtectedRuntime({
    composePrefix: ['compose', '--env-file', 'staging.env', '-f', 'docker-compose.yml'],
    gateService: 'migrate',
    expectedImages: { ...images, migrationGate },
    expectedRelease: 'release-1',
    outputDirectory: directory,
    timeoutMs: 0,
    commandRunner: async (command, args) => {
      if (args.includes('ps') && args.includes('json')) return { stdout: ps, stderr: '', exitCode: 0 };
      if (args.includes('-aq')) {
        lastService = args.at(-1);
        return { stdout: `container-${lastService}\n`, stderr: '', exitCode: 0 };
      }
      if (command === 'docker' && args[0] === 'cp') {
        await writeFile(args.at(-1), `${JSON.stringify(evidence)}\n`);
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'inspect') {
        return { stdout: `${JSON.stringify(digests[lastService] ?? [])}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    },
  });
  assert.equal(result.gate.result, 'PASS');
  assert.equal(result.digests.result, 'PASS');
});
