import { afterEach, describe, expect, it } from 'vitest';
import {
  isTestAuthBypassEnabled,
  validateApiEnvironment,
} from './environment.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('API environment validation', () => {
  it('allows an explicit authentication bypass only in tests', () => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';

    expect(isTestAuthBypassEnabled()).toBe(true);
    expect(validateApiEnvironment()).toBeUndefined();
  });

  it('rejects an authentication bypass outside tests', () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'false';

    expect(() => validateApiEnvironment()).toThrow(
      'REQUIRE_AUTH=false is only allowed when NODE_ENV=test',
    );
  });

  it('rejects missing production security settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_CLIENT_ID;
    delete process.env.QR_SIGNING_SECRET;

    expect(() => validateApiEnvironment()).toThrow(
      'DATABASE_URL, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, QR_SIGNING_SECRET',
    );
  });
});
