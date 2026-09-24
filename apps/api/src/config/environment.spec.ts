import { afterEach, describe, expect, it } from 'vitest';
import {
  isTestAuthBypassEnabled,
  validateApiEnvironment,
} from './environment.js';

const originalEnv = { ...process.env };

function setValidProductionEnvironment() {
  process.env.NODE_ENV = 'production';
  process.env.REQUIRE_AUTH = 'true';
  process.env.AUTH_MODE = 'otp';
  process.env.DATABASE_URL = 'postgresql://localhost/imeal';
  process.env.QR_SIGNING_SECRET = 'q'.repeat(32);
  process.env.OTP_HASH_SECRET = 'o'.repeat(32);
  process.env.SESSION_HASH_SECRET = 's'.repeat(32);
  process.env.SESSION_IDLE_TIMEOUT_SECONDS = '1800';
  process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS = '604800';
}

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

  it('accepts OTP-only production authentication with session settings', () => {
    setValidProductionEnvironment();

    expect(() => validateApiEnvironment()).not.toThrow();
  });

  it.each(['local', 'entra'])('rejects legacy %s authentication mode', (mode) => {
    setValidProductionEnvironment();
    process.env.AUTH_MODE = mode;

    expect(() => validateApiEnvironment()).toThrow('AUTH_MODE must be otp');
  });

  it('rejects production when the session hash secret is missing', () => {
    setValidProductionEnvironment();
    delete process.env.SESSION_HASH_SECRET;

    expect(() => validateApiEnvironment()).toThrow('SESSION_HASH_SECRET');
  });

  it('rejects production when a session timeout is missing', () => {
    setValidProductionEnvironment();
    delete process.env.SESSION_IDLE_TIMEOUT_SECONDS;

    expect(() => validateApiEnvironment()).toThrow(
      'SESSION_IDLE_TIMEOUT_SECONDS',
    );
  });

  it('rejects an authentication bypass outside tests', () => {
    setValidProductionEnvironment();
    process.env.REQUIRE_AUTH = 'false';

    expect(() => validateApiEnvironment()).toThrow(
      'REQUIRE_AUTH=false is only allowed in tests',
    );
  });

  it('rejects missing production security settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.QR_SIGNING_SECRET;
    delete process.env.AUTH_MODE;

    expect(() => validateApiEnvironment()).toThrow(
      'DATABASE_URL, QR_SIGNING_SECRET',
    );
  });
});
