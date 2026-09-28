import { isIP } from 'node:net';
import { otpProviderConfiguration } from '../otp/otp-provider.js';

const REQUIRED_API_ENV = ['DATABASE_URL', 'QR_SIGNING_SECRET'] as const;
const OTP_HASH_SECRET = 'OTP_HASH_SECRET' as const;
const OTP_DELIVERY_ENCRYPTION_KEY = 'OTP_DELIVERY_ENCRYPTION_KEY' as const;
const SESSION_HASH_SECRET = 'SESSION_HASH_SECRET' as const;

const OTP_NUMERIC_SETTINGS = [
  ['OTP_EXPIRY_SECONDS', 1],
  ['OTP_RESEND_SECONDS', 1],
  ['OTP_ATTEMPT_LIMIT', 1],
  ['OTP_RATE_WINDOW_SECONDS', 1],
  ['OTP_ADDRESS_RATE_LIMIT', 1],
  ['OTP_CLIENT_RATE_LIMIT', 1],
] as const;

const GPS_NUMERIC_SETTINGS = [
  ['GPS_DEFAULT_GEOFENCE_RADIUS_METERS', 1],
  ['GPS_DEFAULT_MAX_FIX_AGE_SECONDS', 1],
  ['GPS_DEFAULT_MAX_ACCURACY_METERS', 1],
] as const;

const FIXED_OPERATIONAL_SETTINGS = [
  ['SERVING_TIME_ZONE', 'Asia/Ho_Chi_Minh'],
  ['SERVING_WINDOW_START', '10:30'],
  ['SERVING_WINDOW_END', '13:30'],
  ['NO_SHOW_PROCESSING_TIME', '13:45'],
  ['QR_TTL_SECONDS', '5'],
  ['QR_CLOCK_SKEW_SECONDS', '2'],
  ['PICKUP_SESSION_TTL_SECONDS', '30'],
] as const;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const PLACEHOLDER_MARKERS = [
  'change_me_local',
  'replace-with-',
  'example.test',
];

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

function requireValue(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (isPlaceholder(value)) {
    throw new Error(`${name} must not use a placeholder value`);
  }
  return value;
}

function requireSecret(name: string, env: NodeJS.ProcessEnv): void {
  const secret = requireValue(name, env);
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
}

function requireInteger(
  name: string,
  minimum: number,
  env: NodeJS.ProcessEnv,
  maximum?: number,
): number {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (
    !/^\d+$/.test(value) ||
    Number(value) < minimum ||
    (maximum !== undefined && Number(value) > maximum)
  ) {
    const maximumMessage = maximum === undefined ? '' : ` and <= ${maximum}`;
    throw new Error(
      `${name} must be an integer >= ${minimum}${maximumMessage}`,
    );
  }
  return Number(value);
}

function requireExact(
  name: string,
  expected: string,
  env: NodeJS.ProcessEnv,
): void {
  const value = requireValue(name, env);
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}`);
  }
}

function requireProductionRuntimeSettings(env: NodeJS.ProcessEnv): void {
  const logLevel = requireValue('LOG_LEVEL', env).toLowerCase();
  if (!LOG_LEVELS.includes(logLevel as (typeof LOG_LEVELS)[number])) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error');
  }

  requireValue('RELEASE_VERSION', env);
  requireInteger('SHUTDOWN_TIMEOUT_SECONDS', 1, env, 300);
  const evidencePath = requireValue('MIGRATION_EVIDENCE_PATH', env);
  if (!evidencePath.startsWith('/')) {
    throw new Error('MIGRATION_EVIDENCE_PATH must be an absolute path');
  }
  requireValue('MIGRATION_TARGET_IDENTITY', env);
}

function requireSupportedNodeEnvironment(
  env: NodeJS.ProcessEnv,
): 'production' | 'development' | 'test' {
  const configured = env.NODE_ENV;
  const normalized = configured?.trim();
  if (!normalized) {
    throw new Error('Missing required API environment variable: NODE_ENV');
  }
  if (configured !== normalized) {
    throw new Error('NODE_ENV must not contain surrounding whitespace');
  }
  if (
    normalized !== 'production' &&
    normalized !== 'development' &&
    normalized !== 'test'
  ) {
    throw new Error('NODE_ENV must be production, development, or test');
  }
  return normalized;
}

function requireProductionProviderUrl(env: NodeJS.ProcessEnv): void {
  const value = requireValue('OTP_PROVIDER_URL', env);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OTP_PROVIDER_URL must be a valid HTTPS URL in production');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    hostname.length === 0 ||
    hostname === 'localhost' ||
    isIP(hostname) !== 0
  ) {
    throw new Error(
      'OTP_PROVIDER_URL must not target loopback or IP-literal destinations in production',
    );
  }
}

export function isTestAuthBypassEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === 'test' && env.REQUIRE_AUTH === 'false';
}

export function validateApiEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const nodeEnv = requireSupportedNodeEnvironment(env);
  const isProduction = nodeEnv === 'production';

  if (isTestAuthBypassEnabled(env)) return;

  if (env.REQUIRE_AUTH !== 'true') {
    throw new Error(
      'REQUIRE_AUTH=true is required; the authentication bypass is test-only',
    );
  }

  const authMode = env.AUTH_MODE?.trim().toLowerCase();
  if (authMode !== 'otp') {
    throw new Error(
      'AUTH_MODE must be otp; only allowlist-A email OTP is supported',
    );
  }

  const missing = REQUIRED_API_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required API environment variables: ${missing.join(', ')}`,
    );
  }

  requireValue('DATABASE_URL', env);
  requireSecret('QR_SIGNING_SECRET', env);
  requireSecret(OTP_HASH_SECRET, env);
  requireSecret(OTP_DELIVERY_ENCRYPTION_KEY, env);
  requireSecret(SESSION_HASH_SECRET, env);
  if (isProduction) {
    requireProductionProviderUrl(env);
    requireValue('OTP_PROVIDER_API_KEY', env);
    requireValue('OTP_PROVIDER_FROM', env);
    requireProductionRuntimeSettings(env);
  }
  const providerEnvironment =
    env.NODE_ENV === nodeEnv ? env : { ...env, NODE_ENV: nodeEnv };
  otpProviderConfiguration(providerEnvironment);

  for (const [name, minimum] of OTP_NUMERIC_SETTINGS) {
    requireInteger(name, minimum, env);
  }

  const idleTimeout = requireInteger('SESSION_IDLE_TIMEOUT_SECONDS', 1, env);
  const absoluteTimeout = requireInteger(
    'SESSION_ABSOLUTE_TIMEOUT_SECONDS',
    1,
    env,
  );
  if (absoluteTimeout < idleTimeout) {
    throw new Error(
      'SESSION_ABSOLUTE_TIMEOUT_SECONDS must be >= SESSION_IDLE_TIMEOUT_SECONDS',
    );
  }

  for (const [name, minimum] of GPS_NUMERIC_SETTINGS) {
    requireInteger(name, minimum, env);
  }
  for (const [name, expected] of FIXED_OPERATIONAL_SETTINGS) {
    requireExact(name, expected, env);
  }

  const port = env.PORT;
  if (
    port &&
    (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
}
