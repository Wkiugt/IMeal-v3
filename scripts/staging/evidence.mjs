import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
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

function assertReleaseReferences(releaseManifest, releaseId) {
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
  const rollbackArtifact =
    typeof releaseManifest.rollbackArtifact === 'string'
      ? releaseManifest.rollbackArtifact
      : (releaseManifest.rollback?.artifact ??
        releaseManifest.rollback?.artifactRef);
  assertNonEmptyString(rollbackArtifact, 'rollback artifact reference');
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

function assertChecksumsMatch(checksumArtifact, artifacts) {
  const entries = parseChecksums(checksumArtifact.text);
  if (entries.size !== CHECKSUMMED_EVIDENCE.length) {
    throw new Error('checksums.txt does not cover every required artifact');
  }
  for (const name of CHECKSUMMED_EVIDENCE) {
    if (entries.get(name) !== artifacts[name].sha256) {
      throw new Error(`checksums.txt mismatch: ${name}`);
    }
  }
}

function assertArtifactTargets(artifacts, target) {
  for (const artifact of Object.values(artifacts)) {
    const artifactTarget = artifact.parsed?.target;
    if (!artifactTarget || typeof artifactTarget !== 'object') continue;
    if (
      artifactTarget.database !== undefined &&
      artifactTarget.database !== target.database
    ) {
      throw new Error(`evidence target mismatch: ${artifact.name}`);
    }
    if (
      artifactTarget.schema !== undefined &&
      artifactTarget.schema !== target.schema
    ) {
      throw new Error(`evidence target mismatch: ${artifact.name}`);
    }
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
  assertArtifactTargets(artifacts, safeTarget);
  const releaseReferences = assertReleaseReferences(
    artifacts['release-manifest.json'].parsed,
    releaseId,
  );
  assertChecksumsMatch(artifacts['checksums.txt'], artifacts);
  if (artifacts['signoff.json'].parsed?.result !== 'PASS') {
    throw new Error('signoff.json must contain an explicit PASS');
  }
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
  assertReleaseReferences(
    {
      releaseId: manifest.releaseId,
      commitSha: manifest.references?.commitSha,
      images: manifest.references?.images,
      migrations: manifest.references?.migrations,
      rollbackArtifact: manifest.references?.rollbackArtifact,
    },
    manifest.releaseId,
  );
  return manifest;
}

export async function writeChecksums({ artifactDirectory }) {
  const directory = resolve(
    assertNonEmptyString(artifactDirectory, 'artifact directory'),
  );
  await mkdir(directory, { recursive: true });
  const artifacts = {};
  for (const name of CHECKSUMMED_EVIDENCE) {
    artifacts[name] = await readArtifact(directory, name);
  }
  const signoff = await readArtifact(directory, 'signoff.json');
  if (signoff.parsed?.result !== 'PASS') {
    throw new Error('signoff.json must contain an explicit PASS');
  }
  const checksums = `${CHECKSUMMED_EVIDENCE.map(
    (name) => `${artifacts[name].sha256}  ${name}`,
  ).join('\n')}\n`;
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

async function main(argv) {
  const args = parseArgs(argv, {
    'release-id': { type: 'string', required: true },
    target: { type: 'string', required: true },
    artifacts: { type: 'string', required: true },
    output: { type: 'string' },
    'write-checksums': { type: 'boolean' },
  });
  const artifactDirectory = resolve(args.artifacts);
  if (args['write-checksums']) {
    await writeChecksums({ artifactDirectory });
  }
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
  const fingerprintTarget = targetFingerprint.target ?? targetFingerprint;
  const targetDatabase =
    process.env.TARGET_DATABASE_NAME ?? fingerprintTarget.database;
  const targetSchema = fingerprintTarget.schema ?? args.target;
  if (
    typeof targetDatabase !== 'string' ||
    targetDatabase.trim() === '' ||
    typeof targetSchema !== 'string' ||
    targetSchema !== args.target
  ) {
    throw new Error('target fingerprint does not match --target');
  }
  const manifest = await createEvidenceManifest({
    releaseId: args['release-id'],
    target: { database: targetDatabase, schema: args.target },
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
