import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const composeText = ['docker-compose.yml', 'docker-compose.production.yml']
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
const requiredNames = [
  ...new Set(
    [...composeText.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(
      ([, name]) => name,
    ),
  ),
];
const secretNames = new Set([
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'QR_SIGNING_SECRET',
  'OTP_HASH_SECRET',
  'OTP_DELIVERY_ENCRYPTION_KEY',
  'SESSION_HASH_SECRET',
  'OTP_PROVIDER_API_KEY',
]);

function testValues() {
  const values = Object.fromEntries(
    requiredNames.map((name) => {
      if (name.endsWith('_IMAGE')) {
        return [
          name,
          `registry.example/test/${name.toLowerCase()}@sha256:${'e'.repeat(64)}`,
        ];
      }
      if (secretNames.has(name)) return [name, 'x'.repeat(48)];
      if (name === 'OTP_PROVIDER_URL') return [name, 'https://otp.example.com'];
      if (name === 'STOP_GRACE_PERIOD') return [name, '35ms'];
      if (name === 'PROXY_HTTP_PORT') return [name, '80'];
      if (name === 'PROXY_HTTPS_PORT') return [name, '443'];
      if (name.endsWith('_VOLUME_NAME')) return [name, `imeal-test-${name.toLowerCase()}`];
      if (
        name.endsWith('_PORT') ||
        name.endsWith('_SECONDS') ||
        name.endsWith('_LIMIT') ||
        name.endsWith('_SIZE') ||
        name.endsWith('_METERS')
      ) {
        return [name, '100'];
      }
      return [name, `test-${name.toLowerCase()}`];
    }),
  );
  Object.assign(values, {
    POSTGRES_USER: 'imeal',
    POSTGRES_DB: 'imeal',
    MINIO_ROOT_USER: 'imealadmin',
    MINIO_BUCKET_NAME: 'imeal-bucket',
    MIGRATION_TARGET_SCHEMA: 'public',
    MIGRATION_TARGET_IDENTITY: 'release',
    MIGRATION_APPROVAL_ID: 'approval',
    RELEASE_VERSION: 'release',
    LOG_LEVEL: 'info',
    SHUTDOWN_TIMEOUT_SECONDS: '30',
    SERVING_TIME_ZONE: 'Asia/Ho_Chi_Minh',
    SERVING_WINDOW_START: '10:30',
    SERVING_WINDOW_END: '13:30',
    NO_SHOW_PROCESSING_TIME: '13:45',
    QR_TTL_SECONDS: '5',
    QR_CLOCK_SKEW_SECONDS: '2',
    PICKUP_SESSION_TTL_SECONDS: '30',
  });
  return values;
}

test('rejects millisecond stop grace values before Compose duration coercion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-production-boundary-test-'));
  const envFile = join(directory, 'compose.env');
  const values = testValues();
  writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));
  const childEnv = { ...process.env };
  for (const name of requiredNames) delete childEnv[name];

  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [resolve(root, 'scripts/verify-production-boundary.mjs'), '--env-file', envFile],
          {
            cwd: root,
            env: childEnv,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      (error) => {
        const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
        assert.match(output, /STOP_GRACE_PERIOD must be expressed as whole seconds/);
        return true;
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
