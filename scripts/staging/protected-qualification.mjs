import childProcess from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoSecrets, safeDiagnostic } from './staging-lib.mjs';
import { runImageScan } from './image-scan.mjs';
import { runRuntimeIntegration } from './runtime-integration.mjs';

export const IMAGE_DIGEST_PATTERN =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}$/i;
const APP_IMAGE_KEYS = Object.freeze(['adminWeb', 'api', 'worker']);
const HEALTH_SERVICES = Object.freeze(['api', 'worker', 'admin-web']);
const SECRET_FILE_PATTERN =
  /(^|\/)(?:\.env(?:\..*)?|.*\.env|staging\.env|production\.env|credentials(?:\.[a-z0-9]+)?|id_rsa|id_ed25519)$/i;
const SECRET_TEXT_PATTERN =
  /(?:postgres(?:ql)?:\/\/[^\s/]+@[^\s]+|\bBearer\s+(?!<redacted>)[^\s]+|-----BEGIN [^-\n]*PRIVATE KEY-----|\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*(?!<redacted>)[^\s,}\]]+)/i;
const LINEAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const REQUIRED_STAGING_INPUTS = Object.freeze([
  'STAGING_ENV_FILE',
  'STAGING_SMOKE_SESSION_TOKEN',
  'STAGING_API_ORIGIN',
  'STAGING_WORKER_ORIGIN',
  'STAGING_ADMIN_ORIGIN',
  'STAGING_IMAGE_DIGESTS_JSON',
  'STAGING_ROLLBACK_ARTIFACT',
]);

export const REQUIRED_PRODUCTION_INPUTS = Object.freeze([
  'PRODUCTION_ENV_FILE',
  'IMEAL_PRODUCTION_DEPLOY',
  'PRODUCTION_APPROVAL_ID',
  'PRODUCTION_SMOKE_SESSION_TOKEN',
  'PRODUCTION_API_ORIGIN',
  'PRODUCTION_WORKER_ORIGIN',
  'PRODUCTION_ADMIN_ORIGIN',
  'IMEAL_BACKUP_DATABASE_URL',
  'AGE_RECIPIENT',
  'IMEAL_BACKUP_S3_ENDPOINT',
  'IMEAL_BACKUP_S3_BUCKET',
  'IMEAL_BACKUP_S3_PREFIX',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
]);

export function assertImmutableImage(value, label) {
  if (typeof value !== 'string' || !IMAGE_DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be repository@sha256:<64 hex>`);
  }
  if (/:latest(?:@|$)/i.test(value)) {
    throw new Error(`${label} must not use a mutable tag`);
  }
  return value;
}

export function assertRequiredInputs(values, names = REQUIRED_STAGING_INPUTS) {
  if (!values || typeof values !== 'object') {
    throw new Error('protected inputs are required');
  }
  const missing = names.filter((name) => {
    const value = values[name];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new Error(`missing protected input: ${missing.join(', ')}`);
  }
}

function parseEnvAssignments(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('protected env has an invalid assignment');
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(values, match[1])) {
      throw new Error('protected env has duplicate keys');
    }
    values[match[1]] = value;
  }
  return values;
}

export function verifyProtectedImages({
  images,
  envText,
  migrationGateDigest,
  requireMigrationGate = true,
}) {
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new Error('protected image digest input must be an object');
  }
  if (Object.keys(images).sort().join(',') !== APP_IMAGE_KEYS.join(',')) {
    throw new Error('protected image digest input has unsupported fields');
  }
  const contract = {
    api: assertImmutableImage(images.api, 'api image'),
    worker: assertImmutableImage(images.worker, 'worker image'),
    adminWeb: assertImmutableImage(images.adminWeb, 'admin web image'),
  };
  const env = typeof envText === 'string' ? parseEnvAssignments(envText) : {};
  const envImages = {
    API_IMAGE: contract.api,
    WORKER_IMAGE: contract.worker,
    ADMIN_WEB_IMAGE: contract.adminWeb,
  };
  for (const [key, expected] of Object.entries(envImages)) {
    if (typeof envText === 'string' && env[key] === undefined) {
      throw new Error(`${key} is required in the protected env contract`);
    }
    if (env[key] !== undefined && env[key] !== expected) {
      throw new Error(`${key} does not match the immutable image input`);
    }
    if (env[key] !== undefined) assertImmutableImage(env[key], key);
  }
  if (typeof envText === 'string' && requireMigrationGate && !env.MIGRATION_GATE_IMAGE) {
    throw new Error('MIGRATION_GATE_IMAGE is required in the protected env contract');
  }
  const migrationGate = env.MIGRATION_GATE_IMAGE || migrationGateDigest;
  if (requireMigrationGate || migrationGate) {
    contract.migrationGate = assertImmutableImage(
      migrationGate,
      'migration-gate image',
    );
    if (
      migrationGateDigest &&
      contract.migrationGate !== assertImmutableImage(migrationGateDigest, 'migration-gate image input')
    ) {
      throw new Error('migration-gate image input does not match the env contract');
    }
    if (env.MIGRATION_GATE_IMAGE && env.MIGRATION_GATE_IMAGE !== contract.migrationGate) {
      throw new Error('MIGRATION_GATE_IMAGE does not match the immutable image input');
    }
  }
  const report = { result: 'PASS', ...contract };
  assertNoSecrets(report);
  return report;
}

export function assertMigrationGateEvidence(evidence, expectedRelease) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('migration gate evidence is missing');
  }
  const required = ['release', 'migration', 'targetSchema', 'approvalId', 'completedAt'];
  for (const key of required) {
    if (typeof evidence[key] !== 'string' || evidence[key].trim() === '') {
      throw new Error(`migration gate evidence is missing ${key}`);
    }
  }
  if (expectedRelease && evidence.release !== expectedRelease) {
    throw new Error('migration gate evidence release does not match');
  }
  if (!ISO_TIMESTAMP_PATTERN.test(evidence.completedAt)) {
    throw new Error('migration gate evidence timestamp is invalid');
  }
  if (SECRET_TEXT_PATTERN.test(JSON.stringify(evidence))) {
    throw new Error('migration gate evidence is not redacted');
  }
  assertNoSecrets(evidence);
  return {
    result: 'PASS',
    kind: 'migration-gate-wait',
    release: evidence.release,
    migration: evidence.migration,
    targetSchema: evidence.targetSchema,
    completedAt: evidence.completedAt,
  };
}

export function parseComposePs(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  const rows = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!Array.isArray(rows)) throw new Error('compose status payload is invalid');
  return rows.map((row) => ({
    service: row.Service || row.service,
    state: String(row.State || row.state || '').toLowerCase(),
    health: String(row.Health || row.health || '').toLowerCase(),
    exitCode: Number(row.ExitCode ?? row.exitCode),
  }));
}

export function evaluateRuntimeHealth(services, { gateService = 'migrate' } = {}) {
  if (!Array.isArray(services)) throw new Error('runtime service status is missing');
  const byName = new Map(services.map((service) => [service.service, service]));
  const gate = byName.get(gateService);
  if (!gate || gate.state !== 'exited' || gate.exitCode !== 0) {
    throw new Error('migration gate did not exit 0');
  }
  for (const name of HEALTH_SERVICES) {
    const service = byName.get(name);
    if (!service || service.state !== 'running' || service.health !== 'healthy') {
      throw new Error(`${name} is not healthy`);
    }
  }
  return {
    result: 'PASS',
    kind: 'runtime-health',
    gateService,
    services: [gateService, ...HEALTH_SERVICES].map((name) => byName.get(name)),
  };
}

export function assertDeployedDigests({ expected, observed }) {
  const wanted = {
    api: expected.api,
    worker: expected.worker,
    'admin-web': expected.adminWeb ?? expected['admin-web'],
    'migration-gate': expected.migrationGate ?? expected['migration-gate'],
  };
  const mismatches = [];
  for (const [service, digest] of Object.entries(wanted)) {
    assertImmutableImage(digest, `${service} expected image`);
    const actual = observed?.[service];
    if (!Array.isArray(actual) || actual.length === 0 || !actual.includes(digest)) {
      mismatches.push(service);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`deployed image digest mismatch: ${mismatches.join(', ')}`);
  }
  return { result: 'PASS', kind: 'deployed-digests', images: wanted };
}

export function assertArtifactPathSafe(relativePath) {
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (SECRET_FILE_PATTERN.test(normalized) || normalized.split('/').includes('.env')) {
    throw new Error(`artifact path is not uploadable: ${normalized}`);
  }
  return normalized;
}

export function assertArtifactTextSafe(relativePath, text) {
  assertArtifactPathSafe(relativePath);
  if (typeof text === 'string' && SECRET_TEXT_PATTERN.test(text)) {
    throw new Error(`artifact content is not redacted: ${relativePath}`);
  }
}

export async function assertArtifactTree(directory) {
  const root = resolve(directory);
  const info = await stat(root).catch(() => {
    throw new Error('artifact directory is missing');
  });
  if (!info.isDirectory()) throw new Error('artifact directory is missing');
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      const relativePath = relative(root, path);
      assertArtifactPathSafe(relativePath);
      if (entry.isSymbolicLink()) throw new Error(`artifact symlink is not uploadable: ${relativePath}`);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`artifact entry is not a file: ${relativePath}`);
      const text = await readFile(path, 'utf8').catch(() => null);
      if (text !== null) assertArtifactTextSafe(relativePath, text);
    }
  }
  return { result: 'PASS', kind: 'artifact-redaction' };
}

export function buildRollbackReference({
  releaseId,
  commit,
  images,
  migrationGate,
  rollbackArtifact,
}) {
  if (!RELEASE_ID_PATTERN.test(releaseId ?? '')) throw new Error('rollback release id is invalid');
  if (!COMMIT_PATTERN.test(commit ?? '')) throw new Error('rollback commit is invalid');
  if (typeof rollbackArtifact !== 'string' || rollbackArtifact.trim() === '') {
    throw new Error('rollback artifact reference is required');
  }
  if (SECRET_TEXT_PATTERN.test(rollbackArtifact) || /\s/.test(rollbackArtifact)) {
    throw new Error('rollback artifact reference is not redacted');
  }
  const reference = {
    result: 'PASS',
    kind: 'rollback-reference',
    releaseId,
    commit: commit.toLowerCase(),
    images: {
      api: assertImmutableImage(images?.api, 'api image'),
      worker: assertImmutableImage(images?.worker, 'worker image'),
      adminWeb: assertImmutableImage(images?.adminWeb, 'admin web image'),
    },
    migrationGate: assertImmutableImage(migrationGate, 'migration-gate image'),
    rollbackArtifact,
    automaticDatabaseRollback: false,
    volumesDestroyed: false,
  };
  assertNoSecrets(reference);
  return reference;
}

export function classifyQualification(jobName) {
  if (jobName === 'Secretless qualification (disposable PostgreSQL)') {
    return {
      qualificationClass: 'secretless-disposable-postgresql',
      stagingQualification: false,
      productionQualification: false,
    };
  }
  if (jobName === 'Protected staging qualification (ephemeral Compose)') {
    return {
      qualificationClass: 'protected-staging-ephemeral',
      stagingQualification: false,
      productionQualification: false,
      note: 'ephemeral compose qualification is not production qualification',
    };
  }
  return {
    qualificationClass: 'unknown',
    stagingQualification: false,
    productionQualification: false,
  };
}

export async function verifyStagingReleaseEvidence({
  directory,
  artifactName,
  expectedSha,
  approvedLineage,
}) {
  if (/staging-readiness-inputs-|staging-qualification-/.test(artifactName ?? '')) {
    throw new Error('secretless qualification artifact is not staging qualification');
  }
  if (typeof artifactName !== 'string' || !artifactName.startsWith('staging-release-')) {
    throw new Error('staging evidence artifact must be a protected staging-release artifact');
  }
  if (!LINEAGE_PATTERN.test(approvedLineage ?? '')) {
    throw new Error('approved lineage is required');
  }
  if (!COMMIT_PATTERN.test(expectedSha ?? '')) {
    throw new Error('requested release SHA is invalid');
  }
  const expected = expectedSha.toLowerCase();
  let manifest;
  let checks;
  try {
    manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'));
    checks = JSON.parse(await readFile(join(directory, 'check-results.json'), 'utf8'));
  } catch {
    throw new Error('staging evidence artifact is missing or incomplete');
  }
  if (String(manifest.commit ?? '').toLowerCase() !== expected) {
    throw new Error('release manifest commit does not match the requested release SHA');
  }
  if (String(checks.provenance?.sourceSha ?? '').toLowerCase() !== expected) {
    throw new Error('staging evidence provenance SHA does not match');
  }
  if (checks.stagingSmoke !== 'PASS' || checks.runtimeIntegration !== 'PASS') {
    throw new Error('protected staging smoke or runtime evidence is not PASS');
  }
  if (checks.result !== 'PASS') {
    throw new Error('staging evidence result is not PASS');
  }
  if (checks.stagingQualification === true || checks.productionQualification === true) {
    throw new Error('secretless qualification must not be marked as staging or production qualification');
  }
  const report = {
    result: 'VERIFIED',
    source: 'downloaded-artifact',
    synthesized: false,
    artifactName,
    commit: expected,
    approvedLineage,
    stagingSmoke: 'PASS',
    runtimeIntegration: 'PASS',
  };
  assertNoSecrets(report);
  return report;
}

function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolvePromise({ stdout, stderr, exitCode }));
  });
}

async function writeJson(path, value) {
  assertNoSecrets(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o440 });
}

export async function waitForProtectedRuntime({
  commandRunner = defaultCommandRunner,
  composePrefix,
  gateService,
  expectedImages,
  expectedRelease,
  outputDirectory,
  timeoutMs = 180000,
  intervalMs = 5000,
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
  now = () => Date.now(),
}) {
  if (!Array.isArray(composePrefix) || composePrefix.length === 0) {
    throw new Error('compose command prefix is required');
  }
  const started = now();
  let services;
  let attempted = false;
  while (!attempted || now() - started <= timeoutMs) {
    attempted = true;
    const ps = await commandRunner('docker', [...composePrefix, 'ps', '-a', '--format', 'json'], { shell: false });
    if (!ps || ps.exitCode !== 0) {
      throw new Error(`compose status failed: ${safeDiagnostic(ps?.stderr || 'no diagnostics')}`);
    }
    services = parseComposePs(ps.stdout);
    try {
      evaluateRuntimeHealth(services, { gateService });
      break;
    } catch (error) {
      if (now() - started >= timeoutMs) throw error;
      await sleep(intervalMs);
    }
  }
  if (!services) throw new Error('runtime service status is missing');
  const health = evaluateRuntimeHealth(services, { gateService });
  const idResult = await commandRunner('docker', [...composePrefix, 'ps', '-aq', gateService], { shell: false });
  const containerId = String(idResult?.stdout ?? '').trim();
  if (!containerId || containerId.includes('\n') || idResult.exitCode !== 0) {
    throw new Error('migration gate container id is missing');
  }
  const evidencePath = join(outputDirectory, 'migration-gate.json');
  const copied = await commandRunner(
    'docker',
    ['cp', `${containerId}:/run/imeal/migration-gate.json`, evidencePath],
    { shell: false },
  );
  if (!copied || copied.exitCode !== 0) {
    throw new Error('migration gate evidence copy failed');
  }
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const gateReport = assertMigrationGateEvidence(evidence, expectedRelease);
  const observed = {};
  for (const service of [...HEALTH_SERVICES, gateService]) {
    const inspectId = await commandRunner('docker', [...composePrefix, 'ps', '-aq', service], { shell: false });
    const id = String(inspectId?.stdout ?? '').trim();
    if (!id || inspectId.exitCode !== 0) throw new Error(`missing container for ${service}`);
    const inspected = await commandRunner(
      'docker',
      ['inspect', '--format', '{{json .RepoDigests}}', id],
      { shell: false },
    );
    if (!inspected || inspected.exitCode !== 0) {
      throw new Error(`deployed digest inspect failed for ${service}`);
    }
    const digests = JSON.parse(inspected.stdout);
    observed[service === gateService ? 'migration-gate' : service] = digests;
  }
  const digests = assertDeployedDigests({ expected: expectedImages, observed });
  await writeJson(join(outputDirectory, 'migration-gate-wait.json'), gateReport);
  await writeJson(join(outputDirectory, 'runtime-health.json'), health);
  await writeJson(join(outputDirectory, 'deployed-digests.json'), digests);
  return { gate: gateReport, health, digests };
}

export async function scanProtectedDigests({
  images,
  trivyImage,
  outputDirectory,
  commandRunner,
}) {
  const targets = [
    ['api', images.api],
    ['worker', images.worker],
    ['admin-web', images.adminWeb],
    ['migration-gate', images.migrationGate],
  ];
  for (const [service, image] of targets) {
    assertImmutableImage(image, `${service} image`);
  }
  assertImmutableImage(trivyImage, 'Trivy image');
  for (const [service, image] of targets) {
    await runImageScan({
      image,
      trivyImage,
      cacheDirectory: join(outputDirectory, 'trivy-cache'),
      archivePath: join(outputDirectory, `deployed-image-${service}.tar`),
      reportPath: join(outputDirectory, `deployed-image-trivy-${service}.log`),
      commandRunner,
    });
  }
  return { result: 'PASS', services: targets.map(([service]) => service) };
}

export async function writeRuntimeHealthReport({
  apiOrigin,
  workerOrigin,
  expectedRelease,
  outputPath,
  fetchImpl,
}) {
  let report;
  try {
    report = {
      result: 'PASS',
      kind: 'runtime-health-http',
      evidence: await runRuntimeIntegration({
        apiOrigin,
        workerOrigin,
        expectedRelease,
        fetchImpl,
      }),
    };
  } catch {
    report = { result: 'FAIL', reason: 'production hardening runtime integration failed' };
  }
  await writeJson(outputPath, report);
  if (report.result !== 'PASS') {
    throw new Error('production hardening runtime integration failed');
  }
  return report;
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`missing option ${name}`);
  }
  return argv[index + 1];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === 'verify-images') {
    const images = await readJson(optionValue(rest, '--images-json'));
    const envText = await readFile(optionValue(rest, '--env-file'), 'utf8');
    const digestFlag = rest.includes('--migration-gate-digest')
      ? optionValue(rest, '--migration-gate-digest')
      : rest.includes('--migration-gate-digest-file')
        ? (await readFile(optionValue(rest, '--migration-gate-digest-file'), 'utf8')).trim()
        : undefined;
    const report = verifyProtectedImages({
      images,
      envText,
      migrationGateDigest: digestFlag,
    });
    await writeJson(optionValue(rest, '--output'), report);
    return report;
  }
  if (command === 'assert-artifacts') {
    return assertArtifactTree(optionValue(rest, '--directory'));
  }
  if (command === 'assert-recorded') {
    const directory = optionValue(rest, '--directory');
    for (const name of ['migration-gate-wait.json', 'runtime-health.json', 'deployed-digests.json']) {
      const report = await readJson(join(directory, name));
      if (report.result !== 'PASS') throw new Error(`${name} did not PASS`);
    }
    return { result: 'PASS' };
  }
  if (command === 'rollback-reference') {
    const images = await readJson(optionValue(rest, '--images-json'));
    const migrationGate = (await readFile(optionValue(rest, '--migration-gate-image-file'), 'utf8')).trim();
    const rollbackArtifact = (await readFile(optionValue(rest, '--rollback-artifact-file'), 'utf8')).trim();
    const reference = buildRollbackReference({
      releaseId: optionValue(rest, '--release-id'),
      commit: optionValue(rest, '--commit'),
      images,
      migrationGate,
      rollbackArtifact,
    });
    await writeJson(optionValue(rest, '--output'), reference);
    return reference;
  }
  if (command === 'verify-staging-evidence') {
    const report = await verifyStagingReleaseEvidence({
      directory: optionValue(rest, '--directory'),
      artifactName: optionValue(rest, '--artifact-name'),
      expectedSha: optionValue(rest, '--expected-sha'),
      approvedLineage: optionValue(rest, '--approved-lineage'),
    });
    await writeJson(optionValue(rest, '--output'), report);
    return report;
  }
  if (command === 'print-migration-gate') {
    const contract = await readJson(optionValue(rest, '--contract'));
    process.stdout.write(assertImmutableImage(contract.migrationGate, 'migration-gate image'));
    return contract;
  }
  if (command === 'scan-digests') {
    const contract = await readJson(optionValue(rest, '--contract'));
    return scanProtectedDigests({
      images: contract,
      trivyImage: optionValue(rest, '--trivy-image'),
      outputDirectory: optionValue(rest, '--output-directory'),
    });
  }
  if (command === 'runtime-health') {
    return writeRuntimeHealthReport({
      apiOrigin: optionValue(rest, '--api-origin'),
      workerOrigin: optionValue(rest, '--worker-origin'),
      expectedRelease: optionValue(rest, '--expected-release'),
      outputPath: optionValue(rest, '--output'),
    });
  }
  if (command === 'wait-runtime') {
    const contract = await readJson(optionValue(rest, '--contract'));
    const envFile = optionValue(rest, '--env-file');
    const composeFiles = [];
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--compose-file') composeFiles.push(rest[index + 1]);
    }
    if (composeFiles.length === 0) throw new Error('compose file is required');
    const release = rest.includes('--expected-release-file')
      ? (await readFile(optionValue(rest, '--expected-release-file'), 'utf8')).trim()
      : undefined;
    return waitForProtectedRuntime({
      composePrefix: [
        'compose',
        '--env-file',
        envFile,
        ...composeFiles.flatMap((file) => ['-f', file]),
      ],
      gateService: optionValue(rest, '--gate-service'),
      expectedImages: contract,
      expectedRelease: release,
      outputDirectory: optionValue(rest, '--output-directory'),
    });
  }
  throw new Error(`unknown protected qualification command: ${command ?? '(missing)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'protected qualification failed'}\n`);
    process.exitCode = 1;
  });
}
