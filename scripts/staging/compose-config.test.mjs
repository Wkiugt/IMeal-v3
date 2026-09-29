import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const composeFiles = ['docker-compose.yml', 'docker-compose.staging.yml'];
const composeText = composeFiles
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
const caddyText = readFileSync(
  resolve(root, 'infra/staging/Caddyfile'),
  'utf8',
);
const alertRulesText = readFileSync(
  resolve(root, 'infra/staging/alert-rules.yml'),
  'utf8',
);
const digest = 'a'.repeat(64);
const secretNames = new Set([
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'QR_SIGNING_SECRET',
  'OTP_HASH_SECRET',
  'OTP_DELIVERY_ENCRYPTION_KEY',
  'SESSION_HASH_SECRET',
  'OTP_PROVIDER_API_KEY',
]);

function fixtureValues() {
  const requiredNames = [
    ...new Set(
      [...composeText.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(([, name]) => name),
    ),
  ];
  const values = Object.fromEntries(
    requiredNames.map((name) => {
      if (name.endsWith('_IMAGE')) {
        return [
          name,
          `registry.example/imeal/${name.toLowerCase()}@sha256:${digest}`,
        ];
      }
      if (secretNames.has(name)) return [name, 'x'.repeat(48)];
      if (name === 'OTP_PROVIDER_URL')
        return [name, 'https://otp.example.test/send'];
      if (name === 'PUBLIC_HOSTNAME') return [name, 'staging.example.test'];
      if (name === 'ACME_EMAIL') return [name, 'ops@example.test'];
      if (name === 'PROXY_HTTP_PORT') return [name, '18080'];
      if (name === 'PROXY_HTTPS_PORT') return [name, '18443'];
      if (name.endsWith('_VOLUME_NAME'))
        return [name, `imeal-staging-${name.toLowerCase()}`];
      if (name.endsWith('_NETWORK_NAME'))
        return [name, `imeal-staging-${name.toLowerCase()}`];
      if (name === 'STOP_GRACE_PERIOD') return [name, '30s'];
      if (
        name.endsWith('_PORT') ||
        name.endsWith('_SECONDS') ||
        name.endsWith('_LIMIT') ||
        name.endsWith('_SIZE') ||
        name.endsWith('_METERS')
      ) {
        return [name, '100'];
      }
      return [name, `staging-${name.toLowerCase()}`];
    }),
  );
  Object.assign(values, {
    POSTGRES_USER: 'imeal_staging',
    POSTGRES_DB: 'imeal_staging',
    MINIO_ROOT_USER: 'imeal-staging',
    MINIO_BUCKET_NAME: 'imeal-staging-private',
    MIGRATION_TARGET_SCHEMA: 'phase0_staging',
    MIGRATION_TARGET_IDENTITY: 'imeal_staging/phase0_staging',
    MIGRATION_APPROVAL_ID: 'approval-staging',
    RELEASE_VERSION: 'imeal-staging-release',
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

function renderCompose(values) {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-staging-compose-'));
  const envFile = join(directory, 'compose.env');
  writeFileSync(
    envFile,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
  );
  try {
    return JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--env-file',
          envFile,
          '-f',
          'docker-compose.yml',
          '-f',
          'docker-compose.staging.yml',
          'config',
          '--format',
          'json',
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function environment(service) {
  return Object.fromEntries(
    (Array.isArray(service.environment)
      ? service.environment
      : Object.entries(service.environment ?? {}).map(
          ([key, value]) => `${key}=${value}`,
        )
    ).map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

test('renders an isolated immutable staging boundary', () => {
  const config = renderCompose(fixtureValues());
  const services = config.services;
  assert.equal(
    services['admin-web'].build.dockerfile,
    'apps/admin-web/Dockerfile',
  );
  for (const name of [
    'db',
    'pgbouncer',
    'minio',
    'minio-create-bucket',
    'migrate',
    'api',
    'worker',
    'admin-web',
    'caddy',
  ]) {
    assert.match(
      services[name].image,
      /@sha256:[a-f0-9]{64}$/i,
      `${name} must use a digest image`,
    );
  }
  for (const name of [
    'db',
    'pgbouncer',
    'minio',
    'minio-create-bucket',
    'migrate',
    'api',
    'worker',
    'admin-web',
  ]) {
    assert.equal(
      services[name].ports,
      undefined,
      `${name} must not publish a host port`,
    );
  }
  assert.deepEqual(
    services.caddy.ports.map(
      ({ published, target }) => `${published}:${target}`,
    ),
    ['18080:80', '18443:443'],
  );
  assert.equal(environment(services.api).NODE_ENV, 'production');
  assert.equal(environment(services.worker).NODE_ENV, 'production');
  assert.equal(environment(services.api).REQUIRE_AUTH, 'true');
  assert.equal(environment(services.worker).REQUIRE_AUTH, 'true');
  assert.equal(
    services.api.depends_on.migrate.condition,
    'service_completed_successfully',
  );
  assert.equal(
    services.worker.depends_on['minio-create-bucket'].condition,
    'service_completed_successfully',
  );
  assert.equal(
    services.worker.depends_on.migrate.condition,
    'service_completed_successfully',
  );
  assert.ok(services.minio['healthcheck']);
  assert.ok(services['minio-create-bucket'].depends_on.minio);
  assert.equal(
    services['minio-create-bucket'].depends_on.minio.condition,
    'service_healthy',
  );
  assert.match(
    services.caddy.volumes
      .map(({ source }) => source.replaceAll('\\', '/'))
      .join('\n'),
    /infra\/staging\/Caddyfile/,
  );
  assert.equal(config.networks.app.internal, true);
  assert.equal(config.networks.data.internal, true);
  const bucketCommand = services['minio-create-bucket'].command.join('\n');
  assert.match(bucketCommand, /anonymous set private/);
  assert.doesNotMatch(bucketCommand, /anonymous set public/);
  assert.match(bucketCommand, /MINIO_BUCKET_NAME/);
  for (const volume of Object.values(config.volumes)) {
    assert.match(volume.name, /imeal-staging/);
  }
  const rendered = JSON.stringify(config);
  assert.doesNotMatch(rendered, /CHANGE_ME_LOCAL|:latest\b/);
});

test('base Compose explicitly selects the Admin Dockerfile without changing local defaults', () => {
  const baseText = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
  assert.match(
    baseText,
    /admin-web:\s+\n\s+build:\s+\n\s+context: \.\s+\n\s+dockerfile: apps\/admin-web\/Dockerfile/,
  );
  assert.match(baseText, /NODE_ENV: \$\{NODE_ENV:-development\}/);
  assert.match(baseText, /POSTGRES_PORT:-5432/);
});

test('Caddy owns HTTPS redirect, health routes, headers and request IDs without stock rate-limit directives', () => {
  assert.match(caddyText, /http:\/\/\{\$PUBLIC_HOSTNAME\}/);
  assert.match(
    caddyText,
    /redir https:\/\/\{\$PUBLIC_HOSTNAME\}\{uri\} permanent/,
  );
  assert.match(caddyText, /\/health\/live/);
  assert.match(caddyText, /\/health\/ready/);
  assert.match(caddyText, /Strict-Transport-Security/);
  assert.match(caddyText, /X-Content-Type-Options/);
  assert.match(caddyText, /X-Request-Id/);
  assert.doesNotMatch(caddyText, /\brate_limit\b|rate-limit/);
  assert.doesNotMatch(caddyText, /minio|storage\//i);
});

test('alert rules use the hardening-owned metric and alert names', () => {
  for (const name of [
    'ImealApiReadinessFailure',
    'ImealApiErrorRateHigh',
    'ImealApiLatencyHigh',
    'ImealOtpBacklog',
    'ImealWorkerStale',
    'ImealDatabaseCapacity',
    'ImealObjectStorageUnavailable',
    'ImealBackupStale',
    'ImealSecurityBoundaryViolation',
  ]) {
    assert.match(alertRulesText, new RegExp(`alert: ${name}\\b`));
  }
  assert.match(alertRulesText, /\bimeal_http_requests_total\b/);
  assert.match(alertRulesText, /\bimeal_otp_outbox_oldest_age_seconds\b/);
  assert.match(
    alertRulesText,
    /\bimeal_worker_job_last_success_timestamp_seconds\b/,
  );
  assert.match(alertRulesText, /\bimeal_backup_age_seconds\b/);
  assert.doesNotMatch(alertRulesText, /password|token|secret|api[_-]?key/i);
});

test('validates Caddy syntax when the caddy binary is available', () => {
  const result = spawnSync(
    'caddy',
    ['validate', '--config', resolve(root, 'infra/staging/Caddyfile')],
    {
      cwd: root,
      env: {
        ...process.env,
        PUBLIC_HOSTNAME: 'staging.example.test',
        ACME_EMAIL: 'ops@example.test',
      },
      encoding: 'utf8',
    },
  );
  if (result.error?.code === 'ENOENT') return;
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
