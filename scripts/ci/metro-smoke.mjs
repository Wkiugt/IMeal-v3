import { appendFile, mkdtemp } from 'node:fs/promises';
import { isIP } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMobileBuild, resolvedProjectMetadata } from './mobile-export.mjs';
import { spawnOwnedProcess, stopOwnedProcess } from './mobile-process.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, '../..');
export const mobileRoot = join(repositoryRoot, 'apps', 'mobile');
const yarnCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const STARTUP_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function childEnvironment() {
  const blocked = /(TOKEN|SECRET|PASSWORD|PRIVATE|COOKIE|AUTH|CREDENTIAL|KEY)/i;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !blocked.test(name)),
  );
  delete environment.NPM_CONFIG_USERCONFIG;
  delete environment.YARN_NPM_AUTH_TOKEN;
  environment.CI = 'true';
  return environment;
}

function originForHost(host, port) {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

function listen(host, port) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    const onError = (error) => {
      server.removeAllListeners();
      reject(error);
    };
    server.once('error', onError);
    server.listen({ host, port }, () => {
      server.removeListener('error', onError);
      const address = server.address();
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolvePromise(typeof address === 'object' && address ? address.port : port);
      });
    });
  });
}

async function canListen(host, port) {
  try {
    await listen(host, port);
    return true;
  } catch (error) {
    if (['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error?.code)) return false;
    if (error?.code === 'EADDRINUSE') {
      throw fail(`Loopback port is occupied on ${host}:${port}`, { cause: error });
    }
    throw error;
  }
}

export async function preflightPort(port) {
  const hosts = ['::1', '127.0.0.1'];
  const availableHosts = [];
  for (const host of hosts) {
    if (await canListen(host, port)) availableHosts.push(host);
  }
  if (availableHosts.length === 0) {
    throw fail(`No loopback address family is available for port ${port}`);
  }
  return availableHosts;
}

export async function chooseLoopbackEndpoint(requestedPort) {
  if (requestedPort !== undefined) {
    const hosts = await preflightPort(requestedPort);
    return { port: requestedPort, hosts };
  }
  for (const host of ['::1', '127.0.0.1']) {
    try {
      const port = await listen(host, 0);
      const hosts = await preflightPort(port);
      return { port, hosts };
    } catch (error) {
      if (error?.code === 'EADDRNOTAVAIL' || error?.code === 'EAFNOSUPPORT') continue;
      if (error?.message?.startsWith('Loopback port is occupied')) continue;
      throw error;
    }
  }
  throw fail('Unable to reserve a loopback port');
}

export async function fetchTextWithTimeout(
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  processHandle,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const request = (async () => {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return { response, body };
  })();
  const processExit = processHandle?.exited.then((exitResult) => {
    controller.abort();
    throw fail(`Metro exited during request (code ${exitResult.code ?? 'unknown'})`, {
      exitResult,
    });
  });
  try {
    return await Promise.race(processExit ? [request, processExit] : [request]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProjectRoot(value) {
  try {
    return decodeURIComponent(value ?? '');
  } catch {
    return value ?? '';
  }
}

function assertProjectIdentity(response, expectedRoot) {
  const headerRoot = normalizeProjectRoot(response.headers.get('x-react-native-project-root'));
  const actual = process.platform === 'win32' ? headerRoot.toLowerCase() : headerRoot;
  const expected = process.platform === 'win32' ? expectedRoot.toLowerCase() : expectedRoot;
  if (actual !== expected) {
    throw fail(`Metro project identity mismatch: expected ${expectedRoot}, got ${headerRoot}`);
  }
}

export async function probeStatus(origin, expectedRoot, timeoutMs, processHandle) {
  let response;
  let body;
  try {
    ({ response, body } = await fetchTextWithTimeout(
      `${origin}/status`,
      { headers: { Accept: 'text/plain' } },
      timeoutMs,
      processHandle,
    ));
  } catch (error) {
    if (error?.message?.startsWith('Metro exited during request')) throw error;
    return { reachable: false, error };
  }
  if (response.status !== 200) {
    throw fail(
      `Unexpected Metro status response ${response.status} from ${origin}: ${body.slice(0, 200)}`,
    );
  }
  assertProjectIdentity(response, expectedRoot);
  if (body !== 'packager-status:running') {
    throw fail(`Unexpected Metro status body from ${origin}: ${body.slice(0, 200)}`);
  }
  return { reachable: true, body };
}

async function waitForReadiness(processHandle, origins, expectedRoot, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (processHandle.exitResult) {
      throw fail(
        `Metro exited before readiness (code ${processHandle.exitResult.code ?? 'unknown'})`,
        { exitResult: processHandle.exitResult, diagnostics: processHandle.getLogs() },
      );
    }
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    for (const origin of origins) {
      const result = await probeStatus(
        origin,
        expectedRoot,
        Math.min(5_000, remainingMs),
        processHandle,
      );
      if (result.reachable) {
        return { origin, readinessMs: Date.now() - startedAt };
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw fail(`Metro readiness timed out after ${timeoutMs}ms`, {
    diagnostics: processHandle.getLogs(),
  });
}

export function assertJavascriptResponse(response, body, label) {
  if (!response.ok) {
    throw fail(`${label} HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('javascript')) {
    throw fail(`${label} has unrecognized JavaScript content type: ${contentType || 'missing'}`);
  }
  if (!body.trim()) {
    throw fail(`${label} returned an empty body`);
  }
  const trimmedBody = body.trimStart();
  if (/^(?:<\s*!doctype\b|<\s*\/?\s*(?:html|head|body|script)\b)/i.test(trimmedBody)) {
    throw fail(
      `${label} returned HTML instead of JavaScript: ${body.slice(0, 240)}`,
    );
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      throw fail(`${label} returned a JSON object/array instead of JavaScript`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('returned a JSON object/array')) {
      throw error;
    }
  }
}

async function requestBundle(url, label, processHandle) {
  const { response, body } = await fetchTextWithTimeout(
    url,
    { headers: { Accept: 'application/javascript' } },
    REQUEST_TIMEOUT_MS,
    processHandle,
  );
  assertJavascriptResponse(response, body, label);
  return {
    url,
    status: response.status,
    contentType: response.headers.get('content-type'),
    bytes: Buffer.byteLength(body, 'utf8'),
  };
}

function assertSameOrigin(url, origin, label, allowRelative = false) {
  let parsed;
  try {
    parsed = new URL(url, origin);
  } catch (error) {
    throw fail(`${label} URL is invalid: ${url}`, { cause: error });
  }
  if (!allowRelative && !/^[a-z][a-z\d+.-]*:/i.test(String(url))) {
    throw fail(`${label} URL must be absolute: ${url}`);
  }
  if (parsed.origin !== origin) {
    throw fail(`${label} URL has wrong origin: expected ${origin}, got ${parsed.origin}`);
  }
  return parsed;
}

async function requestNativeBundle(origin, platform, projectInfo, processHandle) {
  const { response, body } = await fetchTextWithTimeout(
    `${origin}/manifest?platform=${platform}`,
    {
      headers: { Accept: 'application/json', 'expo-platform': platform },
    },
    REQUEST_TIMEOUT_MS,
    processHandle,
  );
  if (!response.ok) {
    throw fail(`${platform} manifest HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(body);
  } catch (error) {
    throw fail(`${platform} manifest was not JSON`, { cause: error });
  }
  const expoClient = manifest?.extra?.expoClient;
  if (expoClient?.name !== projectInfo.name || expoClient?.slug !== projectInfo.slug) {
    throw fail(`${platform} manifest project identity mismatch`);
  }
  if (normalizeProjectRoot(expoClient?.hostUri) === '') {
    throw fail(`${platform} manifest has no host identity`);
  }
  const bundleUrl = assertSameOrigin(manifest?.launchAsset?.url, origin, `${platform} bundle`);
  return {
    manifestStatus: response.status,
    ...(await requestBundle(bundleUrl.href, `${platform} bundle`, processHandle)),
  };
}

async function requestWebBundle(origin, projectInfo, processHandle) {
  const { response, body: html } = await fetchTextWithTimeout(
    `${origin}/`,
    {
      headers: { Accept: 'text/html', 'expo-platform': 'web' },
    },
    REQUEST_TIMEOUT_MS,
    processHandle,
  );
  if (!response.ok) throw fail(`web index HTTP ${response.status}: ${html.slice(0, 240)}`);
  if (!html.includes(projectInfo.name)) throw fail('web index project identity is missing');
  const match = html.match(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  if (!match) throw fail('web index has no generated bundle URL');
  const bundleUrl = assertSameOrigin(match[1] ?? match[2] ?? match[3], origin, 'web bundle', true);
  return requestBundle(bundleUrl.href, 'web bundle', processHandle);
}

async function writeDiagnostics(logPath, processHandle, details) {
  if (!logPath) return;
  await appendFile(
    logPath,
    `\n--- mobile smoke diagnostics ---\n${JSON.stringify(
      { ...details, logs: processHandle.getLogs(), exitResult: processHandle.exitResult },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw fail(`${label} must be a positive integer`);
  }
}

export async function smokeMobile({
  root = repositoryRoot,
  port,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  logPath,
  runner = spawnOwnedProcess,
  prepare = prepareMobileBuild,
} = {}) {
  assertPositiveInteger(startupTimeoutMs, 'startup timeout');
  if (port !== undefined) assertPositiveInteger(port, 'port');
  const resolvedRoot = resolve(root);
  const projectRoot = join(resolvedRoot, 'apps', 'mobile');
  const actualLogPath =
    logPath ??
    join(tmpdir(), `imeal-mobile-smoke-${process.pid}-${Date.now()}.log`);
  const projectInfo = await resolvedProjectMetadata(projectRoot);
  const preparation = await prepare({
    root: resolvedRoot,
    logPath: actualLogPath,
  });
  if (preparation?.result?.code !== 0) {
    throw fail(`Shared mobile build preparation did not exit successfully (code ${preparation?.result?.code})`);
  }
  const endpoint = await chooseLoopbackEndpoint(port);
  const origins = endpoint.hosts.map((host) => originForHost(host, endpoint.port));
  const processHandle = runner({
    command: yarnCommand,
    args: [
      'yarn',
      'workspace',
      '@imeal/mobile',
      'exec',
      'expo',
      'start',
      '--clear',
      '--localhost',
      '--port',
      String(endpoint.port),
    ],
    cwd: projectRoot,
    env: childEnvironment(),
    logPath: actualLogPath,
    detached: process.platform !== 'win32',
  });
  let failure;
  try {
    const readiness = await waitForReadiness(processHandle, origins, projectRoot, startupTimeoutMs);
    const bundles = {
      android: await requestNativeBundle(readiness.origin, 'android', projectInfo, processHandle),
      ios: await requestNativeBundle(readiness.origin, 'ios', projectInfo, processHandle),
      web: await requestWebBundle(readiness.origin, projectInfo, processHandle),
    };
    const hostname = new URL(readiness.origin).hostname.replace(/^\[|\]$/g, '');
    return {
      result: 'PASS',
      origin: readiness.origin,
      addressFamily: isIP(hostname),
      port: endpoint.port,
      readinessMs: readiness.readinessMs,
      bundles,
      logPath: actualLogPath,
      project: projectInfo,
    };
  } catch (error) {
    failure = error;
    error.logPath = actualLogPath;
    error.diagnostics = processHandle.getLogs();
    await writeDiagnostics(actualLogPath, processHandle, {
      error: error.message,
      originCandidates: origins,
    });
    throw error;
  } finally {
    try {
      await stopOwnedProcess(processHandle);
    } catch (cleanupError) {
      if (failure) failure.cleanupError = cleanupError;
      else throw cleanupError;
    }
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--timeout-ms') options.startupTimeoutMs = Number(argv[++index]);
    else if (arg === '--log') options.logPath = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const report = await smokeMobile(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function failureExitCode(error) {
  const code =
    error?.result?.code ??
    error?.exitResult?.code ??
    error?.cause?.result?.code ??
    error?.cleanupError?.result?.code;
  return Number.isInteger(code) && code > 0 && code < 256 ? code : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = failureExitCode(error);
  });
}
