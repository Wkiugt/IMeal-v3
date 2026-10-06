import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    const processHandle = spawnOwnedProcess({
      command: process.execPath,
      args: [
        '-e',
        "const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','process.on(\\'SIGTERM\\',()=>{}); setTimeout(()=>{},60000)'],{stdio:'ignore'}); writeFileSync(process.env.CHILD_PID_FILE,String(child.pid)); process.exit(23)",
      ],
      cwd: process.cwd(),
      env: { ...process.env, CHILD_PID_FILE: pidPath },
      detached: true,
    });
    const result = await processHandle.waitForExit(5_000);
    assert.equal(result.code, 23);
    await stopOwnedProcess(processHandle, { graceMs: 200 });
    const childPid = Number(await readFile(pidPath, 'utf8'));
    assert.throws(() => process.kill(childPid, 0));
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
