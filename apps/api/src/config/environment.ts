const REQUIRED_API_ENV = ['DATABASE_URL', 'QR_SIGNING_SECRET'] as const;
const OTP_HASH_SECRET = 'OTP_HASH_SECRET' as const;

function requireSecret(name: string): void {
  const secret = process.env[name]?.trim();
  if (!secret) {
    throw new Error(
      `Missing required API environment variables: ${name}`,
    );
  }
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
}

export function isLocalAuthEnabled(): boolean {
  return (process.env.AUTH_MODE ?? 'entra').toLowerCase() === 'local';
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

  const missing = REQUIRED_API_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required API environment variables: ${missing.join(', ')}`,
    );
  }

  if (isLocalAuthEnabled()) {
    if (!process.env.LOCAL_AUTH_JWT_SECRET?.trim()) {
      throw new Error(
        'Missing required API environment variables: LOCAL_AUTH_JWT_SECRET',
      );
    }
    if (!process.env.LOCAL_AUTH_USERS?.trim()) {
      throw new Error(
        'Missing required API environment variables: LOCAL_AUTH_USERS',
      );
    }
  } else {
    const missingEntra = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID'].filter(
      (name) => !process.env[name]?.trim(),
    );
    if (missingEntra.length > 0) {
      throw new Error(
        `Missing required API environment variables: ${missingEntra.join(', ')}`,
      );
    }
  }

  requireSecret(OTP_HASH_SECRET);

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
