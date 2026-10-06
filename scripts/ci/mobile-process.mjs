import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_MAX_LOG_BYTES = 512 * 1024;

function commandForPlatform(command) {
  if (process.platform === 'win32' && command.endsWith('.cmd')) {
    return { shell: true };
  }
  return { shell: false };
}

function appendBounded(current, chunk, maxBytes) {
  if (!chunk) return current;
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) return next;
  return `[truncated to ${maxBytes} bytes]\n${next.slice(-maxBytes)}`;
}

function createRedactor(environment) {
  const secrets = Object.entries(environment ?? {})
    .filter(([name, value]) => {
      if (!value) return false;
      return /(TOKEN|SECRET|PASSWORD|PRIVATE|COOKIE|AUTH|CREDENTIAL|KEY)/i.test(name);
    })
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
  return (text) => {
    let result = String(text ?? '');
    for (const secret of secrets) {
      result = result.split(secret).join('[REDACTED]');
    }
    result = result.replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      '$1 [REDACTED]',
    );
    result = result.replace(
      /https?:\/\/[^\s"'<>]*(?:token|secret|password|auth|credential|key|sig|signature)=[^\s"'<>]*/gi,
      '[REDACTED_URL]',
    );
    result = result.replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g,
      '[REDACTED_TOKEN]',
    );
    return result;
  };
}

export class MobileProcessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MobileProcessError';
    this.details = details;
    Object.assign(this, details);
  }
}

export function spawnOwnedProcess({
  command,
  args = [],
  cwd,
  env = process.env,
  logPath,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  detached = process.platform !== 'win32',
  spawnImpl = spawn,
} = {}) {
  const startedAt = Date.now();
  const child = spawnImpl(command, args, {
    cwd,
    env: { ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached,
    shell: commandForPlatform(command).shell,
  });
  let rawStdout = '';
  let rawStderr = '';
  let logWrite = Promise.resolve();
  let logError;
  let logFlushed = false;
  const redact = createRedactor(env);
  const flushLog = () => {
    if (!logPath || logFlushed) return;
    logFlushed = true;
    const contents = `${redact(rawStdout)}${redact(rawStderr)}`;
    if (!contents) return;
    logWrite = logWrite.then(async () => {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, contents, 'utf8');
    });
    logWrite.catch((error) => {
      logError ??= error;
    });
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    rawStdout = appendBounded(rawStdout, chunk, maxLogBytes);
  });
  child.stderr?.on('data', (chunk) => {
    rawStderr = appendBounded(rawStderr, chunk, maxLogBytes);
  });
  let exitResult;
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  let resolveClose;
  const closed = new Promise((resolve) => {
    resolveClose = resolve;
  });
  const makeExitResult = (code, signal, error) => ({
    code,
    signal,
    ...(error ? { error } : {}),
    durationMs: Date.now() - startedAt,
  });
  child.once('error', (error) => {
    exitResult ??= makeExitResult(null, null, error);
    resolveExit(exitResult);
  });
  child.once('exit', (code, signal) => {
    exitResult ??= makeExitResult(code, signal);
    resolveExit(exitResult);
  });
  child.once('close', (code, signal) => {
    exitResult ??= makeExitResult(code, signal);
    flushLog();
    resolveClose(exitResult);
  });
  return {
    child,
    pid: child.pid,
    command,
    args: [...args],
    cwd,
    detached,
    startedAt,
    get exitResult() {
      return exitResult;
    },
    exited,
    closed,
    getLogs() {
      return { stdout: redact(rawStdout), stderr: redact(rawStderr) };
    },
    async flushLogs() {
      await closed;
      flushLog();
      await logWrite;
      if (logError) throw logError;
    },
    async waitForExit(timeoutMs) {
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              timedOut: true,
              durationMs: Date.now() - startedAt,
            }),
          timeoutMs,
        );
        timer.unref?.();
      });
      const result = await Promise.race([exited, timeout]);
      clearTimeout(timer);
      return result;
    },
    async waitForClose(timeoutMs) {
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              timedOut: true,
              durationMs: Date.now() - startedAt,
            }),
          timeoutMs,
        );
        timer.unref?.();
      });
      const result = await Promise.race([closed, timeout]);
      clearTimeout(timer);
      return result;
    },
  };
}

function hasOwnedGroup(processHandle) {
  if (process.platform === 'win32' || !processHandle.detached || !processHandle.pid) {
    return false;
  }
  try {
    process.kill(-processHandle.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function killProcessTree(processHandle, signal) {
  const pid = processHandle.pid;
  if (!pid) return { status: 0 };
  if (process.platform === 'win32') {
    return spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5_000,
      killSignal: 'SIGKILL',
    });
  }
  try {
    if (processHandle.detached) process.kill(-pid, signal);
    else processHandle.child.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  return { status: 0 };
}

export async function stopOwnedProcess(
  processHandle,
  { graceMs = 2_000 } = {},
) {
  if (!processHandle?.pid) return processHandle?.exitResult ?? null;
  const termination = killProcessTree(processHandle, 'SIGTERM');
  const result = await processHandle.waitForClose(graceMs);
  if (!result?.timedOut && !hasOwnedGroup(processHandle)) {
    await processHandle.flushLogs();
    return result;
  }
  const forcedTermination = killProcessTree(processHandle, 'SIGKILL');
  if (forcedTermination?.error) throw forcedTermination.error;
  processHandle.child.stdout?.destroy();
  processHandle.child.stderr?.destroy();
  try {
    processHandle.child.kill('SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const forcedResult = await processHandle.waitForClose(graceMs);
  if (forcedResult?.timedOut) {
    throw new MobileProcessError(
      `Unable to stop owned process ${processHandle.pid}`,
      { processHandle, termination, forcedTermination, result: forcedResult },
    );
  }
  await processHandle.flushLogs();
  return forcedResult;
}

export async function runOwnedProcess({
  command,
  args,
  cwd,
  env = process.env,
  logPath,
  timeoutMs = 120_000,
  spawnImpl = spawn,
  onSpawn,
} = {}) {
  const processHandle = spawnOwnedProcess({
    command,
    args,
    cwd,
    env,
    logPath,
    detached: true,
    spawnImpl,
  });
  onSpawn?.(processHandle);
  const result = await processHandle.waitForExit(timeoutMs);
  let cleanupError;
  try {
    await stopOwnedProcess(processHandle);
  } catch (error) {
    cleanupError = error;
  }
  const diagnostics = processHandle.getLogs();
  if (result?.timedOut) {
    throw new MobileProcessError(
      cleanupError
        ? `Process timed out and cleanup failed: ${command} ${args.join(' ')}`
        : `Process timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
      { result, diagnostics, cleanupError, processHandle },
    );
  }
  if (cleanupError) {
    throw new MobileProcessError(
      `Process cleanup failed after exit: ${command} ${args.join(' ')}`,
      { result, diagnostics, cleanupError, processHandle },
    );
  }
  if (result?.error || result?.code !== 0) {
    throw new MobileProcessError(
      `Process exited unsuccessfully (${result?.code ?? result?.signal ?? 'unknown'}): ${command} ${args.join(' ')}`,
      { result, diagnostics, processHandle },
    );
  }
  return { result, diagnostics, processHandle };
}
