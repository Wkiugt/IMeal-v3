const REQUIRED_API_ENV = [
  'DATABASE_URL',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'QR_SIGNING_SECRET',
] as const;

export function isTestAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' && process.env.REQUIRE_AUTH === 'false'
  );
}

export function validateApiEnvironment(): void {
  if (isTestAuthBypassEnabled()) {
    return;
  }

  if (process.env.REQUIRE_AUTH === 'false') {
    throw new Error('REQUIRE_AUTH=false is only allowed when NODE_ENV=test');
  }

  const missing = REQUIRED_API_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required API environment variables: ${missing.join(', ')}`,
    );
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
