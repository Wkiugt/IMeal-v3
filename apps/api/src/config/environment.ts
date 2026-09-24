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

function requireSecret(name: string, env: NodeJS.ProcessEnv): void {
  const secret = env[name]?.trim();
  if (!secret) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
}

function requireInteger(
  name: string,
  minimum: number,
  env: NodeJS.ProcessEnv,
): number {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (!/^\d+$/.test(value) || Number(value) < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function requireExact(
  name: string,
  expected: string,
  env: NodeJS.ProcessEnv,
): void {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}`);
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

  requireSecret(OTP_HASH_SECRET, env);
  requireSecret(OTP_DELIVERY_ENCRYPTION_KEY, env);
  requireSecret(SESSION_HASH_SECRET, env);
  otpProviderConfiguration(env);

  for (const [name, minimum] of OTP_NUMERIC_SETTINGS) {
    requireInteger(name, minimum, env);
  }

  const idleTimeout = requireInteger(
    'SESSION_IDLE_TIMEOUT_SECONDS',
    1,
    env,
  );
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

  if (env.QR_SIGNING_SECRET!.length < 32) {
    throw new Error('QR_SIGNING_SECRET must contain at least 32 characters');
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
