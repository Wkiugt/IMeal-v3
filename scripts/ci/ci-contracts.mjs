import { createHash } from 'node:crypto';

export const EXPECTED_JOB_IDS = Object.freeze([
  'static',
  'suites',
  'mobile-export',
  'mobile-smoke',
  'db',
  'tooling',
  'security',
  'images',
]);

export const EXPECTED_LANE_IDS = Object.freeze([
  'static',
  'suites',
  'mobile-export',
  'mobile-smoke',
  'db',
  'tooling',
  'security-audit',
  'security-secrets',
  'images-api',
  'images-worker',
  'images-admin-web',
]);

export const EXPECTED_STEP_IDS = Object.freeze({
  static: ['typecheck', 'lint'],
  suites: ['unit', 'client-suites', 'build-order', 'ci-behavior'],
  'mobile-export': ['expo-install-check', 'expo-doctor', 'export', 'export-negative'],
  'mobile-smoke': ['smoke'],
  db: ['prep-build', 'prisma-validate', 'migrate', 'domain-db', 'api-db', 'worker-db'],
  tooling: ['regression', 'production-boundary', 'production-boundary-verify', 'compose'],
  'security-audit': ['audit'],
  'security-secrets': ['secrets'],
  'images-api': ['build', 'scan', 'sbom'],
  'images-worker': ['build', 'scan', 'sbom'],
  'images-admin-web': ['build', 'scan', 'sbom'],
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{7,128}$/i;
const HEX64 = /^[a-f0-9]{64}$/i;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/i;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const SECRET_LIKE = /(authorization\s*[:=]|bearer\s+|password\s*[:=]|token\s*[:=]|secret\s*[:=]|client_secret|private[_ -]?key|otp\s*[:=])/i;

const JOB_LANES = Object.freeze({
  static: ['static'],
  suites: ['suites'],
  'mobile-export': ['mobile-export'],
  'mobile-smoke': ['mobile-smoke'],
  db: ['db'],
  tooling: ['tooling'],
  security: ['security-audit', 'security-secrets'],
  images: ['images-api', 'images-worker', 'images-admin-web'],
});

function assertSafe(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function assertSha(value, name) {
  if (typeof value !== 'string' || !SHA.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function redact(value) {
  return String(value)
    .replace(/((?:https?|postgres(?:ql)?|mysql|mongodb):\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(?:password|token|secret|authorization|client_secret|private[_ -]?key|otp)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

function assertNoSecrets(value, name) {
  const encoded = JSON.stringify(value).replaceAll('[REDACTED]', '');
  if (SECRET_LIKE.test(encoded)) {
    throw new Error(`${name} contains a secret-like value`);
  }
}

export function releaseIdFor({ runId, sourceSha }) {
  assertSafe(String(runId), 'run ID');
  assertSha(sourceSha, 'source SHA');
  return `imeal-${runId}-${sourceSha}`;
}

export function laneArtifactName(releaseId, laneId) {
  assertSafe(releaseId, 'release ID');
  assertSafe(laneId, 'lane ID');
  return `staging-qualification-${releaseId}-${laneId}`;
}

export function createProducerEvidence({
  releaseId,
  laneId,
  result,
  runId,
  runAttempt,
  sourceSha,
  workflowSha,
  artifactName = laneArtifactName(releaseId, laneId),
  steps = [],
  diagnostics = [],
  image,
}) {
  const evidence = {
    schemaVersion: 2,
    type: 'imeal-ci-producer',
    releaseId,
    laneId,
    artifactName,
    result,
    runId: String(runId),
    runAttempt,
    sourceSha,
    workflowSha,
    steps,
    diagnostics: diagnostics.map(redact),
    ...(image ? { image } : {}),
    producedAt: new Date().toISOString(),
  };
  return evidence;
}

function validateStep(step, laneId) {
  if (!step || typeof step !== 'object' || !SAFE_ID.test(String(step.id ?? ''))) {
    throw new Error(`producer ${laneId} has an invalid step`);
  }
  if (!['PASS', 'FAIL', 'BLOCKED'].includes(step.result)) {
    throw new Error(`producer ${laneId} has a blocked or missing step result`);
  }
  if (!Number.isInteger(step.elapsedMs) || step.elapsedMs < 0) {
    throw new Error(`producer ${laneId} has an invalid step duration`);
  }
  if (!Number.isInteger(step.exitCode)) {
    throw new Error(`producer ${laneId} has an invalid step exit code`);
  }
  if (step.exitCode !== 0 && step.result === 'PASS') {
    throw new Error(`producer ${laneId} marks a nonzero step as PASS`);
  }
  if (step.result !== 'PASS' && step.exitCode === 0) {
    throw new Error(`producer ${laneId} marks a zero-exit step as ${step.result}`);
  }
  return step;
}

function validateImage(image, laneId, sourceSha) {
  const service = laneId.slice('images-'.length);
  if (!image || image.service !== service) {
    throw new Error(`producer ${laneId} is missing matching image service evidence`);
  }
  if (!IMAGE_ID.test(String(image.imageId ?? ''))) {
    throw new Error(`producer ${laneId} image ID is not an inspected immutable ID`);
  }
  if (!HEX64.test(String(image.sbomSha256 ?? ''))) {
    throw new Error(`producer ${laneId} SBOM content hash is missing or invalid`);
  }
  if (
    typeof image.sbomPath !== 'string' ||
    !SAFE_PATH.test(image.sbomPath) ||
    !image.sbomPath.endsWith(`build-image-sbom-${service}.spdx.json`)
  ) {
    throw new Error(`producer ${laneId} SBOM path is not bound to its image`);
  }
  const expectedSourceTag = `imeal/${service}:${sourceSha}`;
  if (image.sourceTag !== expectedSourceTag) {
    throw new Error(`producer ${laneId} source tag is not exact`);
  }
  return image;
}

function validateImageBinding(image, laneId, context) {
  if (!context.imageFiles || !context.imageInspections) {
    throw new Error(`producer ${laneId} is missing downloaded image binding evidence`);
  }
  const content = context.imageFiles[laneId];
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    throw new Error(`producer ${laneId} SBOM bytes are unavailable`);
  }
  if (sha256FileContent(content) !== image.sbomSha256) {
    throw new Error(`producer ${laneId} SBOM content hash mismatch`);
  }
  if (context.imageInspections[laneId] !== image.imageId) {
    throw new Error(`producer ${laneId} inspected image identity mismatch`);
  }
  return image;
}

function validateImageToolTarget(step, laneId, imageId, stepId) {
  const argv = step?.argv;
  const invalid = () => {
    throw new Error(`producer ${laneId} ${stepId} target is not bound to inspected image`);
  };
  if (
    !Array.isArray(argv) ||
    argv.some((arg) => typeof arg !== 'string') ||
    argv[0] !== 'docker' ||
    argv[1] !== 'run'
  ) {
    invalid();
  }
  if (stepId === 'scan') {
    const imageCommandIndexes = argv.flatMap((arg, index) => (arg === 'image' ? [index] : []));
    const imageCommandIndex = imageCommandIndexes.length === 1 ? imageCommandIndexes[0] : -1;
    const trivyImage = imageCommandIndex > 0 ? argv[imageCommandIndex - 1] : '';
    if (
      imageCommandIndex < 1 ||
      !/^[A-Za-z0-9._/-]+\/trivy@sha256:[a-f0-9]{64}$/i.test(trivyImage)
    ) {
      invalid();
    }
    const valueOptions = new Map([
      ['--image-src', 'docker'],
      ['--timeout', '15m'],
      ['--exit-code', '1'],
      ['--severity', 'HIGH,CRITICAL'],
    ]);
    const flagOptions = new Set(['--ignore-unfixed']);
    const seen = new Set();
    let target;
    for (let index = imageCommandIndex + 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (valueOptions.has(arg)) {
        if (seen.has(arg) || argv[index + 1] !== valueOptions.get(arg)) invalid();
        seen.add(arg);
        index += 1;
      } else if (flagOptions.has(arg)) {
        if (seen.has(arg)) invalid();
        seen.add(arg);
      } else if (target === undefined && !arg.startsWith('-')) {
        target = arg;
      } else {
        invalid();
      }
    }
    if (
      target !== imageId ||
      seen.size !== valueOptions.size + flagOptions.size ||
      argv.filter((arg) => arg === imageId).length !== 1
    ) {
      invalid();
    }
    return step;
  }
  const syftImageIndexes = argv.flatMap((arg, index) =>
    /^anchore\/syft@sha256:[a-f0-9]{64}$/i.test(arg) ? [index] : [],
  );
  const syftImageIndex = syftImageIndexes.length === 1 ? syftImageIndexes[0] : -1;
  const service = laneId.slice('images-'.length);
  const expectedTarget = `docker:${imageId}`;
  const expectedOutput = `spdx-json=/out/build-image-sbom-${service}.spdx.json`;
  if (
    syftImageIndex < 0 ||
    argv[syftImageIndex + 1] !== expectedTarget ||
    argv[syftImageIndex + 2] !== '--output' ||
    argv[syftImageIndex + 3] !== expectedOutput ||
    argv.length !== syftImageIndex + 4 ||
    argv.filter((arg) => arg === expectedTarget).length !== 1 ||
    argv.includes(imageId)
  ) {
    invalid();
  }
  return step;
}

export function validateProducerEvidence(evidence, context) {
  if (evidence.schemaVersion !== 2 || evidence.type !== 'imeal-ci-producer') {
    throw new Error('producer evidence schema/type is invalid');
  }
  const laneId = assertSafe(evidence.laneId, 'lane ID');
  if (!EXPECTED_LANE_IDS.includes(laneId)) throw new Error(`unexpected producer lane ${laneId}`);
  const expectedArtifact = laneArtifactName(context.releaseId, laneId);
  if (evidence.releaseId !== context.releaseId) throw new Error(`producer ${laneId} release provenance mismatch`);
  if (evidence.artifactName !== expectedArtifact) throw new Error(`producer ${laneId} artifact reference mismatch`);
  if (String(evidence.runId) !== String(context.runId)) throw new Error(`producer ${laneId} run provenance mismatch`);
  if (evidence.sourceSha !== context.sourceSha) throw new Error(`producer ${laneId} source provenance mismatch`);
  if (evidence.workflowSha !== context.workflowSha) throw new Error(`producer ${laneId} workflow provenance mismatch`);
  if (!Number.isInteger(evidence.runAttempt) || evidence.runAttempt < 1 || evidence.runAttempt > context.currentAttempt) {
    throw new Error(`producer ${laneId} attempt provenance is invalid`);
  }
  if (evidence.result !== 'PASS' && evidence.result !== 'FAIL') {
    throw new Error(`producer ${laneId} result is invalid`);
  }
  if (!Array.isArray(evidence.steps) || evidence.steps.length === 0) {
    throw new Error(`producer ${laneId} has no substep evidence`);
  }
  const expectedSteps = EXPECTED_STEP_IDS[laneId];
  const stepIds = evidence.steps.map((step) => step.id);
  if (
    !expectedSteps ||
    new Set(stepIds).size !== stepIds.length ||
    stepIds.length !== expectedSteps.length ||
    stepIds.some((id) => !expectedSteps.includes(id))
  ) {
    throw new Error(`producer ${laneId} substep set is incomplete`);
  }
  const steps = evidence.steps.map((step) => validateStep(step, laneId));
  if (evidence.result === 'PASS' && steps.some((step) => step.result !== 'PASS')) {
    throw new Error(`producer ${laneId} cannot PASS with failed substeps`);
  }
  if (!Array.isArray(evidence.diagnostics)) throw new Error(`producer ${laneId} diagnostics are invalid`);
  for (const diagnostic of evidence.diagnostics) {
    if (
      typeof diagnostic !== 'string' ||
      SECRET_LIKE.test(diagnostic.replaceAll('[REDACTED]', ''))
    ) {
      throw new Error(`producer ${laneId} diagnostics are not redacted`);
    }
  }
  let image;
  if (laneId.startsWith('images-')) {
    if (evidence.image) {
      image = validateImageBinding(
        validateImage(evidence.image, laneId, context.sourceSha),
        laneId,
        context,
      );
    } else {
      const build = evidence.steps.find((step) => step.id === 'build');
      const downstreamBlocked = evidence.steps
        .filter((step) => step.id !== 'build')
        .every((step) => step.result === 'BLOCKED');
      if (build?.result !== 'FAIL' || !downstreamBlocked) {
        throw new Error(`producer ${laneId} is missing matching image service evidence`);
      }
    }
  } else {
    image = evidence.image;
  }
  if (image) {
    for (const stepId of ['scan', 'sbom']) {
      const step = steps.find((candidate) => candidate.id === stepId);
      if (!step) {
        throw new Error(`producer ${laneId} ${stepId} target is not bound to inspected image`);
      }
      validateImageToolTarget(step, laneId, image.imageId, stepId);
    }
  }
  const validated = { ...evidence, steps, ...(image ? { image } : {}) };
  assertNoSecrets(validated, `producer ${laneId}`);
  return validated;
}

export function aggregateQualification({ evidence, needs, context }) {
  if (!context || !context.releaseId || !context.runId || !context.sourceSha || !context.workflowSha) {
    throw new Error('qualification context is incomplete');
  }
  if (!needs || typeof needs !== 'object') throw new Error('producer job result set is missing');
  const jobStatuses = {};
  for (const jobId of EXPECTED_JOB_IDS) {
    const result = needs[jobId]?.result;
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(result)) {
      throw new Error(`missing producer job result for ${jobId}`);
    }
    jobStatuses[jobId] = result;
  }
  const knownJobs = new Set(EXPECTED_JOB_IDS);
  for (const jobId of Object.keys(needs)) {
    if (!knownJobs.has(jobId)) throw new Error(`unexpected producer job result ${jobId}`);
  }
  if (!Array.isArray(evidence)) throw new Error('producer evidence set is missing');
  const byLane = new Map();
  for (const item of evidence) {
    const validated = validateProducerEvidence(item, context);
    if (byLane.has(validated.laneId)) throw new Error(`duplicate producer lane ${validated.laneId}`);
    byLane.set(validated.laneId, validated);
  }
  for (const laneId of EXPECTED_LANE_IDS) {
    if (!byLane.has(laneId)) throw new Error(`missing producer evidence for ${laneId}`);
  }
  const verifiedStatuses = Object.fromEntries(
    EXPECTED_LANE_IDS.map((laneId) => [laneId, byLane.get(laneId).result]),
  );
  const globalCancellation = context.cancelled === true;
  const jobFailures = Object.entries(jobStatuses)
    .filter(([, result]) => result !== 'success')
    .map(([jobId, result]) => ({ jobId, result, diagnostics: [`producer job ${jobId} ended ${result}`] }));
  const failureDiagnostics = [
    ...(globalCancellation
      ? [{ diagnostics: ['workflow run was globally cancelled; qualification is not eligible'] }]
      : []),
    ...jobFailures,
    ...EXPECTED_LANE_IDS
      .map((laneId) => byLane.get(laneId))
      .filter((item) => item.result !== 'PASS')
      .map((item) => ({ laneId: item.laneId, diagnostics: item.diagnostics })),
  ];
  const result =
    !globalCancellation &&
    Object.values(verifiedStatuses).every((status) => status === 'PASS') &&
    jobFailures.length === 0
      ? 'PASS'
      : 'FAIL';
  const producerReferences = Object.fromEntries(
    EXPECTED_LANE_IDS.map((laneId) => {
      const item = byLane.get(laneId);
      return [laneId, { artifactName: item.artifactName, runAttempt: item.runAttempt, result: item.result }];
    }),
  );
  const imageReferences = Object.fromEntries(
    EXPECTED_LANE_IDS.filter((laneId) => laneId.startsWith('images-')).map((laneId) => {
      const item = byLane.get(laneId);
      return [laneId, item.image];
    }),
  );
  const report = {
    schemaVersion: 2,
    type: 'imeal-ci-qualification',
    result,
    releaseId: context.releaseId,
    verifiedStatuses,
    jobStatuses,
    producerReferences,
    imageReferences,
    failureDiagnostics,
    provenance: {
      runId: String(context.runId),
      sourceSha: context.sourceSha,
      workflowSha: context.workflowSha,
      currentAttempt: context.currentAttempt,
      policy: 'stable release id; producer attempts must match run/source/workflow and be <= aggregate attempt',
    },
  };
  assertNoSecrets(report, 'qualification report');
  return report;
}

export function sha256FileContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

export { JOB_LANES, redact };
