import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createProducerEvidence,
  laneArtifactName,
  redact,
} from './ci-contracts.mjs';
import {
  MobileProcessError,
  runOwnedProcess,
  stopOwnedProcess,
} from './mobile-process.mjs';

function assertRequired(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function commandName(argv) {
  return Array.isArray(argv) && typeof argv[0] === 'string' ? argv[0] : '';
}

function isDockerCommand(argv) {
  const command = commandName(argv).toLowerCase();
  return command === 'docker' || command === 'docker-compose';
}

function authorizedDocker({ allowDocker, environment }) {
  return Boolean(
    allowDocker &&
      environment.CI_DOCKER_AUTHORIZED === 'true' &&
      (environment.GITHUB_ACTIONS === 'true' || environment.CI_DOCKER_LOCAL_AUTHORIZED === 'true'),
  );
}

export function childEnvironment(environment = process.env, preserveDatabaseUrl = false) {
  const child = { ...environment };
  if (!preserveDatabaseUrl) delete child.DATABASE_URL;
  delete child.GITHUB_TOKEN;
  delete child.STAGING_ENV_FILE;
  delete child.STAGING_SMOKE_SESSION_TOKEN;
  return child;
}

const MAX_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const activeChildren = new Set();

async function runChild({ argv, cwd, environment, spawnImpl, processRunner = runOwnedProcess, timeoutMs = MAX_COMMAND_TIMEOUT_MS }) {
  const [command, ...args] = argv;
  let processHandle;
  try {
    const execution = await processRunner({
      command,
      args,
      cwd,
      env: environment,
      timeoutMs,
      spawnImpl,
      onSpawn: (handle) => {
        processHandle = handle;
        activeChildren.add(handle);
      },
    });
    return {
      exitCode: Number.isInteger(execution.result?.code) ? execution.result.code : -1,
      signal: execution.result?.signal ?? null,
      stdout: execution.diagnostics?.stdout ?? '',
      stderr: execution.diagnostics?.stderr ?? '',
      timedOut: false,
    };
  } catch (error) {
    const details = error instanceof MobileProcessError ? (error.details ?? error) : {};
    const result = details.result ?? {};
    const diagnostics = details.diagnostics ?? {};
    const cleanupFailure = Boolean(details.cleanupError);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exitCode: result.timedOut ? -1 : (Number.isInteger(result.code) && result.code !== 0 ? result.code : cleanupFailure ? -1 : -1),
      signal: result.signal ?? null,
      stdout: diagnostics.stdout ?? '',
      stderr: diagnostics.stderr || errorMessage,
      timedOut: Boolean(result.timedOut),
      ...(result.error ? { errorCode: result.error.code ?? 'SPAWN_ERROR' } : {}),
      ...(cleanupFailure ? { errorCode: 'CLEANUP_FAILED' } : {}),
    };
  } finally {
    if (processHandle) activeChildren.delete(processHandle);
  }
}

export async function runDispatcher({
  releaseId,
  laneId,
  runId,
  runAttempt,
  sourceSha,
  workflowSha,
  commands,
  outputDirectory,
  cwd = process.cwd(),
  environment = process.env,
  preserveDatabaseUrl = false,
  allowDocker = false,
  spawnImpl = spawn,
  image,
  processRunner = runOwnedProcess,
  clock = () => performance.now(),
}) {
  assertRequired(releaseId, 'release ID');
  assertRequired(laneId, 'lane ID');
  assertRequired(String(runId), 'run ID');
  assertRequired(sourceSha, 'source SHA');
  assertRequired(workflowSha, 'workflow SHA');
  if (!Number.isInteger(runAttempt) || runAttempt < 1) throw new Error('run attempt is invalid');
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('commands are required');
  const directory = resolve(assertRequired(outputDirectory, 'output directory'));
  await mkdir(directory, { recursive: true });
  const childEnv = childEnvironment(environment, preserveDatabaseUrl);
  const canUseDocker = authorizedDocker({ allowDocker, environment });
  const steps = [];
  const diagnostics = [];
  const terminationErrors = [];
  let cancelled = false;
  const forwardSignal = (signal) => {
    cancelled = true;
    for (const processHandle of activeChildren) {
      void stopOwnedProcess(processHandle, { graceMs: 2_000 }).catch((error) => {
        terminationErrors.push(error instanceof Error ? error.message : String(error));
      });
      processHandle.child?.kill?.(signal);
    }
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);
  process.on('SIGHUP', forwardSignal);
  try {
    for (const commandSpec of commands) {
      const id = assertRequired(commandSpec?.id, 'command ID');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
        throw new Error(`command ${id} is invalid`);
      }
      const rawArgv = commandSpec?.argv;
      if (!Array.isArray(rawArgv) || rawArgv.length === 0 || rawArgv.some((arg) => typeof arg !== 'string')) {
        throw new Error(`command ${id} argv is invalid`);
      }
      let argv = rawArgv;
      const dependencies = Array.isArray(commandSpec.dependsOn) ? commandSpec.dependsOn : [];
      if (dependencies.some((dependency) => !steps.some((step) => step.id === dependency))) {
        throw new Error(`command ${id} references an unknown dependency`);
      }
      const failedDependency = dependencies.find((dependency) => steps.find((step) => step.id === dependency)?.result !== 'PASS');
      const started = clock();
      const dockerBlocked = (isDockerCommand(rawArgv) || commandSpec.requiresDocker === true) && !canUseDocker;
      const cancellationBlocked = cancelled;
      let resolutionError = null;
      if (!cancelled && !failedDependency && !dockerBlocked && commandSpec.imageTag && argv.some((arg) => arg.includes('{{IMAGE_ID}}'))) {
        const inspected = await runChild({
          argv: ['docker', 'image', 'inspect', '--format', '{{.Id}}', commandSpec.imageTag],
          cwd,
          environment: childEnv,
          spawnImpl,
          processRunner,
          timeoutMs: commandSpec.timeoutMs ?? MAX_COMMAND_TIMEOUT_MS,
        });
        const imageId = inspected.stdout.trim();
        if (inspected.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/i.test(imageId)) {
          resolutionError = `immutable image inspection failed for ${commandSpec.imageTag}`;
        } else {
          argv = argv.map((arg) => arg.replaceAll('{{IMAGE_ID}}', imageId));
        }
      }
      const blockedReason = cancellationBlocked
        ? 'dispatcher cancelled before command execution'
        : failedDependency
          ? `dependency ${failedDependency} did not pass`
          : commandSpec.blockedReason ?? (
            dockerBlocked
              ? 'Docker command blocked: explicit authorized opt-in is required'
              : null
          );
      const result = blockedReason
        ? {
            exitCode: -2,
            signal: null,
            stdout: '',
            stderr: blockedReason,
            timedOut: false,
          }
        : resolutionError
          ? {
              exitCode: -1,
              signal: null,
              stdout: '',
              stderr: resolutionError,
              timedOut: false,
            }
          : await runChild({
              argv,
              cwd,
              environment: childEnv,
              spawnImpl,
              processRunner,
              timeoutMs: commandSpec.timeoutMs ?? MAX_COMMAND_TIMEOUT_MS,
            });
      const elapsedMs = Math.max(0, Math.round(clock() - started));
      const stdout = redact(result.stdout);
      const stderr = redact(result.stderr);
      const stdoutRef = `${id}.stdout.log`;
      const stderrRef = `${id}.stderr.log`;
      await writeFile(resolve(directory, stdoutRef), stdout, 'utf8');
      await writeFile(resolve(directory, stderrRef), stderr, 'utf8');
      const passed = result.exitCode === 0 && result.signal == null && !result.timedOut;
      const step = {
        id,
        argv: argv.map(redact),
        result: passed ? 'PASS' : blockedReason ? 'BLOCKED' : 'FAIL',
        elapsedMs,
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : -1,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.signal ? { signal: result.signal } : {}),
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(blockedReason ? { blockedReason: redact(blockedReason) } : {}),
        stdoutRef,
        stderrRef,
      };
      steps.push(step);
      if (!passed) {
        diagnostics.push(
          redact(
            `${id} ${blockedReason ? `blocked (${blockedReason})` : `failed (exit=${result.exitCode ?? 'null'}${result.signal ? `, signal=${result.signal}` : ''})`}`,
          ),
        );
      }
    }
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
    process.off('SIGHUP', forwardSignal);
    for (const error of terminationErrors) diagnostics.push(redact(`termination cleanup failed: ${error}`));
  }
  const producer = createProducerEvidence({
    releaseId,
    laneId,
    result: steps.every((step) => step.result === 'PASS') ? 'PASS' : 'FAIL',
    runId,
    runAttempt,
    sourceSha,
    workflowSha,
    artifactName: laneArtifactName(releaseId, laneId),
    steps,
    diagnostics,
    image,
  });
  await writeFile(resolve(directory, 'producer-result.json'), `${JSON.stringify(producer, null, 2)}\n`, 'utf8');
  return producer;
}

function parseArgs(argv) {
  const options = { commandsJson: undefined, commands: undefined, allowDocker: false, preserveDatabaseUrl: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--') {
      options.positional = argv.slice(index + 1);
      break;
    }
    if (item === '--allow-docker') options.allowDocker = true;
    else if (item === '--preserve-database-url') options.preserveDatabaseUrl = true;
    else if (item.startsWith('--')) {
      const [key, inline] = item.split('=', 2);
      const value = inline ?? argv[++index];
      if (value == null) throw new Error(`${key} requires a value`);
      const property = key
        .slice(2)
        .replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
      options[property] = value;
    } else positional.push(item);
  }
  if (positional.length > 0) options.positional = positional;
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const commands = options.commandsJson
    ? JSON.parse(await readFile(resolve(options.commandsJson), 'utf8'))
    : options.positional?.length
      ? [{ id: options.positional[0], argv: options.positional.slice(1) }]
      : undefined;
  const producer = await runDispatcher({
    releaseId: options.releaseId,
    laneId: options.laneId,
    runId: options.runId,
    runAttempt: Number(options.runAttempt),
    sourceSha: options.sourceSha,
    workflowSha: options.workflowSha,
    commands,
    outputDirectory: options.output,
    cwd: options.cwd ?? process.cwd(),
    preserveDatabaseUrl: options.preserveDatabaseUrl,
    allowDocker: options.allowDocker,
    image: options.image ? JSON.parse(options.image) : undefined,
  });
  process.stdout.write(`${producer.result}\n`);
  if (producer.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
