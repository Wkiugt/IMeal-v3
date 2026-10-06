import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDispatcher } from './ci-dispatcher.mjs';
import { MobileProcessError, runOwnedProcess, stopOwnedProcess } from './mobile-process.mjs';
import { redact } from './ci-contracts.mjs';
import { commandCatalogue, yarnArgs } from './checks.mjs';
const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));

async function gitText(args, options = {}) {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024 });
  return stdout;
}

const FINGERPRINT_EXCLUDED = /(?:^|[\\/])(?:node_modules|dist|build|\.turbo|coverage|\.next|\.nuxt|\.output|\.expo|\.superpowers|\.yarn)(?:[\\/]|$)|(?:^|[\\/])\.env(?:\.|$)|(?:^|[\\/])generated(?:[\\/]|$)|\.tsbuildinfo$/i;

async function sourceFingerprint() {
  const head = (await gitText(['rev-parse', 'HEAD'])).trim();
  const status = await gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  const diff = await gitText(['diff', '--binary', 'HEAD']);
  const untracked = (await gitText(['ls-files', '--others', '--exclude-standard', '-z'], { maxBuffer: 16 * 1024 * 1024 })).split('\0').filter(Boolean).sort();
  const rows = [];
  for (const path of untracked) {
    if (FINGERPRINT_EXCLUDED.test(path)) continue;
    try {
      const content = await readFile(join(root, path));
      rows.push(`${path}\t${createHash('sha256').update(content).digest('hex')}`);
    } catch {}
  }
  const uncommittedSha256 = createHash('sha256')
    .update(status)
    .update('\0')
    .update(diff)
    .update('\0')
    .update(rows.join('\n'))
    .digest('hex');
  return { head, uncommittedSha256, fingerprint: createHash('sha256').update(`${head}\0${uncommittedSha256}`).digest('hex'), uncommittedFiles: rows.length };
}

export async function runPrerequisite({ id, argv, output, environment, validate, timeoutMs = 300_000, onSpawn }) {
  const started = performance.now();
  const [command, ...args] = argv;
  let exitCode = -1;
  let stdout = '';
  let stderr = '';
  try {
    const execution = await runOwnedProcess({
      command,
      args,
      cwd: root,
      env: environment,
      timeoutMs,
      onSpawn,
    });
    stdout = execution.diagnostics.stdout;
    stderr = execution.diagnostics.stderr;
    exitCode = execution.result.code === 0 ? 0 : (Number.isInteger(execution.result.code) ? execution.result.code : -1);
  } catch (error) {
    const details = error instanceof MobileProcessError ? (error.details ?? error) : {};
    const result = details.result ?? {};
    const diagnostics = details.diagnostics ?? {};
    stdout = diagnostics.stdout ?? '';
    stderr = diagnostics.stderr || (error instanceof Error ? error.message : String(error));
    exitCode = result.timedOut ? -1 : Number.isInteger(result.code) ? result.code : -1;
    if (details.cleanupError && exitCode === 0) exitCode = -1;
  }
  if (exitCode === 0 && validate && !validate(stdout)) {
    exitCode = 1;
    stderr = `${stderr}\nversion validation failed`;
  }
  const elapsedMs = Math.max(0, Math.round(performance.now() - started));
  await mkdir(join(output, 'prerequisites'), { recursive: true });
  const stdoutRef = join('prerequisites', `${id}.stdout.log`);
  const stderrRef = join('prerequisites', `${id}.stderr.log`);
  await writeFile(join(output, stdoutRef), redact(stdout), 'utf8');
  await writeFile(join(output, stderrRef), redact(stderr), 'utf8');
  return { id, argv: argv.map(redact), cwd: root, result: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, elapsedMs, stdoutRef, stderrRef };
}

function blockedPrerequisite(id, argv, reason) {
  return { id, argv: argv.map(redact), cwd: root, result: 'BLOCKED', exitCode: -2, elapsedMs: 0, blockedReason: reason, stdoutRef: join('prerequisites', `${id}.stdout.log`), stderrRef: join('prerequisites', `${id}.stderr.log`) };
}

function localLaneResult(producer) {
  if (producer.result === 'PASS') return 'PASS';
  if (producer.steps.length > 0 && producer.steps.every((step) => step.result === 'BLOCKED')) return 'BLOCKED';
  return 'FAIL';
}

async function writeBlockedPrerequisite(output, item) {
  await writeFile(join(output, item.stdoutRef), '', 'utf8');
  await writeFile(join(output, item.stderrRef), `${redact(`blocked: ${item.blockedReason}`)}\n`, 'utf8');
}

export async function verifyLocal({ outputDirectory, allowDocker = false, environment = process.env } = {}) {
  const source = await sourceFingerprint();
  const output = resolve(outputDirectory ?? join(root, '.superpowers/sdd/ci-stabilization/local-ci-verify', randomUUID()));
  await mkdir(join(output, 'prerequisites'), { recursive: true });
  const prerequisiteEnvironment = { ...environment };
  delete prerequisiteEnvironment.DATABASE_URL;
  delete prerequisiteEnvironment.GITHUB_TOKEN;
  delete prerequisiteEnvironment.STAGING_ENV_FILE;
  delete prerequisiteEnvironment.STAGING_SMOKE_SESSION_TOKEN;
  const metadata = {
    releaseId: `imeal-local-${source.head}`,
    runId: `local-${source.fingerprint.slice(0, 12)}`,
    runAttempt: 1,
    sourceSha: source.head,
    workflowSha: 'local-ci-verify',
  };
  const activePrerequisites = new Set();
  let cancelled = false;
  const forwardSignal = () => {
    cancelled = true;
    for (const processHandle of activePrerequisites) {
      void stopOwnedProcess(processHandle, { graceMs: 2_000 }).catch(() => {});
    }
  };
  const onPrerequisiteSpawn = (processHandle) => {
    activePrerequisites.add(processHandle);
    processHandle.closed.finally(() => activePrerequisites.delete(processHandle)).catch(() => {});
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);
  process.on('SIGHUP', forwardSignal);
  let prerequisites;
  const yarnVersionArgv = yarnArgs('--version');
  const installArgv = yarnArgs('install', '--immutable');
  try {
    const nodeVersion = await runPrerequisite({
      id: 'node-version',
      argv: [process.execPath, '--version'],
      output,
      environment: prerequisiteEnvironment,
      validate: (stdout) => /^v24\./.test(stdout.trim()),
      onSpawn: onPrerequisiteSpawn,
    });
    const yarnVersion = nodeVersion.result === 'PASS'
      ? await runPrerequisite({
          id: 'yarn-version',
          argv: yarnVersionArgv,
          output,
          environment: prerequisiteEnvironment,
          validate: (stdout) => /^4\.18(?:\.0)?\s*$/.test(stdout.trim()),
          onSpawn: onPrerequisiteSpawn,
        })
      : blockedPrerequisite('yarn-version', yarnVersionArgv, 'prerequisite node-version failed');
    if (yarnVersion.result === 'BLOCKED') await writeBlockedPrerequisite(output, yarnVersion);
    const install = yarnVersion.result === 'PASS'
      ? await runPrerequisite({
          id: 'install-immutable',
          argv: installArgv,
          output,
          environment: prerequisiteEnvironment,
          onSpawn: onPrerequisiteSpawn,
        })
      : blockedPrerequisite('install-immutable', installArgv, `prerequisite ${yarnVersion.id} failed`);
    if (install.result === 'BLOCKED') await writeBlockedPrerequisite(output, install);
    prerequisites = [nodeVersion, yarnVersion, install];
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
    process.off('SIGHUP', forwardSignal);
  }
  const prerequisiteFailure = prerequisites.find((item) => item.result !== 'PASS');
  const laneDefinitions = [
    ['static', commandCatalogue({ lane: 'static', outputDirectory: join(output, 'static') })],
    ['suites', commandCatalogue({ lane: 'suites', outputDirectory: join(output, 'suites') })],
    ['mobile-export', commandCatalogue({ lane: 'mobile-export', outputDirectory: join(output, 'mobile-export') })],
    ['mobile-smoke', commandCatalogue({ lane: 'mobile-smoke', outputDirectory: join(output, 'mobile-smoke') })],
    ['db', commandCatalogue({ lane: 'db', outputDirectory: join(output, 'db') }).map((command) => ({ ...command, blockedReason: 'disposable PostgreSQL is not available in local default mode' }))],
    ['tooling', commandCatalogue({ lane: 'tooling', outputDirectory: join(output, 'tooling') })],
    ['security-audit', commandCatalogue({ lane: 'security-audit', outputDirectory: join(output, 'security-audit') })],
    ['security-secrets', commandCatalogue({ lane: 'security-secrets', outputDirectory: join(output, 'security-secrets') })],
    ['images-api', commandCatalogue({ lane: 'images-api', outputDirectory: join(output, 'images-api') })],
    ['images-worker', commandCatalogue({ lane: 'images-worker', outputDirectory: join(output, 'images-worker') })],
    ['images-admin-web', commandCatalogue({ lane: 'images-admin-web', outputDirectory: join(output, 'images-admin-web') })],
  ];
  const blockedLanes = new Set(['static', 'suites', 'mobile-export', 'mobile-smoke', 'db', 'security-audit']);
  const reports = [];
  for (const [laneId, commands] of laneDefinitions) {
    const blockedReason = cancelled
      ? 'local verification cancelled'
      : prerequisiteFailure && blockedLanes.has(laneId)
        ? `prerequisite ${prerequisiteFailure.id} failed`
        : null;
    const effectiveCommands = blockedReason
      ? commands.map((command) => ({ ...command, blockedReason }))
      : commands;
    const producer = await runDispatcher({
      ...metadata,
      laneId,
      commands: effectiveCommands,
      outputDirectory: join(output, laneId),
      cwd: root,
      environment: { ...prerequisiteEnvironment, ...(allowDocker ? { CI_DOCKER_AUTHORIZED: 'true', CI_DOCKER_LOCAL_AUTHORIZED: 'true' } : {}) },
      allowDocker,
    });
    reports.push({ laneId, result: localLaneResult(producer), producerResult: producer.result, steps: producer.steps, diagnostics: producer.diagnostics, outputDirectory: join(output, laneId) });
  }
  const report = {
    type: 'imeal-local-ci-verify',
    result: prerequisites.every((item) => item.result === 'PASS') && reports.every((item) => item.result === 'PASS') ? 'PASS' : 'FAIL',
    docker: allowDocker ? 'explicit opt-in' : 'not launched',
    databaseUrlInherited: false,
    sourceSha: source.head,
    sourceFingerprint: source,
    outputDirectory: output,
    prerequisites,
    lanes: reports,
  };
  await writeFile(join(output, 'ci-verify.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const allowDocker = process.argv.includes('--allow-docker');
  verifyLocal({ allowDocker }).then((report) => {
    process.stdout.write(`${report.result}; Docker=${report.docker}; report=${report.outputDirectory}\n`);
    if (report.result !== 'PASS') process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

