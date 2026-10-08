import childProcess from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';

import { assertNoSecrets, safeDiagnostic } from './staging-lib.mjs';

const IMAGE_DIGEST_PATTERN = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;
const IMAGE_KEYS = Object.freeze(['adminWeb', 'api', 'worker']);
const SERVICE_KEYS = Object.freeze({
  api: 'api',
  worker: 'worker',
  'admin-web': 'adminWeb',
});
const MAX_DIAGNOSTIC_LENGTH = 4000;

export function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(command, args, {
      ...options,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) =>
      resolvePromise({ stdout, stderr, exitCode }),
    );
  });
}

function assertImmutableImage(value, label) {
  if (typeof value !== 'string' || !IMAGE_DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be an immutable image digest`);
  }
  return value;
}

function assertPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function selectProtectedImage(images, service) {
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new Error('protected image digest input must be an object');
  }
  if (Object.keys(images).sort().join(',') !== IMAGE_KEYS.join(',')) {
    throw new Error('protected image digest input has unsupported fields');
  }
  const key = SERVICE_KEYS[service];
  if (!key) throw new Error(`unsupported image service: ${service}`);
  return assertImmutableImage(images[key], `protected ${service} image`);
}

function shortDiagnostic(value) {
  const diagnostic = safeDiagnostic(value).trim();
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
}

async function invoke(commandRunner, command, args, label) {
  let result;
  try {
    result = await commandRunner(command, args, { shell: false });
  } catch (error) {
    throw new Error(`${label} could not start: ${shortDiagnostic(error)}`);
  }
  if (!result || result.exitCode !== 0) {
    const diagnostics =
      [result?.stdout, result?.stderr].filter(Boolean).join('\n') ||
      'no diagnostics';
    throw new Error(
      `${label} failed with exit code ${result?.exitCode ?? 'unknown'}: ${shortDiagnostic(diagnostics)}`,
    );
  }
  return result;
}

async function writeReport(reportPath, report) {
  const safeReport = {
    ...report,
    reason: report.reason ? shortDiagnostic(report.reason) : undefined,
  };
  assertNoSecrets(safeReport);
  await writeFile(reportPath, `${JSON.stringify(safeReport, null, 2)}\n`, {
    encoding: 'utf8',
  });
}

export async function runImageScan({
  image,
  trivyImage,
  cacheDirectory,
  archivePath,
  reportPath,
  commandRunner = defaultCommandRunner,
}) {
  assertImmutableImage(image, 'image');
  assertImmutableImage(trivyImage, 'Trivy image');
  assertPath(cacheDirectory, 'Trivy cache directory');
  assertPath(archivePath, 'image archive path');
  assertPath(reportPath, 'scan report path');

  const stages = [];
  let failure;
  try {
    await mkdir(cacheDirectory, { recursive: true });
    stages.push('cache-ready');
    // Host Docker uses its existing registry credential config; missing acquisition/auth blocks.
    // Only the saved image archive crosses the scanner boundary—never credentials or a socket.
    await invoke(commandRunner, 'docker', ['pull', image], 'docker pull');
    stages.push('host-pull');
    await invoke(
      commandRunner,
      'docker',
      ['save', '--output', archivePath, image],
      'docker save',
    );
    stages.push('host-save');
    await invoke(
      commandRunner,
      'docker',
      [
        'run',
        '--rm',
        '--pull=always',
        '--volume',
        `${archivePath}:/scan/image.tar:ro`,
        '--volume',
        `${cacheDirectory}:/root/.cache/trivy`,
        trivyImage,
        'image',
        '--input',
        '/scan/image.tar',
        '--timeout',
        '15m',
        '--exit-code',
        '1',
        '--severity',
        'HIGH,CRITICAL',
        '--ignore-unfixed',
      ],
      'Trivy scan',
    );
    stages.push('trivy-scan');
  } catch (error) {
    failure = error;
  }

  try {
    await rm(archivePath, { force: true });
    stages.push('archive-cleanup');
  } catch (error) {
    const cleanupError = new Error(
      `image archive cleanup failed: ${shortDiagnostic(error)}`,
    );
    failure = failure
      ? new Error(`${failure.message}; ${cleanupError.message}`)
      : cleanupError;
  }

  await writeReport(reportPath, {
    result: failure ? 'FAIL' : 'PASS',
    image,
    source: 'docker-save-archive',
    stages,
    ...(failure ? { reason: failure.message } : {}),
  });
  if (failure) throw failure;
  return { image, source: 'docker-save-archive', stages };
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--'))
      throw new Error('unexpected image scan argument');
    const name = argument.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`image scan option requires a value: --${name}`);
    }
    values[name] = value;
  }
  for (const name of ['trivy-image', 'cache-directory', 'archive', 'report']) {
    if (!values[name]) throw new Error(`missing image scan option: --${name}`);
  }
  const hasDirectImage = Boolean(values.image);
  const hasMapping = Boolean(values['images-json']) || Boolean(values.service);
  if (hasDirectImage === hasMapping) {
    throw new Error(
      'provide either --image or both --images-json and --service',
    );
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCli(argv);
  const image = values.image
    ? values.image
    : selectProtectedImage(
        JSON.parse(await readFile(values['images-json'], 'utf8')),
        values.service,
      );
  await runImageScan({
    image,
    trivyImage: values['trivy-image'],
    cacheDirectory: values['cache-directory'],
    archivePath: values.archive,
    reportPath: values.report,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${shortDiagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
