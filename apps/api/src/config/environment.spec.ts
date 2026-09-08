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

  it('allows local authentication outside tests', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_MODE = 'local';
    process.env.DATABASE_URL = 'postgresql://localhost/imeal';
    process.env.QR_SIGNING_SECRET = 'q'.repeat(32);
    process.env.LOCAL_AUTH_JWT_SECRET = 'j'.repeat(32);
    process.env.LOCAL_AUTH_USERS =
      '[{"username":"admin01","password":"secret","email":"admin01@imeal.local","name":"Admin 01","role":"admin"}]';

    expect(() => validateApiEnvironment()).not.toThrow();
  });

  it('rejects missing local authentication settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_MODE = 'local';
    process.env.DATABASE_URL = 'postgresql://localhost/imeal';
    process.env.QR_SIGNING_SECRET = 'q'.repeat(32);
    delete process.env.LOCAL_AUTH_JWT_SECRET;
    delete process.env.LOCAL_AUTH_USERS;

    expect(() => validateApiEnvironment()).toThrow('LOCAL_AUTH_JWT_SECRET');
  });

  it('rejects an authentication bypass outside local mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'false';
    process.env.AUTH_MODE = 'entra';

    expect(() => validateApiEnvironment()).toThrow(
      'REQUIRE_AUTH=false is only allowed',
    );
  });

  it('rejects missing production security settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_MODE = 'entra';
    process.env.REQUIRE_AUTH = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_CLIENT_ID;
    delete process.env.QR_SIGNING_SECRET;

    expect(() => validateApiEnvironment()).toThrow(
      'DATABASE_URL, QR_SIGNING_SECRET',
    );
  });
});
