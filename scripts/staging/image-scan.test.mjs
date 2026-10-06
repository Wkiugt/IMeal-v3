import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runImageScan, selectProtectedImage } from './image-scan.mjs';

const digest = 'a'.repeat(64);
const protectedImages = {
  api: `registry.example/imeal/api@sha256:${digest}`,
  worker: `registry.example/imeal/worker@sha256:${'b'.repeat(64)}`,
  adminWeb: `registry.example/imeal/admin-web@sha256:${'c'.repeat(64)}`,
};
const fixtureDirectories = new Set();
test.after(async () => {
  await Promise.all(
    [...fixtureDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function scanPaths() {
  const directory = await mkdtemp(join(tmpdir(), 'imeal-image-scan-'));
  fixtureDirectories.add(directory);
  return {
    cacheDirectory: join(directory, 'cache'),
    archivePath: join(directory, 'image.tar'),
    reportPath: join(directory, 'scan-report.json'),
  };
}

function mockedDockerBoundary({
  image,
  hostAuthenticationRequired = false,
  hostAuthenticated = false,
  failureStage,
  failureStderr = 'scanner failed',
  throwAt,
}) {
  const calls = [];
  const commandRunner = async (commandName, args, options) => {
    calls.push({ command: commandName, args, options });
    if (throwAt === calls.length) {
      throw new Error(`${failureStage ?? 'scanner'} unavailable`);
    }
    if (args[0] === 'pull') {
      assert.equal(args[1], image);
      if (failureStage === 'pull') {
        return { stdout: '', stderr: failureStderr, exitCode: 1 };
      }
      if (hostAuthenticationRequired && !hostAuthenticated) {
        return {
          stdout: '',
          stderr: 'unauthorized: host registry authentication required',
          exitCode: 1,
        };
      }
      return { stdout: `pulled ${image}`, stderr: '', exitCode: 0 };
    }
    if (args[0] === 'save') {
      assert.equal(args.at(-1), image);
      const archivePath = args[args.indexOf('--output') + 1];
      await writeFile(archivePath, `mock-docker-archive\nimage=${image}\n`);
      if (failureStage === 'save') {
        return { stdout: '', stderr: failureStderr, exitCode: 1 };
      }
      return { stdout: `saved ${image}`, stderr: '', exitCode: 0 };
    }
    assert.equal(args[0], 'run');
    const scannerCommand = command({ command: commandName, args });
    const archiveMount = args.find((value) =>
      value.endsWith(':/scan/image.tar:ro'),
    );
    assert.ok(archiveMount, 'scanner must receive an archive mount');
    const archivePath = archiveMount.slice(0, -':/scan/image.tar:ro'.length);
    assert.equal(
      await readFile(archivePath, 'utf8'),
      `mock-docker-archive\nimage=${image}\n`,
    );
    assert.doesNotMatch(
      scannerCommand.join('\u0000'),
      /docker\.sock|DOCKER_AUTH|password|token|secret/i,
    );
    assert.equal(options.shell, false);
    if (failureStage === 'policy') {
      return { stdout: failureStderr, stderr: 'scanner stderr', exitCode: 1 };
    }
    return { stdout: 'mock scanner completed', stderr: '', exitCode: 0 };
  };
  return { calls, commandRunner };
}

function command(call) {
  return [call.command, ...call.args];
}

test('selects only immutable API, worker and Admin Web protected image mappings', () => {
  assert.equal(
    selectProtectedImage(protectedImages, 'api'),
    protectedImages.api,
  );
  assert.equal(
    selectProtectedImage(protectedImages, 'worker'),
    protectedImages.worker,
  );
  assert.equal(
    selectProtectedImage(protectedImages, 'admin-web'),
    protectedImages.adminWeb,
  );
  assert.throws(
    () => selectProtectedImage({ ...protectedImages, extra: 'value' }, 'api'),
    /unsupported fields/i,
  );
  assert.throws(
    () =>
      selectProtectedImage(
        { ...protectedImages, api: 'registry/imeal/api:latest' },
        'api',
      ),
    /immutable/i,
  );
});

test('[mocked Docker boundary] host auth acquires exact images and scanner reads materialized archive without auth', async () => {
  const publicImage = `imeal/api@sha256:${digest}`;
  const publicPaths = await scanPaths();
  const publicRun = mockedDockerBoundary({ image: publicImage });
  await runImageScan({
    image: publicImage,
    trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
    ...publicPaths,
    commandRunner: publicRun.commandRunner,
  });

  const privateImage = protectedImages.api;
  const privateNoAuthPaths = await scanPaths();
  const privateNoAuth = mockedDockerBoundary({
    image: privateImage,
    hostAuthenticationRequired: true,
  });
  await assert.rejects(
    runImageScan({
      image: privateImage,
      trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
      ...privateNoAuthPaths,
      commandRunner: privateNoAuth.commandRunner,
    }),
    /docker pull failed/i,
  );
  assert.equal(privateNoAuth.calls.length, 1);

  const privateAuthPaths = await scanPaths();
  const privateAuth = mockedDockerBoundary({
    image: privateImage,
    hostAuthenticationRequired: true,
    hostAuthenticated: true,
  });
  await runImageScan({
    image: privateImage,
    trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
    ...privateAuthPaths,
    commandRunner: privateAuth.commandRunner,
  });

  for (const [calls, paths, image] of [
    [publicRun.calls, publicPaths, publicImage],
    [privateAuth.calls, privateAuthPaths, privateImage],
  ]) {
    assert.deepEqual(calls[0].args, ['pull', image]);
    assert.deepEqual(calls[1].args, [
      'save',
      '--output',
      paths.archivePath,
      image,
    ]);
    const scannerCommand = command(calls[2]);
    assert.equal(calls[2].command, 'docker');
    assert.ok(scannerCommand.includes('--pull=always'));
    assert.ok(scannerCommand.includes('--input'));
    assert.ok(scannerCommand.includes('/scan/image.tar'));
    assert.ok(
      scannerCommand.includes(`${paths.archivePath}:/scan/image.tar:ro`),
    );
    assert.ok(
      scannerCommand.includes(`${paths.cacheDirectory}:/root/.cache/trivy`),
    );
    assert.ok(scannerCommand.includes('--severity'));
    assert.ok(scannerCommand.includes('HIGH,CRITICAL'));
    assert.ok(scannerCommand.includes('--ignore-unfixed'));
    assert.doesNotMatch(
      scannerCommand.join('\u0000'),
      /docker\.sock|DOCKER_AUTH|password|token|secret/i,
    );
    assert.equal(calls[2].options.shell, false);
    await assert.rejects(readFile(paths.archivePath), /ENOENT/);
  }
});

test('[mocked Docker boundary] acquisition failure is redacted and skips save and scanner', async () => {
  const paths = await scanPaths();
  const { calls, commandRunner } = mockedDockerBoundary({
    image: protectedImages.api,
    failureStage: 'pull',
    failureStderr: 'denied: password=super-secret',
  });
  await assert.rejects(
    runImageScan({
      image: protectedImages.api,
      trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
      ...paths,
      commandRunner,
    }),
    /docker pull failed/i,
  );
  assert.equal(calls.length, 1);
  const report = await readFile(paths.reportPath, 'utf8');
  assert.match(report, /"result": "FAIL"/);
  assert.doesNotMatch(report, /super-secret|password=super-secret/i);
});

test('[mocked Docker boundary] save failure cleans a partial archive and preserves failure', async () => {
  const paths = await scanPaths();
  const { calls, commandRunner } = mockedDockerBoundary({
    image: protectedImages.worker,
    hostAuthenticated: true,
    failureStage: 'save',
    failureStderr: 'docker save failed',
  });
  await assert.rejects(
    runImageScan({
      image: protectedImages.worker,
      trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
      ...paths,
      commandRunner,
    }),
    /docker save failed/i,
  );
  assert.equal(calls.length, 2);
  assert.match(await readFile(paths.reportPath, 'utf8'), /docker save failed/);
  await assert.rejects(readFile(paths.archivePath), /ENOENT/);
});

test('[mocked Docker boundary] scanner startup failure cleans the archive and preserves failure', async () => {
  const paths = await scanPaths();
  const { calls, commandRunner } = mockedDockerBoundary({
    image: protectedImages.worker,
    hostAuthenticated: true,
    throwAt: 3,
  });
  await assert.rejects(
    runImageScan({
      image: protectedImages.worker,
      trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
      ...paths,
      commandRunner,
    }),
    /Trivy scan could not start/i,
  );
  assert.equal(calls.length, 3);
  await assert.rejects(readFile(paths.archivePath), /ENOENT/);
});

test('[mocked Trivy policy] nonzero scanner exit propagates after archive cleanup', async () => {
  const paths = await scanPaths();
  const { calls, commandRunner } = mockedDockerBoundary({
    image: protectedImages.worker,
    hostAuthenticated: true,
    failureStage: 'policy',
    failureStderr: 'HIGH vulnerability found',
  });
  await assert.rejects(
    runImageScan({
      image: protectedImages.worker,
      trivyImage: 'aquasec/trivy@sha256:' + 'd'.repeat(64),
      ...paths,
      commandRunner,
    }),
    /Trivy scan failed/i,
  );
  assert.equal(calls.length, 3);
  const scannerArgs = calls[2].args;
  assert.equal(scannerArgs[scannerArgs.indexOf('--exit-code') + 1], '1');
  assert.equal(
    scannerArgs[scannerArgs.indexOf('--severity') + 1],
    'HIGH,CRITICAL',
  );
  assert.ok(scannerArgs.includes('--ignore-unfixed'));
  const report = await readFile(paths.reportPath, 'utf8');
  assert.match(report, /"result": "FAIL"/);
  assert.match(report, /HIGH vulnerability found/);
  await assert.rejects(readFile(paths.archivePath), /ENOENT/);
});
