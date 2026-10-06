import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runPrerequisite } from './ci-verify.mjs';

async function withOutput(prefix, callback) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('owned prerequisite timeout cleans a real descendant and writes bounded logs', async () => {
  await withOutput('imeal-ci-prerequisite-timeout-', async (output) => {
    const pidPath = join(output, 'descendant.pid');
    const result = await runPrerequisite({
      id: 'install-immutable',
      argv: [
        process.execPath,
        '-e',
        `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); setInterval(() => {}, 60000);`,
      ],
      output,
      environment: { CI: 'true' },
      timeoutMs: 150,
    });
    assert.equal(result.result, 'FAIL');
    assert.match(await readFile(join(output, result.stderrRef), 'utf8'), /Process timed out/);
    assert.equal(isAlive(Number(await readFile(pidPath, 'utf8'))), false);
  });
});

test('owned prerequisite preserves real nonzero status and redacts diagnostics', async () => {
  await withOutput('imeal-ci-prerequisite-failure-', async (output) => {
    const secret = 'prerequisite-secret-value';
    const result = await runPrerequisite({
      id: 'yarn-version',
      argv: [process.execPath, '-e', `process.stderr.write(${JSON.stringify(`secret=${secret}`)}); process.exit(23)`],
      output,
      environment: { CI: 'true', PREREQUISITE_TEST_TOKEN: secret },
      timeoutMs: 5_000,
    });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.exitCode, 23);
    const stderr = await readFile(join(output, result.stderrRef), 'utf8');
    assert.doesNotMatch(stderr, new RegExp(secret));
    assert.match(stderr, /REDACTED/);
  });
});
