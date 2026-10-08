import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  MobileProcessError,
  runOwnedProcess,
  spawnOwnedProcess,
  stopOwnedProcess,
} from './mobile-process.mjs';

const temporaryDirectories = [];

async function tempLog(name) {
  const directory = await mkdtemp(join(tmpdir(), `imeal-mobile-${name}-`));
  temporaryDirectories.push(directory);
  return join(directory, 'process.log');
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const state = stat.slice(stat.lastIndexOf(')') + 2).trimStart()[0];
        if (state === 'Z') return false;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        return false;
      }
    }
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessStop(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!processAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test.after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('captures a successful process result and diagnostics', async () => {
  const logPath = await tempLog('success');
  const result = await runOwnedProcess({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ready\\n'); process.stderr.write('detail\\n')"],
    cwd: process.cwd(),
    logPath,
    timeoutMs: 5_000,
  });
  assert.equal(result.result.code, 0);
  assert.match(result.diagnostics.stdout, /ready/);
  assert.match(result.diagnostics.stderr, /detail/);
  assert.match(await readFile(logPath, 'utf8'), /ready/);
});

test('preserves early nonzero exit and captured diagnostics', async () => {
  await assert.rejects(
    runOwnedProcess({
      command: process.execPath,
      args: ['-e', "process.stderr.write('startup failure\\n'); process.exit(23)"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }),
    (error) => {
      assert.equal(error.result.code, 23);
      assert.match(error.diagnostics.stderr, /startup failure/);
      return true;
    },
  );
});

test('times out and cleans up a still-running owned process', async () => {
  const logPath = await tempLog('timeout');
  await assert.rejects(
    runOwnedProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      cwd: process.cwd(),
      logPath,
      timeoutMs: 100,
    }),
    (error) => {
      assert.ok(error instanceof MobileProcessError);
      assert.equal(error.result.timedOut, true);

      return true;
    },
  );
});
test('cleans an owned descendant when the parent times out', async () => {
  const logPath = await tempLog('descendant');
  const pidPath = `${logPath}.pid`;
  await assert.rejects(
    runOwnedProcess({
      command: process.execPath,
      args: [
        '-e',
        "const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'}); writeFileSync(process.env.CHILD_PID_FILE,String(child.pid)); setTimeout(()=>{},60000)",
      ],
      cwd: process.cwd(),
      env: { ...process.env, CHILD_PID_FILE: pidPath },
      timeoutMs: 200,
    }),
    /timed out/,
  );
  const childPid = Number(await readFile(pidPath, 'utf8'));
  let alive = true;
  try {
    process.kill(childPid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false);
});
test(
  'drains a detached descendant after an early leader exit',
  { skip: process.platform === 'win32' ? 'Windows taskkill has no process-group probe' : false },
  async () => {
    const logPath = await tempLog('early-descendant');
    const pidPath = `${logPath}.pid`;
    const descendantSource =
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 60_000); process.send('ready');";
    const leaderSource = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }); child.once('message', (message) => { if (message !== 'ready') return; writeFileSync(process.env.CHILD_PID_FILE, String(child.pid)); child.disconnect(); process.exit(23); });`;
    const processHandle = spawnOwnedProcess({
      command: process.execPath,
      args: ['-e', leaderSource],
      cwd: process.cwd(),
      env: { ...process.env, CHILD_PID_FILE: pidPath },
      detached: true,
    });
    let childPid;
    let cleanupResult;
    try {
      const result = await processHandle.waitForExit(5_000);
      assert.equal(result.code, 23);
      childPid = Number(await readFile(pidPath, 'utf8'));
      // kill(pid, 0) reports Linux zombies as present, so processAlive checks /proc state.
      assert.equal(processAlive(childPid), true);
    } finally {
      cleanupResult = await stopOwnedProcess(processHandle, { graceMs: 200 });
    }
    assert.equal(cleanupResult?.timedOut, undefined);
    assert.equal(processHandle.exitResult?.code, 23);
    assert.equal((await processHandle.waitForClose(2_000)).code, 23);
    assert.equal(processAlive(processHandle.pid), false);
    assert.equal(await waitForProcessStop(childPid), true);
    assert.equal(processHandle.child.stdout?.destroyed, true);
    assert.equal(processHandle.child.stderr?.destroyed, true);
  },
);

test('redacts split credentials and credential URLs from logs', async () => {
  const logPath = await tempLog('redaction');
  const secret = 'split-secret-value';
  const result = await runOwnedProcess({
    command: process.execPath,
    args: [
      '-e',
      `process.stdout.write('split-secret-'); process.stdout.write('value https://example.test/download?token=${secret}');`,
    ],
    cwd: process.cwd(),
    env: { ...process.env, MOBILE_TEST_TOKEN: secret },
    logPath,
    timeoutMs: 5_000,
  });
  const logs = `${result.diagnostics.stdout}\n${await readFile(logPath, 'utf8')}`;
  assert.doesNotMatch(logs, new RegExp(secret));
  assert.match(logs, /\[REDACTED\]|\[REDACTED_URL\]/);
});


test('cancels a live owned process and drains its streams', async () => {
  const processHandle = spawnOwnedProcess({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("live"); setTimeout(() => {}, 60_000)'],
    cwd: process.cwd(),
    detached: false,
  });
  const result = await stopOwnedProcess(processHandle, { graceMs: 500 });
  assert.ok(result);
  assert.equal(processHandle.exitResult?.timedOut, undefined);
});
test('stopOwnedProcess does not replace an already observed failure', async () => {
  const processHandle = spawnOwnedProcess({
    command: process.execPath,
    args: ['-e', 'process.exit(17)'],
    cwd: process.cwd(),
    detached: false,
  });
  const result = await processHandle.waitForExit(5_000);
  assert.equal(result.code, 17);
  assert.equal((await stopOwnedProcess(processHandle)).code, 17);
});
