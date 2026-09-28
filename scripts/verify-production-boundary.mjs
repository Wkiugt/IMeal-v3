import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFiles = ['docker-compose.yml', 'docker-compose.production.yml'];
const composeText = composeFiles
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
const values = Object.fromEntries(
  requiredNames.map((name) => {
    if (name.endsWith('_IMAGE')) {
      return [name, `registry.example/imeal/${name.toLowerCase()}@sha256:${'b'.repeat(64)}`];
    }
    if (secretNames.has(name)) return [name, 'x'.repeat(48)];
    if (name === 'OTP_PROVIDER_URL') return [name, 'https://otp.example.com'];
    if (name === 'STOP_GRACE_PERIOD') return [name, '45s'];
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
    return [name, `production-${name.toLowerCase()}`];
  }),
);
Object.assign(values, {
  POSTGRES_USER: 'imeal',
  POSTGRES_DB: 'imeal',
  MINIO_ROOT_USER: 'imealadmin',
  MINIO_BUCKET_NAME: 'imeal-bucket',
  MIGRATION_TARGET_IDENTITY: 'release-identity',
  MIGRATION_APPROVAL_ID: 'approval-2026-09-28',
  RELEASE_VERSION: '2026.09.28',
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

const tempDir = mkdtempSync(resolve(tmpdir(), 'imeal-production-boundary-'));
const envFile = resolve(tempDir, 'compose.env');
writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));

try {
  const output = execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      envFile,
      ...composeFiles.flatMap((file) => ['-f', file]),
      'config',
      '--format',
      'json',
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const config = JSON.parse(output);
  const services = config.services;
  assert.ok(services, 'Compose config must contain services');

  for (const [name, service] of Object.entries(services)) {
    assert.equal(
      name === 'caddy' || service.ports === undefined,
      true,
      `${name} must not publish host ports in production`,
    );
    if (service.image) {
      assert.equal(
        /(^|:)latest(?:@|$)/i.test(service.image),
        false,
        `${name} uses a mutable latest image tag`,
      );
      assert.match(
        service.image,
        /@sha256:[0-9a-f]{64}$/,
        `${name} must use an immutable image digest`,
      );
    }
  }
  assert.equal(services.caddy.ports.length, 2, 'Caddy must publish only HTTP and HTTPS');
  assert.equal(services.caddy.ports.every((port) => port.target === 80 || port.target === 443), true);

  const stopGraceSeconds = Number.parseInt(services.api.stop_grace_period, 10);
  const shutdownSeconds = Number.parseInt(services.api.environment.SHUTDOWN_TIMEOUT_SECONDS, 10);
  assert.equal(stopGraceSeconds > shutdownSeconds, true, 'stop grace must exceed shutdown timeout');
  for (const name of ['api', 'worker']) {
    assert.equal(services[name].user, '1000:1000', `${name} must run as the non-root node user`);
    assert.equal(
      Object.hasOwn(services[name].environment, 'MIGRATION_DATABASE_URL'),
      false,
      `${name} must not receive the direct migration database URL`,
    );
  }

  const rendered = JSON.stringify(config);
  for (const forbidden of [
    'POSTGRES_HOST_AUTH_METHOD',
    'password_encryption=md5',
    'AUTH_TYPE: plain',
    'CHANGE_ME_LOCAL',
  ]) {
    assert.equal(rendered.includes(forbidden), false, `production config contains ${forbidden}`);
  }

  assert.equal(
    Object.hasOwn(services['migration-gate'].environment, 'MIGRATION_DATABASE_URL'),
    true,
    'migration-gate must receive the direct database URL',
  );
  for (const name of ['api', 'worker']) {
    assert.equal(
      services[name].depends_on['migration-gate'].condition,
      'service_completed_successfully',
      `${name} must wait for a successful migration gate`,
    );
    const evidenceMount = services[name].volumes.find(
      (mount) => mount.target === '/run/imeal',
    );
    assert.ok(evidenceMount, `${name} must mount migration evidence`);
    assert.equal(evidenceMount.read_only, true, `${name} migration evidence must be read-only`);
  }

  assert.equal(services['admin-web'].build.dockerfile, 'apps/admin-web/Dockerfile');
  assert.equal(services['admin-web'].user, '101:101', 'admin-web must run as nginx UID 101');
  assert.equal(config.networks.app.internal, true, 'app network must be private');
  assert.equal(config.networks.data.internal, true, 'data network must be private');

  const caddyfile = readFileSync(resolve(root, 'Caddyfile.production'), 'utf8');
  for (const required of [
    '{$PUBLIC_HOSTNAME}',
    'redir https://',
    'Strict-Transport-Security',
    'flush_interval -1',
    'reverse_proxy api:3000',
    'reverse_proxy admin-web:80',
  ]) {
    assert.equal(caddyfile.includes(required), true, `Caddy production config lacks ${required}`);
  }
  assert.equal(caddyfile.includes('/storage/'), false, 'MinIO storage must not be public');

  for (const dockerfile of ['apps/api/Dockerfile', 'apps/worker/Dockerfile']) {
    const text = readFileSync(resolve(root, dockerfile), 'utf8');
    assert.match(text, /^FROM .*@sha256:[0-9a-f]{64}/m, `${dockerfile} base must be immutable`);
    assert.match(text, /^USER node$/m, `${dockerfile} must run as a non-root user`);
    assert.equal(
      text.includes('FROM base AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY . .'),
      false,
      `${dockerfile} runner must not copy source files`,
    );
  }
  const adminDockerfile = readFileSync(resolve(root, 'apps/admin-web/Dockerfile'), 'utf8');
  assert.match(adminDockerfile, /^FROM .*@sha256:[0-9a-f]{64}/m);
  assert.match(adminDockerfile, /^USER nginx$/m);

  const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
  for (const required of ['.env.*', '/run/imeal/', '**/migration-gate.json']) {
    assert.equal(dockerignore.includes(required), true, `.dockerignore lacks ${required}`);
  }

  console.log('Production Compose boundary checks passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
