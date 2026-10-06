import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const yarnCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const corepackScript = process.platform === 'win32'
  ? resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', 'corepack', 'dist', 'corepack.js')
  : null;

function shouldCopy(sourcePath) {
  const relativePath = relative(repositoryRoot, sourcePath);
  if (!relativePath) return true;
  const segments = relativePath.split(/[\\/]/);
  const basename = segments.at(-1) ?? '';
  return !segments.some((segment) => ['.expo', '.git', '.superpowers', '.turbo', '.yarn', 'coverage', 'dist', 'generated', 'node_modules'].includes(segment)) && !basename.endsWith('.tsbuildinfo') && basename !== '.env' && !basename.startsWith('.env.');
}

function runYarn(root, args) {
  const command = process.platform === 'win32' ? process.execPath : yarnCommand;
  const commandArgs = process.platform === 'win32' ? [corepackScript, 'yarn', ...args] : ['yarn', ...args];
  return spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', shell: false, env: { ...process.env, CI: 'true' }, timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
}

test('real clean-copy export validates all platforms and rejects a broken app import', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'imeal-mobile-real-'));
  const root = join(parent, 'repo');
  try {
    await cp(repositoryRoot, root, { recursive: true, filter: shouldCopy });
    const install = runYarn(root, ['install', '--immutable']);
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
    for (const file of ['mobile-process.mjs', 'mobile-export.mjs']) await cp(join(repositoryRoot, 'scripts', 'ci', file), join(root, 'scripts', 'ci', file));
    const { exportMobile } = await import(pathToFileURL(join(root, 'scripts', 'ci', 'mobile-export.mjs')).href);
    const success = await exportMobile({ root, keepOutput: false });
    assert.equal(success.result, 'PASS');
    assert.deepEqual(Object.keys(success.platforms).sort(), ['android', 'ios', 'web']);
    await appendFile(join(root, 'apps', 'mobile', 'index.js'), "\nimport './__imeal_missing_mobile_regression_import__.js';\n", 'utf8');
    const outputDir = join(parent, 'broken-output');
    await assert.rejects(exportMobile({ root, outputDir, keepOutput: false }), (error) => {
      assert.equal(Number.isInteger(error.result?.code), true);
      assert.ok(error.result.code > 0);
      const diagnostics = `${error.message}\n${error.diagnostics?.stdout ?? ''}\n${error.diagnostics?.stderr ?? ''}`;
      assert.match(diagnostics, /Process exited unsuccessfully/);
      assert.doesNotMatch(error.message, /PASS/);
      return true;
    });
    await assert.rejects(stat(outputDir), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
