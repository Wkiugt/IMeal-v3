import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertNoSecrets,
  parseArgs,
  requireSafeSchemaName,
} from './staging-lib.mjs';

export const REQUIRED_EVIDENCE = [
  'release-manifest.json',
  'target-fingerprint.json',
  'migration-status.txt',
  'preflight-before.json',
  'backup-manifest.json',
  'approval.json',
  'backfill-result.json',
  'preflight-after.json',
  'constraint-validation.json',
  'restore-rehearsal.json',
  'smoke-infrastructure.json',
  'smoke-auth-rbac.json',
  'smoke-business.json',
  'smoke-mobile-admin.json',
  'smoke-worker.json',
  'observability-alert-test.json',
  'runtime-integration.json',
  'staging-smoke.json',
  'checksums.txt',
  'signoff.json',
];

const CHECKSUMMED_EVIDENCE = REQUIRED_EVIDENCE.filter(
  (name) => name !== 'checksums.txt',
);
const DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/i;
const IMMUTABLE_IMAGE_PATTERN = /@sha256:[a-f0-9]{64}$/i;
const SENSITIVE_TEXT_PATTERN =
  /(?:postgres(?:ql)?:\/\/[^\s<]+@|\bBearer\s+(?!<redacted>)[^\s]+|\b(?:password|token|secret|api[_-]?key|otp)\b\s*[:=]\s*(?!<redacted>|PASS\b)[^\s,}\]]+)/i;
const REQUIRED_PASS_ARTIFACTS = [
  'preflight-before.json',
  'backup-manifest.json',
  'backfill-result.json',
  'preflight-after.json',
  'constraint-validation.json',
  'restore-rehearsal.json',
  'smoke-infrastructure.json',
  'smoke-auth-rbac.json',
  'smoke-business.json',
  'smoke-mobile-admin.json',
  'smoke-worker.json',
  'observability-alert-test.json',
  'runtime-integration.json',
  'staging-smoke.json',
];
const SAFE_SOURCE_IDENTITIES = new Set([
  'api',
  'worker',
  'prometheus',
  'grafana',
  'alertmanager',
  'edge-waf',
  'external-alerting',
  'observability-platform',
  'staging-runtime',
  'staging-smoke',
]);
const APPROVED_METRICS_SNAPSHOT_ARTIFACTS = new Set([
  'runtime-integration.json',
]);
const SAFE_FRESHNESS_STATES = new Set([
  'fresh',
  'stale',
  'unknown',
  'collector_failure',
]);
const SAFE_REFERENCE_PATTERN = /^\/?[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PREFLIGHT_CHECK_NAMES = [
  'registration_snapshot_incomplete',
  'registration_serving_mismatch',
  'roster_assignment_ambiguous',
  'menu_revision_incomplete',
  'penalty_registration_mapping_ambiguous',
  'penalty_registration_duplicate_candidate',
  'future_active_snapshot_incomplete',
];
const PREFLIGHT_STATUS_NAMES = ['ACTIVE', 'CANCELLED', 'SERVED', 'NO_SHOW'];
const CONSTRAINT_NAMES = [
  'registration_lifecycle_snapshot_complete',
  'registration_serving_consistency',
];
const STAGING_SMOKE_CHECK_RESULTS = Object.freeze({
  'https-redirect': new Set(['PASS', 'SKIP']),
  'api-live': new Set(['PASS']),
  'api-ready': new Set(['PASS']),
  'admin-health': new Set(['PASS']),
  'safe-error-envelope': new Set(['PASS']),
  'auth-me': new Set(['PASS']),
});

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
}

function assertTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('evidence target is required');
  }
  const database = assertNonEmptyString(
    target.database,
    'evidence target database',
  );
  if (!DATABASE_PATTERN.test(database)) {
    throw new Error('evidence target database is invalid');
  }
  const schema = requireSafeSchemaName(target.schema);
  return { database, schema };
}

function assertSafeArtifactText(name, text) {
  if (SENSITIVE_TEXT_PATTERN.test(text)) {
    throw new Error(`artifact must be redacted: ${name}`);
  }
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readArtifact(artifactDirectory, name) {
  const filePath = join(artifactDirectory, name);
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`missing required evidence artifact: ${name}`);
    }
    throw error;
  }
  if (!metadata.isFile()) {
    throw new Error(`evidence artifact must be a regular file: ${name}`);
  }
  const bytes = await readFile(filePath);
  const text = bytes.toString('utf8');
  assertSafeArtifactText(name, text);
  let parsed;
  if (name.endsWith('.json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`evidence artifact is not valid JSON: ${name}`);
    }
    try {
      assertNoSecrets(parsed);
    } catch {
      throw new Error(`artifact must be redacted: ${name}`);
    }
  }
  return {
    name,
    path: filePath,
    bytes: bytes.length,
    sha256: hashBytes(bytes),
    parsed,
    text,
  };
}

function assertImmutableImages(images) {
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new Error('release manifest images are required');
  }
  const required = [
    ['api', 'api'],
    ['worker', 'worker'],
    ['adminWeb', 'admin web'],
  ];
  for (const [key, label] of required) {
    const image = images[key] ?? images[key === 'adminWeb' ? 'admin-web' : key];
    if (typeof image !== 'string' || image.trim() === '') {
      throw new Error(`${label} image reference is required`);
    }
    if (!IMMUTABLE_IMAGE_PATTERN.test(image)) {
      throw new Error(`${label} image must use an immutable image digest`);
    }
  }
  return {
    api: images.api,
    worker: images.worker,
    adminWeb: images.adminWeb ?? images['admin-web'],
  };
}
async function readRollbackArtifact(artifactDirectory, reference) {
  const normalized = assertNonEmptyString(
    reference,
    'rollback artifact reference',
  ).replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    isAbsolute(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..') ||
    REQUIRED_EVIDENCE.includes(normalized)
  ) {
    throw new Error('rollback artifact must be a local bundle file');
  }
  const filePath = resolve(artifactDirectory, normalized);
  const relativePath = relative(artifactDirectory, filePath);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    throw new Error('rollback artifact must stay under artifact directory');
  }
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('rollback artifact is missing');
    }
    throw error;
  }
  if (!metadata.isFile()) {
    throw new Error('rollback artifact must be a regular file');
  }
  const bytes = await readFile(filePath);
  return { path: normalized, bytes: bytes.length, sha256: hashBytes(bytes) };
}

async function assertReleaseReferences(
  releaseManifest,
  releaseId,
  artifactDirectory,
) {
  if (!releaseManifest || typeof releaseManifest !== 'object') {
    throw new Error('release manifest is required');
  }
  if (releaseManifest.releaseId !== releaseId) {
    throw new Error('release manifest release mismatch');
  }
  const commitSha =
    releaseManifest.commitSha ??
    releaseManifest.commit ??
    releaseManifest.gitCommit;
  if (typeof commitSha !== 'string' || !COMMIT_PATTERN.test(commitSha)) {
    throw new Error('release manifest commit reference is required');
  }
  const images = assertImmutableImages(releaseManifest.images);
  const migrations =
    releaseManifest.migrations ?? releaseManifest.migrationRefs;
  if (
    !Array.isArray(migrations) ||
    migrations.length === 0 ||
    migrations.some(
      (migration) => typeof migration !== 'string' || migration.trim() === '',
    )
  ) {
    throw new Error('release manifest migration references are required');
  }
  const rollbackReference =
    typeof releaseManifest.rollbackArtifact === 'string'
      ? releaseManifest.rollbackArtifact
      : (releaseManifest.rollback?.artifact ??
        releaseManifest.rollback?.artifactRef);
  const rollbackArtifact = artifactDirectory
    ? await readRollbackArtifact(artifactDirectory, rollbackReference)
    : typeof rollbackReference === 'object' && rollbackReference !== null
      ? {
          path: assertNonEmptyString(
            rollbackReference.path,
            'rollback artifact reference',
          ),
          bytes: rollbackReference.bytes,
          sha256: rollbackReference.sha256,
        }
      : {
          path: assertNonEmptyString(
            rollbackReference,
            'rollback artifact reference',
          ),
        };
  if (
    !Number.isInteger(rollbackArtifact.bytes) ||
    rollbackArtifact.bytes < 0 ||
    typeof rollbackArtifact.sha256 !== 'string' ||
    !SHA256_PATTERN.test(rollbackArtifact.sha256)
  ) {
    if (!artifactDirectory) {
      throw new Error('rollback artifact checksum metadata is invalid');
    }
  }
  return { commitSha, images, migrations, rollbackArtifact };
}

function parseChecksums(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/i);
    if (!match || entries.has(match[2])) {
      throw new Error('checksums.txt is malformed');
    }
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

function assertChecksumsMatch(checksumArtifact, artifacts, rollbackArtifact) {
  const entries = parseChecksums(checksumArtifact.text);
  if (entries.size !== CHECKSUMMED_EVIDENCE.length + 1) {
    throw new Error('checksums.txt does not cover every required artifact');
  }
  for (const name of CHECKSUMMED_EVIDENCE) {
    if (entries.get(name) !== artifacts[name].sha256) {
      throw new Error(`checksums.txt mismatch: ${name}`);
    }
  }
  if (entries.get(rollbackArtifact.path) !== rollbackArtifact.sha256) {
    throw new Error('checksums.txt mismatch: rollback artifact');
  }
}
function assertArtifactTargets(artifacts, target, releaseId) {
  for (const artifact of Object.values(artifacts)) {
    if (!artifact.name.endsWith('.json')) continue;
    const parsed = artifact.parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`evidence JSON binding is required: ${artifact.name}`);
    }
    if (parsed.releaseId !== releaseId) {
      if (
        typeof parsed.releaseId !== 'string' ||
        parsed.releaseId.trim() === ''
      ) {
        throw new Error(
          `evidence release binding is required: ${artifact.name}`,
        );
      }
      throw new Error(`evidence release mismatch: ${artifact.name}`);
    }
    const artifactTarget = parsed.target;
    if (
      !artifactTarget ||
      typeof artifactTarget !== 'object' ||
      Array.isArray(artifactTarget) ||
      typeof artifactTarget.database !== 'string' ||
      typeof artifactTarget.schema !== 'string'
    ) {
      throw new Error(`evidence target binding is required: ${artifact.name}`);
    }
    if (
      artifactTarget.database !== target.database ||
      artifactTarget.schema !== target.schema
    ) {
      throw new Error(`evidence target mismatch: ${artifact.name}`);
    }
  }
}

function assertBoundArtifact(artifact, name, releaseId, target) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error(`${name} artifact is required`);
  }
  if (artifact.releaseId !== releaseId) {
    throw new Error(`${name} release mismatch`);
  }
  if (
    !artifact.target ||
    artifact.target.database !== target.database ||
    artifact.target.schema !== target.schema
  ) {
    throw new Error(`${name} target mismatch`);
  }
}

function assertTimestamp(value, label) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertTargetFingerprintShape(fingerprint, target) {
  if (
    !fingerprint ||
    typeof fingerprint !== 'object' ||
    Array.isArray(fingerprint) ||
    fingerprint.database !== target.database ||
    fingerprint.schema !== target.schema ||
    typeof fingerprint.serverVersion !== 'string' ||
    fingerprint.serverVersion.trim() === '' ||
    !Array.isArray(fingerprint.migrationRows)
  ) {
    throw new Error('target fingerprint structure is invalid');
  }
}

function assertPreflightSchema(artifact, name) {
  assertDigest(artifact.preflightSha256, `${name} preflightSha256`);
  if (
    !Array.isArray(artifact.checks) ||
    artifact.checks.length !== PREFLIGHT_CHECK_NAMES.length ||
    !Array.isArray(artifact.statusCounts) ||
    artifact.statusCounts.length !== PREFLIGHT_STATUS_NAMES.length
  ) {
    throw new Error(`${name} checks are incomplete`);
  }
  const checkNames = new Set();
  for (const check of artifact.checks) {
    if (
      !check ||
      !PREFLIGHT_CHECK_NAMES.includes(check.name) ||
      checkNames.has(check.name) ||
      !Number.isSafeInteger(check.affectedCount) ||
      check.affectedCount !== 0 ||
      !Array.isArray(check.sampleIds)
    ) {
      throw new Error(`${name} checks are invalid`);
    }
    checkNames.add(check.name);
  }
  const statuses = new Set();
  for (const row of artifact.statusCounts) {
    if (
      !row ||
      !PREFLIGHT_STATUS_NAMES.includes(row.status) ||
      statuses.has(row.status) ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    ) {
      throw new Error(`${name} status counts are invalid`);
    }
    statuses.add(row.status);
  }
}

function assertBackupSchema(artifact) {
  if (artifact.kind !== 'staging-backup') {
    throw new Error('backup-manifest.json kind is invalid');
  }
  assertTargetFingerprintShape(artifact.targetFingerprint, artifact.target);
  assertTimestamp(artifact.timestamps?.startedAt, 'backup start timestamp');
  assertTimestamp(artifact.timestamps?.completedAt, 'backup completion timestamp');
  const encrypted = artifact.artifact;
  if (
    !encrypted ||
    encrypted.format !== 'age-wrapped-postgresql-custom' ||
    !Number.isSafeInteger(encrypted.bytes) ||
    encrypted.bytes < 0
  ) {
    throw new Error('backup-manifest.json artifact is invalid');
  }
  assertDigest(encrypted.sha256, 'backup artifact digest');
  if (
    !artifact.encryption ||
    artifact.encryption.algorithm !== 'age' ||
    artifact.storage?.provider !== 's3-compatible-private'
  ) {
    throw new Error('backup-manifest.json storage evidence is invalid');
  }
}

function assertBackfillSchema(artifact) {
  for (const [field, label] of [
    ['preflightSha256', 'backfill preflight digest'],
    ['backupManifestSha256', 'backfill backup digest'],
    ['backfillSha256', 'backfill script digest'],
  ]) {
    assertDigest(artifact[field], label);
  }
  if (
    typeof artifact.approvalId !== 'string' ||
    artifact.approvalId.trim() === '' ||
    !artifact.transaction
  ) {
    throw new Error('backfill-result.json transaction evidence is invalid');
  }
  assertTimestamp(artifact.transaction.startedAt, 'backfill start timestamp');
  assertTimestamp(
    artifact.transaction.completedAt,
    'backfill completion timestamp',
  );
}

function assertConstraintSchema(artifact) {
  assertTargetFingerprintShape(artifact.targetFingerprint, artifact.target);
  assertDigest(artifact.preflightAfterSha256, 'post-preflight digest');
  assertDigest(artifact.migrationSha256, 'migration digest');
  if (
    !Array.isArray(artifact.constraints) ||
    artifact.constraints.length !== CONSTRAINT_NAMES.length ||
    artifact.constraints.some(
      (constraint) =>
        !constraint ||
        !CONSTRAINT_NAMES.includes(constraint.name) ||
        constraint.validated !== true,
    )
  ) {
    throw new Error('constraint-validation.json constraints are invalid');
  }
}

function assertRestoreSchema(artifact) {
  if (artifact.kind !== 'restore-rehearsal') {
    throw new Error('restore-rehearsal.json kind is invalid');
  }
  assertTargetFingerprintShape(artifact.targetFingerprint, artifact.target);
  assertTimestamp(artifact.timestamps?.startedAt, 'restore start timestamp');
  assertTimestamp(artifact.timestamps?.completedAt, 'restore completion timestamp');
  if (
    artifact.checksums?.artifact !== 'PASS' ||
    artifact.database?.restored !== 'PASS' ||
    artifact.objects?.restored !== 'PASS' ||
    artifact.migration?.result !== 'PASS' ||
    artifact.readiness?.result !== 'PASS' ||
    artifact.smoke?.result !== 'PASS'
  ) {
    throw new Error('restore-rehearsal.json contains a failed phase');
  }
  assertDigest(artifact.checksums.sha256, 'restore artifact digest');
}

function assertObservationMetadata(artifact, name) {
  if (
    typeof artifact.source !== 'string' ||
    !SAFE_REFERENCE_PATTERN.test(artifact.source) ||
    !SAFE_FRESHNESS_STATES.has(artifact.freshness) ||
    artifact.freshness !== 'fresh'
  ) {
    throw new Error(`${name} source or freshness is invalid`);
  }
  assertTimestamp(artifact.observedAt, `${name} observedAt`);
}
function assertEvidenceOrigin(value, label) {
  let origin;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('unsafe origin');
    }
    origin = parsed.origin;
  } catch {
    throw new Error(`${label} origin is invalid`);
  }
  return origin;
}

function assertSmokeCheck(check, name) {
  if (
    !check ||
    typeof check.name !== 'string' ||
    check.name.trim() === '' ||
    typeof check.result !== 'string'
  ) {
    throw new Error(`${name} checks are invalid`);
  }
}
function assertStagingSmokeChecks(checks) {
  const seen = new Set();
  for (const check of checks) {
    assertSmokeCheck(check, 'staging-smoke.json');
    if (
      !Object.hasOwn(STAGING_SMOKE_CHECK_RESULTS, check.name) ||
      seen.has(check.name) ||
      !STAGING_SMOKE_CHECK_RESULTS[check.name].has(check.result)
    ) {
      throw new Error('staging-smoke.json checks are invalid');
    }
    if (
      check.name === 'https-redirect' &&
      check.result === 'SKIP' &&
      check.reason !== 'explicit local test mode'
    ) {
      throw new Error('staging-smoke.json redirect skip is invalid');
    }
    seen.add(check.name);
  }
  const requiredNames = Object.keys(STAGING_SMOKE_CHECK_RESULTS).filter(
    (name) => name !== 'auth-me',
  );
  if (
    requiredNames.some((name) => !seen.has(name)) ||
    (seen.has('auth-me') &&
      !STAGING_SMOKE_CHECK_RESULTS['auth-me'].has(
        checks.find((check) => check.name === 'auth-me').result,
      ))
  ) {
    throw new Error('staging-smoke.json checks are incomplete');
  }
}



function assertRuntimeSchema(artifact) {
  const evidence = artifact.evidence;
  if (
    !evidence ||
    evidence.api?.live !== 200 ||
    evidence.api?.ready !== 200 ||
    evidence.worker?.live !== 200 ||
    evidence.worker?.ready !== 200 ||
    evidence.metricsInternalOnly !== true ||
    evidence.metricsSnapshotSource !== 'worker-internal' ||
    typeof evidence.metricsSnapshotDigest !== 'string' ||
    !SHA256_PATTERN.test(evidence.metricsSnapshotDigest)
  ) {
    throw new Error('runtime-integration.json runtime evidence is not PASS');
  }
  if (Object.hasOwn(artifact, 'source') || Object.hasOwn(artifact, 'freshness')) {
    assertObservationMetadata(artifact, 'runtime-integration');
  }
}

function assertSmokeSchema(artifact, name) {
  if (name === 'staging-smoke.json') {
    if (
      typeof artifact.apiOrigin !== 'string' ||
      typeof artifact.adminOrigin !== 'string' ||
      !Array.isArray(artifact.checks) ||
      artifact.checks.length === 0 ||
      artifact.businessWorkflow?.result !== 'NOT_RUN'
    ) {
      throw new Error('staging-smoke.json runtime evidence is not PASS');
    }
    assertEvidenceOrigin(artifact.apiOrigin, 'staging smoke API');
    assertEvidenceOrigin(artifact.adminOrigin, 'staging smoke admin');
    assertStagingSmokeChecks(artifact.checks);
  } else {
    assertNonEmptyString(artifact.command, `${name} command`);
    assertNonEmptyString(artifact.operator, `${name} operator`);
    assertObservationMetadata(artifact, name);
  }
}


function assertObservabilityAlertEvidence(
  artifact,
  artifacts,
  releaseId,
  target,
) {
  assertBoundArtifact(artifact, 'observability-alert-test', releaseId, target);
  if (artifact.result !== 'PASS') {
    throw new Error('observability-alert-test.json must contain an explicit PASS');
  }
  const source = artifact.source;
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    Object.keys(source).sort().join(',') !==
      'freshness,identity,snapshotArtifact,snapshotArtifactSha256,snapshotDigest'
  ) {
    throw new Error('observability source evidence is required');
  }
  if (!SAFE_SOURCE_IDENTITIES.has(source.identity)) {
    throw new Error('observability source identity is not approved');
  }
  if (
    !SAFE_FRESHNESS_STATES.has(source.freshness) ||
    source.freshness !== 'fresh'
  ) {
    throw new Error('observability source freshness is not fresh');
  }
  if (
    typeof source.snapshotArtifact !== 'string' ||
    !APPROVED_METRICS_SNAPSHOT_ARTIFACTS.has(source.snapshotArtifact) ||
    !artifacts[source.snapshotArtifact] ||
    artifacts[source.snapshotArtifact].parsed?.result !== 'PASS' ||
    typeof source.snapshotArtifactSha256 !== 'string' ||
    !SHA256_PATTERN.test(source.snapshotArtifactSha256) ||
    artifacts[source.snapshotArtifact].sha256 !== source.snapshotArtifactSha256
  ) {
    throw new Error('observability snapshot artifact provenance is invalid');
  }
  const runtimeEvidence = artifacts['runtime-integration.json'].parsed?.evidence;
  if (
    typeof source.snapshotDigest !== 'string' ||
    !SHA256_PATTERN.test(source.snapshotDigest) ||
    source.snapshotDigest !== runtimeEvidence?.metricsSnapshotDigest
  ) {
    throw new Error('observability snapshot digest does not match runtime metrics');
  }
  const acknowledgement = artifact.acknowledgement;
  if (
    !acknowledgement ||
    typeof acknowledgement !== 'object' ||
    Array.isArray(acknowledgement) ||
    Object.keys(acknowledgement).sort().join(',') !==
      'acknowledged,destination,observedAt,route'
  ) {
    throw new Error('observability alert acknowledgement is required');
  }
  if (acknowledgement.acknowledged !== true) {
    throw new Error('observability alert acknowledgement is not confirmed');
  }
  for (const [value, label] of [
    [acknowledgement.route, 'observability alert route'],
    [acknowledgement.destination, 'observability alert destination'],
  ]) {
    if (typeof value !== 'string' || !SAFE_REFERENCE_PATTERN.test(value)) {
      throw new Error(`${label} is unsafe`);
    }
  }
  if (
    typeof acknowledgement.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(acknowledgement.observedAt)) ||
    new Date(acknowledgement.observedAt).toISOString() !==
      acknowledgement.observedAt
  ) {
    throw new Error('observability alert observedAt is invalid');
  }
}

function assertMigrationStatus(text) {
  if (!/^migrations=clean$/m.test(text)) {
    throw new Error('migration-status.txt must report migrations=clean');
  }
  if (/\bmigrations=(?:pending|failed|unknown|dirty)\b/i.test(text)) {
    throw new Error('migration-status.txt reports an unsafe migration state');
  }
}

function assertTargetFingerprint(artifact, releaseId, target) {
  assertBoundArtifact(artifact, 'target-fingerprint', releaseId, target);
  const fingerprint = artifact.targetFingerprint;
  const fingerprintDigest =
    artifact.targetFingerprintDigest ??
    artifact.digest ??
    fingerprint?.sha256 ??
    fingerprint?.digest;
  if (
    !fingerprint ||
    typeof fingerprint !== 'object' ||
    Array.isArray(fingerprint) ||
    fingerprint.database !== target.database ||
    fingerprint.schema !== target.schema ||
    typeof fingerprint.serverVersion !== 'string' ||
    fingerprint.serverVersion.trim() === '' ||
    !Array.isArray(fingerprint.migrationRows) ||
    (fingerprintDigest !== undefined &&
      (typeof fingerprintDigest !== 'string' ||
        !SHA256_PATTERN.test(fingerprintDigest)))
  ) {
    throw new Error('target fingerprint structure or digest is invalid');
  }
}

function assertCompletionArtifacts(artifacts, releaseId, target) {
  assertTargetFingerprint(artifacts['target-fingerprint.json'].parsed, releaseId, target);
  assertMigrationStatus(artifacts['migration-status.txt'].text);
  for (const name of REQUIRED_PASS_ARTIFACTS) {
    const artifact = artifacts[name].parsed;
    if (!artifact || artifact.result !== 'PASS') {
      throw new Error(`${name} must have result PASS`);
    }
    assertBoundArtifact(artifact, name, releaseId, target);
    if (name === 'preflight-before.json' || name === 'preflight-after.json') {
      assertTargetFingerprintShape(artifact.targetFingerprint, target);
      assertPreflightSchema(artifact, name);
    } else if (name === 'backup-manifest.json') {
      assertBackupSchema(artifact);
    } else if (name === 'backfill-result.json') {
      assertBackfillSchema(artifact);
    } else if (name === 'constraint-validation.json') {
      assertConstraintSchema(artifact);
    } else if (name === 'restore-rehearsal.json') {
      assertRestoreSchema(artifact);
    } else if (name === 'runtime-integration.json') {
      assertRuntimeSchema(artifact);
    } else if (name === 'staging-smoke.json') {
      assertSmokeSchema(artifact, name);
    } else if (name.startsWith('smoke-')) {
      assertSmokeSchema(artifact, name);
    }
  }
  assertObservabilityAlertEvidence(
    artifacts['observability-alert-test.json'].parsed,
    artifacts,
    releaseId,
    target,
  );
  const business = artifacts['smoke-business.json'].parsed;
  assertNonEmptyString(business.command, 'smoke-business command');
  assertNonEmptyString(business.operator, 'smoke-business operator');

  const approval = artifacts['approval.json'].parsed;
  assertBoundArtifact(approval, 'approval', releaseId, target);
  assertNonEmptyString(approval.approvalId, 'approval ID');
  assertNonEmptyString(approval.approver, 'approval approver');
  assertNonEmptyString(approval.rollbackAuthority, 'rollback authority');
  assertNonEmptyString(
    approval.rollbackDecisionWindow,
    'rollback decision window',
  );
  if (approval.decision !== 'APPROVED_FOR_EXACT_BACKFILL') {
    throw new Error('approval decision is not exact backfill approval');
  }

  const signoff = artifacts['signoff.json'].parsed;
  assertBoundArtifact(signoff, 'signoff', releaseId, target);
  if (signoff.result !== 'PASS') {
    throw new Error('signoff.json must contain an explicit PASS');
  }
  const operator = assertNonEmptyString(signoff.operator, 'signoff operator');
  const reviewer = assertNonEmptyString(signoff.reviewer, 'signoff reviewer');
  if (operator === reviewer) {
    throw new Error('signoff operator and reviewer must be distinct');
  }
  if (signoff.decision !== 'REVIEWED') {
    throw new Error('signoff decision must be REVIEWED');
  }
  if (
    Object.hasOwn(signoff, 'approvalId') ||
    Object.hasOwn(signoff, 'approver') ||
    Object.hasOwn(signoff, 'rollbackAuthority') ||
    Object.hasOwn(signoff, 'rollbackDecisionWindow')
  ) {
    throw new Error('signoff contains unrelated approval fields');
  }
  assertNonEmptyString(signoff.decision, 'signoff decision');
  if (
    typeof signoff.signedAt !== 'string' ||
    !Number.isFinite(Date.parse(signoff.signedAt))
  ) {
    throw new Error('signoff signedAt is required');
  }
}

export async function createEvidenceManifest({
  releaseId,
  target,
  artifactDirectory,
}) {
  assertNonEmptyString(releaseId, 'release ID');
  const safeTarget = assertTarget(target);
  const directory = resolve(
    assertNonEmptyString(artifactDirectory, 'artifact directory'),
  );
  const artifacts = {};
  for (const name of REQUIRED_EVIDENCE) {
    artifacts[name] = await readArtifact(directory, name);
  }
  assertArtifactTargets(artifacts, safeTarget, releaseId);
  const releaseReferences = await assertReleaseReferences(
    artifacts['release-manifest.json'].parsed,
    releaseId,
    directory,
  );
  assertCompletionArtifacts(artifacts, releaseId, safeTarget);
  assertChecksumsMatch(
    artifacts['checksums.txt'],
    artifacts,
    releaseReferences.rollbackArtifact,
  );
  const manifest = {
    result: 'PASS',
    releaseId,
    target: safeTarget,
    references: releaseReferences,
    artifacts: Object.fromEntries(
      REQUIRED_EVIDENCE.map((name) => [
        name,
        { bytes: artifacts[name].bytes, sha256: artifacts[name].sha256 },
      ]),
    ),
  };
  assertEvidenceComplete(manifest);
  return manifest;
}

export function assertEvidenceComplete(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.result !== 'PASS') {
    throw new Error('evidence manifest is not PASS');
  }
  assertNonEmptyString(manifest.releaseId, 'evidence release ID');
  assertTarget(manifest.target);
  const artifacts = manifest.artifacts;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('evidence artifact hashes are required');
  }
  for (const name of REQUIRED_EVIDENCE) {
    const artifact = artifacts[name];
    if (!artifact || !Number.isInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new Error(`evidence artifact metadata is missing: ${name}`);
    }
    if (
      typeof artifact.sha256 !== 'string' ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new Error(`evidence artifact checksum is invalid: ${name}`);
    }
  }
  const references = manifest.references;
  if (!references || typeof references !== 'object') {
    throw new Error('evidence release references are required');
  }
  if (
    typeof references.commitSha !== 'string' ||
    !COMMIT_PATTERN.test(references.commitSha)
  ) {
    throw new Error('evidence commit reference is required');
  }
  assertImmutableImages(references.images);
  if (
    !Array.isArray(references.migrations) ||
    references.migrations.length === 0 ||
    references.migrations.some(
      (migration) => typeof migration !== 'string' || migration.trim() === '',
    )
  ) {
    throw new Error('evidence migration references are required');
  }
  const rollback = references.rollbackArtifact;
  if (
    !rollback ||
    typeof rollback !== 'object' ||
    typeof rollback.path !== 'string' ||
    !Number.isInteger(rollback.bytes) ||
    rollback.bytes < 0 ||
    typeof rollback.sha256 !== 'string' ||
    !SHA256_PATTERN.test(rollback.sha256)
  ) {
    throw new Error('evidence rollback artifact metadata is invalid');
  }
  return manifest;
}
export async function writeChecksums({
  artifactDirectory,
  releaseId: expectedReleaseId,
  target: expectedTarget,
}) {
  const directory = resolve(
    assertNonEmptyString(artifactDirectory, 'artifact directory'),
  );
  await mkdir(directory, { recursive: true });
  const artifacts = {};
  for (const name of CHECKSUMMED_EVIDENCE) {
    artifacts[name] = await readArtifact(directory, name);
  }
  const releaseManifest = artifacts['release-manifest.json'].parsed;
  const safeReleaseId = assertNonEmptyString(
    expectedReleaseId ?? releaseManifest?.releaseId,
    'release ID',
  );
  const fingerprint = artifacts['target-fingerprint.json'].parsed;
  const safeTarget = assertTarget(
    expectedTarget ?? fingerprint?.target ?? fingerprint,
  );
  assertArtifactTargets(artifacts, safeTarget, safeReleaseId);
  const releaseReferences = await assertReleaseReferences(
    releaseManifest,
    safeReleaseId,
    directory,
  );
  assertCompletionArtifacts(artifacts, safeReleaseId, safeTarget);
  const checksumLines = [
    ...CHECKSUMMED_EVIDENCE.map((name) => `${artifacts[name].sha256}  ${name}`),
    `${releaseReferences.rollbackArtifact.sha256}  ${releaseReferences.rollbackArtifact.path}`,
  ];
  const checksums = `${checksumLines.join('\n')}\n`;
  const outputPath = join(directory, 'checksums.txt');
  try {
    await writeFile(outputPath, checksums, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o440,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('checksums.txt already exists');
    }
    throw error;
  }
  return { path: outputPath, sha256: hashBytes(Buffer.from(checksums)) };
}

async function writeManifest(outputPath, manifest) {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    await writeFile(outputPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o440,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`evidence manifest already exists: ${outputPath}`);
    }
    throw error;
  }
}

export function resolveEvidenceTarget({
  targetId,
  targetFingerprint,
  targetDatabaseOverride,
}) {
  const fingerprintTarget =
    targetFingerprint?.target ?? targetFingerprint ?? {};
  if (
    targetDatabaseOverride !== undefined &&
    targetDatabaseOverride !== fingerprintTarget.database
  ) {
    throw new Error('TARGET_DATABASE_NAME does not match target fingerprint');
  }
  const database = fingerprintTarget.database;
  const schema = fingerprintTarget.schema;
  if (
    typeof database !== 'string' ||
    database.trim() === '' ||
    typeof schema !== 'string' ||
    schema !== targetId
  ) {
    throw new Error('target fingerprint does not match --target');
  }
  return { database, schema };
}

async function main(argv) {
  const args = parseArgs(argv, {
    'release-id': { type: 'string', required: true },
    target: { type: 'string', required: true },
    artifacts: { type: 'string', required: true },
    output: { type: 'string' },
    'write-checksums': { type: 'boolean' },
  });
  const artifactDirectory = resolve(args.artifacts);
  let targetFingerprint;
  try {
    targetFingerprint = JSON.parse(
      await readFile(
        join(artifactDirectory, 'target-fingerprint.json'),
        'utf8',
      ),
    );
  } catch {
    throw new Error('target-fingerprint.json is required before evidence CLI');
  }
  const target = resolveEvidenceTarget({
    targetId: args.target,
    targetFingerprint,
    targetDatabaseOverride: process.env.TARGET_DATABASE_NAME,
  });
  if (args['write-checksums']) {
    await writeChecksums({
      artifactDirectory,
      releaseId: args['release-id'],
      target,
    });
  }
  const manifest = await createEvidenceManifest({
    releaseId: args['release-id'],
    target,
    artifactDirectory,
  });
  const outputPath = resolve(
    args.output ?? join(artifactDirectory, 'evidence-manifest.json'),
  );
  await writeManifest(outputPath, manifest);
  process.stdout.write(`${JSON.stringify({ result: 'PASS', outputPath })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message || 'evidence failed'}\n`);
    process.exitCode = 1;
  });
}
