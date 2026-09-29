import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const runbookPath = join(
  repositoryRoot,
  'docs',
  'runbooks',
  'staging-readiness.md',
);
const packageJsonPath = join(repositoryRoot, 'package.json');

async function pathExists(relativePath) {
  try {
    await access(join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function markdownCodeBlocks(markdown) {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
}

function referencedRepositoryPaths(code) {
  return [
    ...code.matchAll(
      /(?:^|[\s"'`])((?:scripts|\.github\/workflows|docker-compose(?:\.staging)?\.yml)(?:[A-Za-z0-9_./-]*))/gm,
    ),
  ].map((match) => match[1]);
}

function referencedPackageScripts(code, packageScripts) {
  const names = new Set();
  for (const match of code.matchAll(
    /\byarn\s+(?:run\s+)?([A-Za-z][A-Za-z0-9:_-]*)/g,
  )) {
    const name = match[1];
    if (Object.hasOwn(packageScripts, name)) names.add(name);
  }
  return [...names];
}

async function workspacePackageNames() {
  const names = [];
  for (const root of ['apps', 'packages']) {
    for (const entry of await readdir(join(repositoryRoot, root), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      try {
        const packageJson = JSON.parse(
          await readFile(
            join(repositoryRoot, root, entry.name, 'package.json'),
            'utf8',
          ),
        );
        if (typeof packageJson.name === 'string') names.push(packageJson.name);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return new Set(names);
}

test('every runbook command points at checked-in tooling', async () => {
  const [runbook, packageJson] = await Promise.all([
    readFile(runbookPath, 'utf8'),
    readFile(packageJsonPath, 'utf8'),
  ]);
  const packageData = JSON.parse(packageJson);
  const code = markdownCodeBlocks(runbook).join('\n');
  const paths = [...new Set(referencedRepositoryPaths(runbook))];
  assert.ok(paths.length > 0, 'runbook must contain checked-in command paths');
  for (const relativePath of paths) {
    assert.equal(
      await pathExists(relativePath),
      true,
      `runbook references missing repository path: ${relativePath}`,
    );
  }

  const scripts = referencedPackageScripts(code, packageData.scripts ?? {});
  assert.ok(scripts.length > 0, 'runbook must contain package script commands');
  for (const script of scripts) {
    assert.equal(
      Object.hasOwn(packageData.scripts ?? {}, script),
      true,
      `runbook references missing package script: ${script}`,
    );
  }
  const workspaces = await workspacePackageNames();
  for (const match of code.matchAll(/\byarn\s+workspace\s+([^\s]+)/g)) {
    assert.equal(
      workspaces.has(match[1]),
      true,
      `runbook references missing workspace package: ${match[1]}`,
    );
  }
});

test('runbook includes every implemented staging operator command', async () => {
  const runbook = await readFile(runbookPath, 'utf8');
  for (const relativePath of [
    'scripts/staging/backup-staging.mjs',
    'scripts/staging/restore-rehearsal.mjs',
    'scripts/staging/phase0-preflight.mjs',
    'scripts/staging/phase0-backfill.mjs',
    'scripts/staging/phase0-validate.mjs',
    'scripts/staging/smoke-staging.mjs',
    'scripts/staging/evidence.mjs',
    'scripts/staging/release-manifest.mjs',
    'docker-compose.yml',
    'docker-compose.staging.yml',
    '.github/workflows/staging-readiness.yml',
  ]) {
    assert.match(
      runbook,
      new RegExp(relativePath.replaceAll('.', '\\.'), 'u'),
      `runbook must reference ${relativePath}`,
    );
  }
  assert.match(runbook, /--session-token-env\s+STAGING_SMOKE_SESSION_TOKEN/u);
});

test('externalizes evidence and verifies the prior rollback artifact', async () => {
  const runbook = await readFile(runbookPath, 'utf8');
  assert.match(
    runbook,
    /export EVIDENCE_ROOT=\/var\/lib\/imeal\/staging-evidence/u,
  );
  assert.match(runbook, /EVIDENCE_ROOT must be outside the git checkout/u);
  assert.doesNotMatch(runbook, /export EVIDENCE_DIR=artifacts\//u);
  assert.match(runbook, /PRIOR_ROLLBACK_ARTIFACT_SOURCE/u);
  assert.match(runbook, /PRIOR_ROLLBACK_ARTIFACT_SHA256/u);
  assert.match(runbook, /\$EVIDENCE_DIR\/rollback\/previous-release\.tar/u);
  assert.match(runbook, /sha256sum\s+--check\s+--strict/u);
  assert.match(
    runbook,
    /--rollback-artifact\s+rollback\/previous-release\.tar/u,
  );
});

test('provisions protected manifest inputs before generating evidence', async () => {
  const runbook = await readFile(runbookPath, 'utf8');
  assert.match(runbook, /PROTECTED_RELEASE_INPUTS_DIR/u);
  assert.match(runbook, /PROTECTED_RELEASE_INPUTS_REVIEWED/u);
  assert.match(
    runbook,
    /protected release inputs must be outside the git checkout/u,
  );
  assert.match(runbook, /\[ ! -f "\$source_path" \]/u);
  assert.match(runbook, /\[ -L "\$source_path" \]/u);
  for (const name of [
    'images.json',
    'check-results.json',
    'runtime-integration.json',
    'staging-smoke.json',
    'deployed-image-sbom-index.json',
    'deployed-image-sbom-api.spdx.json',
    'deployed-image-sbom-worker.spdx.json',
    'deployed-image-sbom-admin-web.spdx.json',
  ]) {
    assert.match(runbook, new RegExp(name.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(runbook, /install -m 0440/u);
  assert.match(
    runbook,
    /'staging-smoke\.json:artifacts\/staging-smoke\.json'/u,
  );
  assert.match(
    runbook,
    /'deployed-image-sbom-index\.json:artifacts\/deployed-image-sbom-index\.json'/u,
  );
  assert.match(
    runbook,
    /Only after all eight inputs are installed may the operator/u,
  );
});

test('production sections do not contain unsafe local or Firebase rollback instructions', async () => {
  const runbook = await readFile(runbookPath, 'utf8');
  const sections = runbook.split(/(?=^#{1,6}\s)/m);
  const productionSections = sections.filter((section) =>
    /^#{1,6}\s.*(?:production|go-live|release)/imu.test(section),
  );
  assert.ok(
    productionSections.length > 0,
    'runbook needs a production safety section',
  );
  const productionText = productionSections.join('\n');
  for (const forbidden of [
    /REQUIRE_AUTH\s*=\s*false/iu,
    /seed:local/iu,
    /docker\s+compose\s+down\s+-v/iu,
    /Firebase\s+rollback/iu,
  ]) {
    assert.doesNotMatch(
      productionText,
      forbidden,
      `forbidden production instruction found: ${forbidden}`,
    );
  }
});
