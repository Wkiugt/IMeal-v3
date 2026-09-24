const REQUIRED_API_ENV = ['DATABASE_URL', 'QR_SIGNING_SECRET'] as const;
const OTP_HASH_SECRET = 'OTP_HASH_SECRET' as const;
const SESSION_HASH_SECRET = 'SESSION_HASH_SECRET' as const;
const SESSION_TIMEOUT_SETTINGS = [
  'SESSION_IDLE_TIMEOUT_SECONDS',
  'SESSION_ABSOLUTE_TIMEOUT_SECONDS',
] as const;

function requireSecret(name: string): void {
  const secret = process.env[name]?.trim();
  if (!secret) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
}

function requirePositiveInteger(name: string): void {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required API environment variables: ${name}`);
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be an integer >= 1`);
  }
}

export function isTestAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' && process.env.REQUIRE_AUTH === 'false'
  );
}

export function validateApiEnvironment(): void {
  if (isTestAuthBypassEnabled()) return;

  if (process.env.REQUIRE_AUTH === 'false') {
    throw new Error('REQUIRE_AUTH=false is only allowed in tests');
  }

  const authMode = process.env.AUTH_MODE?.trim().toLowerCase();
  if (authMode && authMode !== 'otp') {
    throw new Error('AUTH_MODE must be otp; Entra and local authentication are disabled');
  }

  const missing = REQUIRED_API_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required API environment variables: ${missing.join(', ')}`,
    );
  }

  requireSecret(OTP_HASH_SECRET);
  requireSecret(SESSION_HASH_SECRET);
  for (const name of SESSION_TIMEOUT_SETTINGS) {
    requirePositiveInteger(name);
  }

  if (process.env.QR_SIGNING_SECRET!.length < 32) {
    throw new Error('QR_SIGNING_SECRET must contain at least 32 characters');
  }

  const port = process.env.PORT;
  if (
    port &&
    (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
}
