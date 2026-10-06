import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MobileProcessError, runOwnedProcess } from './mobile-process.mjs';
import { runDispatcher } from './ci-dispatcher.mjs';

const metadata = {
  releaseId: 'imeal-99-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  laneId: 'static',
  runId: '99',
  runAttempt: 1,
  sourceSha: 'a'.repeat(40),
  workflowSha: 'b'.repeat(40),
};

function nodeCommand(source) {
  return [process.execPath, '--input-type=module', '-e', source];
}

async function withOutput(prefix, callback) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function waitForPath(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await access(path);
      return true;
    } catch {}
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('real child checks continue after failure, record elapsed status, and redact split credentials', async () => {
  await withOutput('imeal-ci-dispatch-real-', async (output) => {
    const marker = join(output, 'independent.marker');
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      commands: [
        {
          id: 'typecheck',
          argv: nodeCommand(
            `process.stdout.write('pass'); setTimeout(() => { process.stdout.write('word=super-secret\\n'); process.exit(7); }, 10)`,
          ),
        },
        {
          id: 'lint',
          argv: nodeCommand(
            `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'ran')`,
          ),
        },
      ],
      environment: {
        CI: 'true',
        DATABASE_URL: 'postgresql://developer:secret@localhost/db',
      },
    });
    assert.equal(producer.result, 'FAIL');
    assert.equal(producer.steps[0].exitCode, 7);
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(producer.steps[1].result, 'PASS');
    assert.ok(Number.isInteger(producer.steps[0].elapsedMs));
    assert.equal(await readFile(marker, 'utf8'), 'ran');
    const stdout = await readFile(join(output, 'typecheck.stdout.log'), 'utf8');
    assert.doesNotMatch(stdout, /super-secret|developer:secret/);
    assert.match(stdout, /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(producer), /DATABASE_URL|developer:secret/);
  });
});

test('real spawn failure is recorded and does not prevent independent marker', async () => {
  await withOutput('imeal-ci-dispatch-spawn-', async (output) => {
    const marker = join(output, 'spawn-independent.marker');
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      commands: [
        { id: 'typecheck', argv: ['imeal-command-that-does-not-exist-9f1d'] },
        {
          id: 'lint',
          argv: nodeCommand(
            `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'ran')`,
          ),
        },
      ],
      environment: { CI: 'true' },
    });
    assert.equal(producer.result, 'FAIL');
    assert.notEqual(producer.steps[0].exitCode, 0);
    assert.ok(producer.steps[0].errorCode);
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  });
});

test('real hanging child is bounded, terminated, and later independent work runs', async () => {
  await withOutput('imeal-ci-dispatch-timeout-', async (output) => {
    const marker = join(output, 'timeout-independent.marker');
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      commands: [
        {
          id: 'typecheck',
          timeoutMs: 100,
          argv: nodeCommand('setInterval(() => {}, 1000)'),
        },
        {
          id: 'lint',
          argv: nodeCommand(
            `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'ran')`,
          ),
        },
      ],
      environment: { CI: 'true' },
    });
    assert.equal(producer.result, 'FAIL');
    assert.equal(producer.steps[0].timedOut, true);
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  });
});

test('blocked Docker dependency records a failure without executing it while independent marker runs', async () => {
  await withOutput('imeal-ci-dispatch-blocked-', async (output) => {
    const marker = join(output, 'blocked-independent.marker');
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      commands: [
        { id: 'typecheck', argv: ['docker', 'run', 'must-not-execute'] },
        {
          id: 'lint',
          argv: nodeCommand(
            `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'ran')`,
          ),
        },
      ],
      environment: { CI: 'true' },
    });
    assert.equal(producer.steps[0].result, 'BLOCKED');
    assert.equal(producer.steps[0].exitCode, -2);
    assert.match(await readFile(join(output, 'typecheck.stderr.log'), 'utf8'), /blocked/i);
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  });
});

test('failed dependencies are BLOCKED while independent commands still execute', async () => {
  await withOutput('imeal-ci-dispatch-dependency-', async (output) => {
    const marker = join(output, 'dependency-independent.marker');
    const producer = await runDispatcher({
      ...metadata,
      laneId: 'static',
      outputDirectory: output,
      commands: [
        { id: 'typecheck', argv: nodeCommand('process.exit(4)') },
        { id: 'lint', dependsOn: ['typecheck'], argv: nodeCommand('process.exit(0)') },
        { id: 'independent', argv: nodeCommand(`import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'ran')`) },
      ],
      environment: { CI: 'true' },
    });
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(producer.steps[1].result, 'BLOCKED');
    assert.equal(producer.steps[1].exitCode, -2);
    assert.equal(producer.steps[2].result, 'PASS');
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  });
});

test('cleanup failure after a successful child is a nonzero failure with retained error text', async () => {
  await withOutput('imeal-ci-dispatch-cleanup-success-', async (output) => {
    const processRunner = async (options) => {
      const execution = await runOwnedProcess(options);
      throw new MobileProcessError('cleanup failed after successful child', {
        result: execution.result,
        diagnostics: { stdout: '', stderr: '' },
        cleanupError: new Error('cleanup failed after successful child'),
      });
    };
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      processRunner,
      commands: [{ id: 'typecheck', argv: nodeCommand('process.exit(0)') }],
      environment: { CI: 'true' },
    });
    assert.equal(producer.result, 'FAIL');
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(producer.steps[0].exitCode, -1);
    assert.match(await readFile(join(output, 'typecheck.stderr.log'), 'utf8'), /cleanup failed after successful child/);
  });
});

test('cleanup failure preserves an original nonzero child result', async () => {
  await withOutput('imeal-ci-dispatch-cleanup-failure-', async (output) => {
    const processRunner = async (options) => {
      try {
        return await runOwnedProcess(options);
      } catch (error) {
        throw new MobileProcessError('cleanup failed after nonzero child', {
          result: error.result,
          diagnostics: { stdout: '', stderr: '' },
          cleanupError: new Error('cleanup failed after nonzero child'),
        });
      }
    };
    const producer = await runDispatcher({
      ...metadata,
      outputDirectory: output,
      processRunner,
      commands: [{ id: 'typecheck', argv: nodeCommand('process.exit(23)') }],
      environment: { CI: 'true' },
    });
    assert.equal(producer.result, 'FAIL');
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(producer.steps[0].exitCode, 23);
    assert.match(await readFile(join(output, 'typecheck.stderr.log'), 'utf8'), /cleanup failed after nonzero child/);
  });
});

test('signal handler cancellation blocks later real work and cleans its owned descendant', async () => {
  await withOutput('imeal-ci-dispatch-cancel-', async (output) => {
    const ready = join(output, 'ready.marker');
    const pidPath = join(output, 'descendant.pid');
    const later = join(output, 'later.marker');
    const descendantSource = `import { writeFile } from 'node:fs/promises'; await writeFile(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`;
    const firstSource = `import { access, writeFile } from 'node:fs/promises'; import { spawn } from 'node:child_process'; const ready = process.argv[1]; const pidPath = process.argv[2]; spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(descendantSource)}, pidPath], { stdio: 'ignore' }); for (let i = 0; i < 200; i += 1) { try { await access(pidPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } } await writeFile(ready, 'ready'); setInterval(() => {}, 1000);`;
    const runPromise = runDispatcher({
      ...metadata,
      outputDirectory: output,
      processRunner: runOwnedProcess,
      commands: [
        { id: 'typecheck', argv: [...nodeCommand(firstSource), ready, pidPath], timeoutMs: 10_000 },
        { id: 'lint', argv: [...nodeCommand(`import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(later)}, 'ran')`)] },
      ],
      environment: { CI: 'true' },
    });
    assert.equal(await waitForPath(ready), true);
    process.emit('SIGTERM');
    const producer = await runPromise;
    assert.equal(producer.result, 'FAIL');
    assert.equal(producer.steps[0].result, 'FAIL');
    assert.equal(producer.steps[1].result, 'BLOCKED');
    assert.equal(producer.steps[1].exitCode, -2);
    assert.equal(await waitForPath(later, 250), false);
    const descendantPid = Number(await readFile(pidPath, 'utf8'));
    assert.equal(processAlive(descendantPid), false);
  });
});

test(
  'external POSIX SIGTERM cancels the dispatcher and cleans its owned descendant',
  { skip: process.platform === 'win32' ? 'Windows child.kill(SIGTERM) uses TerminateProcess; POSIX signal interception is unavailable' : false },
  async () => {
    await withOutput('imeal-ci-dispatch-posix-signal-', async (output) => {
      const ready = join(output, 'ready.marker');
      const pidPath = join(output, 'descendant.pid');
      const later = join(output, 'later.marker');
      const descendant = join(output, 'descendant.mjs');
      const first = join(output, 'first.mjs');
      const commandsPath = join(output, 'commands.json');
      await writeFile(descendant, `import { writeFile } from 'node:fs/promises'; await writeFile(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`);
      await writeFile(first, `import { access, writeFile } from 'node:fs/promises'; import { spawn } from 'node:child_process'; const [readyPath, pidPath, descendantPath] = process.argv.slice(1); spawn(process.execPath, [descendantPath, pidPath], { stdio: 'ignore' }); for (let i = 0; i < 200; i += 1) { try { await access(pidPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } } await writeFile(readyPath, 'ready'); setInterval(() => {}, 1000);`);
      await writeFile(commandsPath, JSON.stringify([
        { id: 'typecheck', timeoutMs: 10_000, argv: [process.execPath, first, ready, pidPath, descendant] },
        { id: 'lint', argv: nodeCommand(`import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(later)}, 'ran')`) },
      ]));
      const dispatcher = fileURLToPath(new URL('./ci-dispatcher.mjs', import.meta.url));
      const child = spawn(process.execPath, [dispatcher, '--release-id', metadata.releaseId, '--lane-id', metadata.laneId, '--run-id', metadata.runId, '--run-attempt', '1', '--source-sha', metadata.sourceSha, '--workflow-sha', metadata.workflowSha, '--commands-json', commandsPath, '--output', output], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const exit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
      try {
        assert.equal(await waitForPath(ready), true);
        assert.equal(child.kill('SIGTERM'), true);
        const result = await Promise.race([exit, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 15_000))]);
        assert.equal(result.timedOut, undefined);
        assert.ok(Number.isInteger(result.code) && result.code !== 0);
        assert.equal(await waitForPath(later, 250), false);
        const descendantPid = Number(await readFile(pidPath, 'utf8'));
        assert.equal(processAlive(descendantPid), false);
      } finally {
        if (!child.killed) child.kill('SIGKILL');
      }
    });
  },
);
