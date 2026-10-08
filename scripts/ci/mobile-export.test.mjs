import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  exportMobile,
  validateExportOutput,
} from './mobile-export.mjs';

async function createExportFixture() {
  const root = await mkdtemp(join(tmpdir(), 'imeal-mobile-export-test-'));
  const files = {
    android: 'bundles/android.js',
    ios: 'bundles/ios.js',
    web: '_expo/static/js/web/index.js',
    androidAsset: 'assets/android.png',
    iosAsset: 'assets/ios.png',
  };
  for (const [name, relativePath] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, name.includes('Asset') ? 'asset' : 'globalThis.__imeal = true;');
  }
  await writeFile(
    join(root, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        android: {
          bundle: files.android,
          assets: [{ path: files.androidAsset, ext: 'png' }],
        },
        ios: {
          bundle: files.ios,
          assets: [{ path: files.iosAsset, ext: 'png' }],
        },
      },
    }),
  );
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>IMealMobile</title></head><body><script src="/_expo/static/js/web/index.js"></script></body></html>',
  );
  return { root, files };
}

test('validates real Android, iOS metadata assets and referenced web bundle', async () => {
  const fixture = await createExportFixture();
  try {
    const report = await validateExportOutput(fixture.root);
    assert.equal(report.platforms.android.assets[0].bytes, 5);
    assert.equal(report.platforms.ios.assets[0].bytes, 5);
    assert.equal(report.platforms.web.bundle, fixture.files.web);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects missing native metadata assets and missing web script files', async () => {
  const fixture = await createExportFixture();
  try {
    await rm(join(fixture.root, fixture.files.androidAsset));
    await assert.rejects(validateExportOutput(fixture.root), /metadata asset/);
    await writeFile(join(fixture.root, fixture.files.androidAsset), 'asset');
    await writeFile(
      join(fixture.root, 'index.html'),
      '<script src="/_expo/static/js/web/missing.js"></script>',
    );
    await assert.rejects(validateExportOutput(fixture.root), /web script reference/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runs explicit shared preparation and minified all-platform export', async () => {
  const calls = [];
  const runner = async ({ args }) => {
    calls.push(args);
    if (args.includes('export')) {
      const outputDir = args.at(-1);
      const fixture = await createExportFixture();
      const files = await import('node:fs/promises');
      await files.cp(fixture.root, outputDir, { recursive: true });
      await rm(fixture.root, { recursive: true, force: true });
    }
    return { result: { code: 0 }, diagnostics: { stdout: '', stderr: '' } };
  };
  const report = await exportMobile({ runner, keepOutput: false });
  assert.equal(report.result, 'PASS');
  assert.equal(report.commandExitCode, 0);
  assert.equal(calls[0][1], 'turbo');
  assert.deepEqual(calls[0].slice(1), [
    'turbo',
    'run',
    'build',
    '--filter=@imeal/core',
    '--filter=@imeal/contracts',
  ]);
  assert.ok(calls[1].includes('--platform') && calls[1].includes('all'));
  assert.ok(!calls[1].includes('--no-minify'));
});

test('rejects an export command failure and removes invocation-owned output', async () => {
  let outputDir;
  await assert.rejects(
    exportMobile({
      runner: async ({ args }) => {
        if (args.includes('export')) outputDir = args.at(-1);
        return { result: { code: args.includes('export') ? 23 : 0 } };
      },
    }),
    /did not exit successfully/,
  );
  await assert.rejects(stat(outputDir), { code: 'ENOENT' });
});

test('never removes an existing caller-owned output directory', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'imeal-mobile-export-existing-'));
  const outputDir = join(parent, 'existing');
  await mkdir(outputDir);
  await writeFile(join(outputDir, 'sentinel'), 'keep');
  try {
    await assert.rejects(exportMobile({ outputDir }), /already exists/);
    assert.equal(await stat(join(outputDir, 'sentinel')).then(() => 'keep'), 'keep');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
