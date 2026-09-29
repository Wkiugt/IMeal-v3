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
  'smoke-infrastructure.json',
  'smoke-auth-rbac.json',
  'smoke-business.json',
  'smoke-mobile-admin.json',
  'smoke-worker.json',
  'observability-alert-test.json',
];

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

function assertCompletionArtifacts(artifacts, releaseId, target) {
  for (const name of REQUIRED_PASS_ARTIFACTS) {
    const artifact = artifacts[name].parsed;
    if (!artifact || artifact.result !== 'PASS') {
      throw new Error(`${name} must have result PASS`);
    }
    assertBoundArtifact(artifact, name, releaseId, target);
  }
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
