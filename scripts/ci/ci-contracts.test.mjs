import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandCatalogue } from './checks.mjs';
import { test } from 'node:test';
import {
  EXPECTED_JOB_IDS,
  EXPECTED_LANE_IDS,
  JOB_LANES,
  EXPECTED_STEP_IDS,
  aggregateQualification,
  createProducerEvidence,
  laneArtifactName,
  releaseIdFor,
  sha256FileContent,
  validateProducerEvidence,
} from './ci-contracts.mjs';
import { aggregateFromDirectory } from './aggregate-qualification.mjs';

const context = {
  releaseId: releaseIdFor({ runId: '99', sourceSha: 'a'.repeat(40) }),
  runId: '99',
  currentAttempt: 2,
  sourceSha: 'a'.repeat(40),
  workflowSha: 'b'.repeat(40),
  imageFiles: {
    'images-api': '{"spdxVersion":"2.3","name":"api"}',
    'images-worker': '{"spdxVersion":"2.3","name":"worker"}',
    'images-admin-web': '{"spdxVersion":"2.3","name":"admin-web"}',
  },
  imageInspections: {
    'images-api': `sha256:${'c'.repeat(64)}`,
    'images-worker': `sha256:${'c'.repeat(64)}`,
    'images-admin-web': `sha256:${'c'.repeat(64)}`,
  },
};

function imageStepArgv(laneId, stepId, imageId) {
  const service = laneId.slice('images-'.length);
  const command = commandCatalogue({
    lane: laneId,
    service,
    outputDirectory: '/tmp/imeal-ci-contract-test',
    trivyImage: `aquasecurity/trivy@sha256:${'d'.repeat(64)}`,
  }).find((candidate) => candidate.id === stepId);
  return command.argv.map((arg) => arg.replaceAll('{{IMAGE_ID}}', imageId));
}

function evidence(laneId, result = 'PASS', runAttempt = 2) {
  const service = laneId.startsWith('images-') ? laneId.slice('images-'.length) : undefined;
  const imageContent = service ? context.imageFiles[laneId] : undefined;
  const image = service
    ? {
        service,
        sourceTag: `imeal/${service}:${context.sourceSha}`,
        imageId: `sha256:${'c'.repeat(64)}`,
        sbomSha256: sha256FileContent(imageContent),
        sbomPath: `build-image-sbom-${service}.spdx.json`,
      }
    : undefined;
  return createProducerEvidence({
    ...context,
    laneId,
    result,
    runAttempt,
    workflowSha: context.workflowSha,
    artifactName: laneArtifactName(context.releaseId, laneId),
    image,
    steps: EXPECTED_STEP_IDS[laneId].map((id) => ({
      id,
      result,
      elapsedMs: 12,
      exitCode: result === 'PASS' ? 0 : 1,
      argv: service && ['scan', 'sbom'].includes(id)
        ? imageStepArgv(laneId, id, image.imageId)
        : service && id === 'build'
          ? ['docker', 'build']
          : ['node', id],
    })),
  });
}

function allEvidence() {
  return EXPECTED_LANE_IDS.map((laneId) => evidence(laneId));
}

function successfulNeeds() {
  return Object.fromEntries(EXPECTED_JOB_IDS.map((jobId) => [jobId, { result: 'success' }]));
}

test('release identity is stable across rerun attempts', () => {
  assert.equal(
    releaseIdFor({ runId: '99', sourceSha: 'a'.repeat(40) }),
    releaseIdFor({ runId: '99', sourceSha: 'a'.repeat(40), runAttempt: 1 }),
  );
});

test('GitHub job IDs and evidence lanes stay distinct and fully mapped', () => {
  assert.deepEqual(Object.keys(JOB_LANES), [...EXPECTED_JOB_IDS]);
  assert.deepEqual(Object.values(JOB_LANES).flat(), [...EXPECTED_LANE_IDS]);
  assert.equal(new Set(Object.values(JOB_LANES).flat()).size, EXPECTED_LANE_IDS.length);
  assert.equal(EXPECTED_JOB_IDS.length, 8);
  assert.equal(EXPECTED_LANE_IDS.length, 11);
  assert.notDeepEqual([...EXPECTED_JOB_IDS], [...EXPECTED_LANE_IDS]);
});

test('aggregator requires every producer lane and job result', () => {
  assert.throws(
    () =>
      aggregateQualification({
        evidence: allEvidence().slice(1),
        needs: successfulNeeds(),
        context,
      }),
    /missing producer evidence/i,
  );

  const needs = successfulNeeds();
  delete needs[EXPECTED_JOB_IDS[0]];
  assert.throws(
    () => aggregateQualification({ evidence: allEvidence(), needs, context }),
    /missing producer job result/i,
  );
});

test('aggregator reports producer failures and preserves diagnostics', () => {
  const failed = evidence(EXPECTED_LANE_IDS[0], 'FAIL');
  failed.diagnostics = ['command failed: redacted diagnostic'];
  const report = aggregateQualification({
    evidence: [failed, ...allEvidence().slice(1)],
    needs: successfulNeeds(),
    context,
  });
  assert.equal(report.result, 'FAIL');
  assert.equal(report.verifiedStatuses[EXPECTED_LANE_IDS[0]], 'FAIL');
  assert.deepEqual(report.failureDiagnostics[0].diagnostics, [
    'command failed: redacted diagnostic',
  ]);
  assert.deepEqual(
    report.jobStatuses,
    Object.fromEntries(EXPECTED_JOB_IDS.map((jobId) => [jobId, 'success'])),
  );
});

test('aggregate PASS maps actual verified statuses rather than unconditional PASS', () => {
  const report = aggregateQualification({
    evidence: allEvidence(),
    needs: successfulNeeds(),
    context,
  });
  assert.equal(report.result, 'PASS');
  assert.deepEqual(
    Object.values(report.verifiedStatuses),
    EXPECTED_LANE_IDS.map(() => 'PASS'),
  );
  assert.equal(report.provenance.runId, context.runId);
  assert.equal(report.provenance.sourceSha, context.sourceSha);
  assert.equal(report.stagingQualification, false);
  assert.equal(report.productionQualification, false);
  assert.equal(report.qualificationClass, 'secretless-disposable-postgresql');
});

test('global cancellation fails closed even when every producer and job reports success', () => {
  const report = aggregateQualification({
    evidence: allEvidence(),
    needs: successfulNeeds(),
    context: { ...context, cancelled: true },
  });
  assert.equal(report.result, 'FAIL');
  assert.match(report.failureDiagnostics[0].diagnostics[0], /globally cancelled/i);
});

test('directory aggregation does not project unvalidated producer PASS fields', async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'qualification-invalid-source-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'qualification-invalid-output-'));
  const invalidEvidence = allEvidence().map((item) =>
    item.laneId === 'static' ? { ...item, sourceSha: 'f'.repeat(40) } : item,
  );
  for (const item of invalidEvidence) {
    const directory = join(evidenceRoot, item.laneId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'producer-result.json'), `${JSON.stringify(item)}\n`);
    if (item.laneId.startsWith('images-')) {
      const service = item.laneId.slice('images-'.length);
      await writeFile(join(directory, `build-image-sbom-${service}.spdx.json`), context.imageFiles[item.laneId]);
      await writeFile(join(directory, 'image-inspection.txt'), context.imageInspections[item.laneId]);
    }
  }
  const report = await aggregateFromDirectory({
    evidenceRoot,
    outputDirectory,
    needs: successfulNeeds(),
    context,
  });
  assert.equal(report.result, 'FAIL');
  assert.equal(report.typecheck, 'UNVERIFIED');
  assert.equal(report.db, 'UNVERIFIED');
  assert.equal(report.stagingTools, 'UNVERIFIED');
  assert.equal(report.sbom, undefined);
});

test('provenance rejects a producer from another workflow, source, run, or future attempt', () => {
  for (const patch of [
    { workflowSha: 'c'.repeat(40) },
    { sourceSha: 'c'.repeat(40) },
    { runId: '100' },
    { runAttempt: 3 },
  ]) {
    const item = { ...evidence(EXPECTED_LANE_IDS[0]), ...patch };
    assert.throws(() => validateProducerEvidence(item, { ...context }), /provenance|attempt/i);
  }
});

test('partial rerun accepts prior producer evidence only when it is bound to this run and source', () => {
  const item = evidence(EXPECTED_LANE_IDS[0], 'PASS', 1);
  assert.equal(validateProducerEvidence(item, context).result, 'PASS');
  assert.throws(
    () => validateProducerEvidence({ ...item, runAttempt: 0 }, context),
    /attempt/i,
  );
});
test('mandatory job failures fail closed while unknown or missing job results reject', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const needs = successfulNeeds();
    needs[EXPECTED_JOB_IDS[0]] = { result };
    const report = aggregateQualification({
      evidence: allEvidence(),
      needs,
      context,
    });
    assert.equal(report.result, 'FAIL');
    assert.equal(report.jobStatuses[EXPECTED_JOB_IDS[0]], result);
  }

  for (const result of ['', 'successfully', null]) {
    const needs = successfulNeeds();
    needs[EXPECTED_JOB_IDS[0]] = { result };
    assert.throws(
      () => aggregateQualification({ evidence: allEvidence(), needs, context }),
      /job result/i,
    );
  }

  assert.throws(
    () =>
      aggregateQualification({
        evidence: [],
        needs: {},
        context,
      }),
    /missing producer job result|missing producer evidence/i,
  );
});

test('aggregator rejects unexpected needs keys', () => {
  for (const jobId of ['security-audit', 'images-api', 'not-a-job']) {
    assert.throws(
      () =>
        aggregateQualification({
          evidence: allEvidence(),
          needs: { ...successfulNeeds(), [jobId]: { result: 'success' } },
          context,
        }),
      /unexpected producer job result/i,
    );
  }
});

test('matrix job failure fails closed even when every lane evidence is PASS', () => {
  for (const jobId of ['security', 'images']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = successfulNeeds();
      needs[jobId] = { result };
      const report = aggregateQualification({
        evidence: allEvidence(),
        needs,
        context,
      });
      assert.equal(report.result, 'FAIL');
      assert.equal(report.jobStatuses[jobId], result);
      assert.deepEqual(
        Object.values(report.verifiedStatuses),
        EXPECTED_LANE_IDS.map(() => 'PASS'),
      );
    }
  }
});

test('aggregator rejects duplicate or incomplete lane sets', () => {
  const first = evidence(EXPECTED_LANE_IDS[0]);
  assert.throws(
    () =>
      aggregateQualification({
        evidence: [first, first, ...allEvidence().slice(1)],
        needs: successfulNeeds(),
        context,
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      aggregateQualification({
        evidence: [...allEvidence(), { ...first, laneId: 'unexpected-lane' }],
        needs: successfulNeeds(),
        context,
      }),
    /unexpected|duplicate/i,
  );
});

test('PASS producer cannot hide failed, blocked, missing, or inconsistent substeps', () => {
  for (const patch of [
    { steps: [{ id: 'step', result: 'FAIL', elapsedMs: 1, exitCode: 1 }] },
    { steps: [{ id: 'step', result: 'BLOCKED', elapsedMs: 1, exitCode: -2 }] },
    { steps: [] },
    { steps: [{ id: 'step', result: 'PASS', elapsedMs: 1, exitCode: 1 }] },
    { steps: [{ id: 'step', result: 'PASS', elapsedMs: 1 }] },
  ]) {
    assert.throws(
      () =>
        validateProducerEvidence(
          { ...evidence(EXPECTED_LANE_IDS[0]), ...patch },
          context,
        ),
      /step|PASS|exit/i,
    );
  }
});

test('image evidence requires inspected immutable identity and SBOM content binding', () => {
  const imageLane = EXPECTED_LANE_IDS.find((laneId) => laneId.startsWith('images-'));
  assert.ok(imageLane);
  const valid = evidence(imageLane);
  assert.equal(validateProducerEvidence(valid, context).image.imageId, valid.image.imageId);
  const brokenContent = {
    ...context,
    imageFiles: { ...context.imageFiles, [imageLane]: 'tampered SBOM bytes' },
  };
  assert.throws(
    () =>
      aggregateQualification({
        evidence: allEvidence(),
        needs: successfulNeeds(),
        context: brokenContent,
      }),
    /SBOM content hash mismatch/i,
  );
  const brokenIdentity = {
    ...context,
    imageInspections: {
      ...context.imageInspections,
      [imageLane]: `sha256:${'e'.repeat(64)}`,
    },
  };
  assert.throws(
    () =>
      aggregateQualification({
        evidence: allEvidence(),
        needs: successfulNeeds(),
        context: brokenIdentity,
      }),
    /inspected image identity mismatch/i,
  );
  assert.equal(validateProducerEvidence(valid, context).image.imageId, valid.image.imageId);
  for (const image of [
    { ...valid.image, imageId: `imeal/${imageLane}: ${context.sourceSha}` },
    { ...valid.image, imageId: 'not-an-image-id' },
    { ...valid.image, sbomSha256: 'not-a-hash' },
    { ...valid.image, service: 'other' },
    { ...valid.image, sbomPath: '../outside.spdx.json' },
  ]) {
    assert.throws(
      () => validateProducerEvidence({ ...valid, image }, context),
      /image|SBOM|digest|service|path/i,
    );
  }
});

test('image tool targets match catalogue source and exact inspected identity positions', () => {
  const valid = evidence('images-api');
  const validated = validateProducerEvidence(valid, context);
  assert.equal(validated.image.imageId, valid.image.imageId);
  const scan = valid.steps.find((step) => step.id === 'scan');
  const sbom = valid.steps.find((step) => step.id === 'sbom');

  const withStepArgv = (stepId, argv) => ({
    ...valid,
    steps: valid.steps.map((step) => (step.id === stepId ? { ...step, argv } : step)),
  });
  assert.throws(
    () => validateProducerEvidence(withStepArgv('scan', [...scan.argv.slice(0, -1), valid.image.sourceTag]), context),
    /target/i,
  );
  assert.throws(
    () => validateProducerEvidence(withStepArgv('scan', [...scan.argv.slice(0, -1), `sha256:${'e'.repeat(64)}`]), context),
    /target/i,
  );
  assert.throws(
    () => validateProducerEvidence(withStepArgv('scan', [...scan.argv.slice(0, -1), valid.image.imageId, valid.image.sourceTag]), context),
    /target/i,
  );
  assert.throws(
    () => validateProducerEvidence(withStepArgv('scan', [...scan.argv.slice(0, -1), '--output', valid.image.imageId]), context),
    /target/i,
  );
  const imageSourceIndex = scan.argv.indexOf('--image-src');
  assert.throws(
    () => validateProducerEvidence(
      withStepArgv(
        'scan',
        [...scan.argv.slice(0, imageSourceIndex + 2), '--image-src', 'registry', ...scan.argv.slice(imageSourceIndex + 2)],
      ),
      context,
    ),
    /target/i,
  );
  assert.throws(
    () => validateProducerEvidence(withStepArgv('sbom', sbom.argv.map((arg) => arg === `docker:${valid.image.imageId}` ? valid.image.sourceTag : arg)), context),
    /target/i,
  );
  assert.throws(
    () => validateProducerEvidence(
      withStepArgv(
        'sbom',
        sbom.argv.map((arg) => arg === `docker:${valid.image.imageId}` ? `docker:sha256:${'e'.repeat(64)}` : arg),
      ),
      context,
    ),
    /target/i,
  );
});
