import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertJavascriptResponse,
  fetchTextWithTimeout,
  preflightPort,
  probeStatus,
  repositoryRoot,
  smokeMobile,
} from './metro-smoke.mjs';
import { spawnOwnedProcess } from './mobile-process.mjs';

function listenServer(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0 }, () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function fixturePrepare({ cwd }) {
  const processHandle = spawnOwnedProcess({
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    cwd,
    detached: true,
  });
  return { result: await processHandle.waitForExit(2_000) };
}
function withCleanupFailure(runner) {
  return (options) => {
    const processHandle = runner(options);
    const flushLogs = processHandle.flushLogs.bind(processHandle);
    processHandle.flushLogs = async () => {
      await flushLogs();
      throw new Error('injected owned cleanup failure');
    };
    return processHandle;
  };
}

test('preflight refuses a loopback port occupied by another owner', async () => {
  const server = net.createServer();
  const port = await listenServer(server);
  try {
    await assert.rejects(preflightPort(port), /occupied/);
  } finally {
    await closeServer(server);
  }
});

test('rejects invalid Metro identity and readiness body', async () => {
  let mode = 'identity';
  const server = http.createServer((request, response) => {
    response.setHeader(
      'X-React-Native-Project-Root',
      mode === 'identity' ? 'wrong-root' : repositoryRoot,
    );
    response.end(
      mode === 'identity'
        ? 'packager-status:running'
        : 'packager-status:waiting',
    );
  });
  const port = await listenServer(server);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await assert.rejects(
      probeStatus(origin, repositoryRoot, 1_000),
      /identity mismatch/,
    );
    mode = 'body';
    await assert.rejects(
      probeStatus(origin, repositoryRoot, 1_000),
      /status body/,
    );
  } finally {
    await closeServer(server);
  }
});

test('rejects HTTP errors, empty, HTML, and JSON bundle responses', () => {
  const cases = [
    [new Response('failure', { status: 500, headers: { 'content-type': 'text/plain' } }), 'failure', /HTTP 500/],
    [new Response('', { headers: { 'content-type': 'application/javascript' } }), '', /empty body/],
    [new Response('<html></html>', { headers: { 'content-type': 'application/javascript' } }), '<html></html>', /HTML/],
    [new Response('{"ok":true}', { headers: { 'content-type': 'application/javascript' } }), '{"ok":true}', /JSON/],
  ];
  for (const [response, body, expected] of cases) {
    assert.throws(() => assertJavascriptResponse(response, body, 'bundle'), expected);
  }
});

test('bounds hanging status and bundle response bodies', async () => {
  const server = http.createServer(() => {});
  const port = await listenServer(server);
  try {
    for (const path of ['/status', '/bundle.js']) {
      await assert.rejects(
        fetchTextWithTimeout(`http://127.0.0.1:${port}${path}`, {}, 100),
        /abort/i,
      );
    }
  } finally {
    await closeServer(server);
  }
});

test('smoke obtains actual native manifest and web bundle URLs, then cleans up and reports cleanup failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-mobile-smoke-fixture-'));
  const fixturePath = join(directory, 'fixture.mjs');
  await writeFile(
    fixturePath,
    `import http from 'node:http';
const port = Number(process.argv[2]);
const root = process.argv[3];
const server = http.createServer((request, response) => {
  const host = request.headers.host;
  const origin = 'http://' + host;
  response.setHeader('X-React-Native-Project-Root', encodeURI(root));
  if (request.url === '/status') {
    response.end('packager-status:running');
    return;
  }
  if (request.url.startsWith('/manifest?platform=')) {
    const platform = new URL(request.url, origin).searchParams.get('platform');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ extra: { expoClient: { name: 'IMealMobile', slug: 'imeal-mobile', hostUri: origin } }, launchAsset: { url: origin + '/bundle-' + platform + '.js' } }));
    return;
  }
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><head><title>IMealMobile</title></head><body><script src="/bundle-web.js"></script></body></html>');
    return;
  }
  response.setHeader('content-type', 'application/javascript');
  response.end('globalThis.__imealFixture = true;');
});
server.listen({ host: '127.0.0.1', port });
`,
  );
  const runner = ({ args, ...options }) =>
    spawnOwnedProcess({
      ...options,
      command: process.execPath,
      args: [fixturePath, args.at(-1), join(repositoryRoot, 'apps', 'mobile')],
      detached: process.platform !== 'win32',
    });
  try {
    const report = await smokeMobile({
      root: repositoryRoot,
      startupTimeoutMs: 5_000,
      runner,
      prepare: fixturePrepare,
    });
    assert.equal(report.result, 'PASS');
    assert.match(report.bundles.android.url, /bundle-android\.js$/);
    assert.match(report.bundles.ios.url, /bundle-ios\.js$/);
    assert.match(report.bundles.web.url, /bundle-web\.js$/);
    assert.ok((await preflightPort(report.port)).length > 0);
    let cleanupPort;
    const failingRunner = withCleanupFailure((options) => {
      cleanupPort = Number(options.args.at(-1));
      return runner(options);
    });
    await assert.rejects(
      smokeMobile({
        root: repositoryRoot,
        startupTimeoutMs: 5_000,
        runner: failingRunner,
        prepare: fixturePrepare,
      }),
      /injected owned cleanup failure/,
    );
    assert.ok((await preflightPort(cleanupPort)).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('smoke reports early child exit before readiness and preserves it across cleanup failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-mobile-smoke-exit-'));
  const fixturePath = join(directory, 'exit.mjs');
  await writeFile(fixturePath, 'process.stderr.write("fixture failed\\n"); process.exit(23);');
  const runner = ({ ...options }) =>
    spawnOwnedProcess({
      ...options,
      command: process.execPath,
      args: [fixturePath],
      detached: process.platform !== 'win32',
    });
  try {
    const failingRunner = withCleanupFailure(runner);
    await assert.rejects(
      smokeMobile({
        root: repositoryRoot,
        startupTimeoutMs: 1_000,
        runner: failingRunner,
        prepare: fixturePrepare,
      }),
      (error) => {
        assert.match(error.message, /exited before readiness/);
        assert.equal(error.exitResult?.code, 23);
        assert.match(error.cleanupError?.message ?? '', /injected owned cleanup failure/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
