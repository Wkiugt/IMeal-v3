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
  process.env.OTP_DELIVERY_ENCRYPTION_KEY = 'e'.repeat(32);
  process.env.OTP_EXPIRY_SECONDS = '600';
  process.env.OTP_RESEND_SECONDS = '60';
  process.env.OTP_ATTEMPT_LIMIT = '5';
  process.env.OTP_RATE_WINDOW_SECONDS = '3600';
  process.env.OTP_ADDRESS_RATE_LIMIT = '5';
  process.env.OTP_CLIENT_RATE_LIMIT = '20';
  process.env.SESSION_HASH_SECRET = 's'.repeat(32);
  process.env.SESSION_IDLE_TIMEOUT_SECONDS = '1800';
  process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS = '604800';
  process.env.GPS_DEFAULT_GEOFENCE_RADIUS_METERS = '150';
  process.env.GPS_DEFAULT_MAX_FIX_AGE_SECONDS = '30';
  process.env.GPS_DEFAULT_MAX_ACCURACY_METERS = '100';
  process.env.SERVING_TIME_ZONE = 'Asia/Ho_Chi_Minh';
  process.env.SERVING_WINDOW_START = '10:30';
  process.env.SERVING_WINDOW_END = '13:30';
  process.env.NO_SHOW_PROCESSING_TIME = '13:45';
  process.env.RELEASE_VERSION = 'release-1';
  process.env.API_METRICS_EVIDENCE_DIGEST = `sha256:${'a'.repeat(64)}`;
  process.env.LOG_LEVEL = 'info';
  process.env.SHUTDOWN_TIMEOUT_SECONDS = '30';
  process.env.MIGRATION_EVIDENCE_PATH = '/run/imeal/migration-gate.json';
  process.env.MIGRATION_TARGET_IDENTITY = 'staging-schema';
  process.env.TRUSTED_PROXY_CIDRS = '172.31.28.0/24';
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

  it('accepts OTP-only production authentication with operational settings', () => {
    setValidProductionEnvironment();

    expect(() => validateApiEnvironment()).not.toThrow();
  });

  it('rejects missing, unsupported, and whitespace-padded NODE_ENV values', () => {
    setValidProductionEnvironment();
    delete process.env.NODE_ENV;
    expect(() => validateApiEnvironment()).toThrow('NODE_ENV');

    setValidProductionEnvironment();
    process.env.NODE_ENV = 'staging';
    expect(() => validateApiEnvironment()).toThrow('NODE_ENV');

    setValidProductionEnvironment();
    process.env.NODE_ENV = ' production ';
    expect(() => validateApiEnvironment()).toThrow('NODE_ENV');
  });

  it.each(['local', 'entra'])(
    'rejects legacy %s authentication mode',
    (mode) => {
      setValidProductionEnvironment();
      process.env.AUTH_MODE = mode;

      expect(() => validateApiEnvironment()).toThrow('AUTH_MODE must be otp');
    },
  );

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
      'REQUIRE_AUTH=true is required',
    );
  });

  it('rejects missing production security settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_AUTH = 'true';
    process.env.AUTH_MODE = 'otp';
    delete process.env.DATABASE_URL;
    delete process.env.QR_SIGNING_SECRET;

    expect(() => validateApiEnvironment()).toThrow(
      'DATABASE_URL, QR_SIGNING_SECRET',
    );
  });

  it('rejects production when the OTP payload encryption key is missing', () => {
    setValidProductionEnvironment();
    delete process.env.OTP_DELIVERY_ENCRYPTION_KEY;

    expect(() => validateApiEnvironment()).toThrow(
      'OTP_DELIVERY_ENCRYPTION_KEY',
    );
  });

  it('rejects a QR secret placeholder without exposing its value', () => {
    setValidProductionEnvironment();
    process.env.QR_SIGNING_SECRET =
      'replace-with-at-least-32-random-characters';

    let error: unknown;
    try {
      validateApiEnvironment();
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain('QR_SIGNING_SECRET');
    expect(String(error)).not.toContain(
      'replace-with-at-least-32-random-characters',
    );
  });

  it.each([
    'RELEASE_VERSION',
    'LOG_LEVEL',
    'SHUTDOWN_TIMEOUT_SECONDS',
    'MIGRATION_EVIDENCE_PATH',
    'MIGRATION_TARGET_IDENTITY',
    'TRUSTED_PROXY_CIDRS',
  ])('rejects production when %s is missing', (name) => {
    setValidProductionEnvironment();
    delete process.env[name];

    expect(() => validateApiEnvironment()).toThrow(name);
  });

  it('rejects an unrestricted trusted proxy list and allows an empty list outside production', () => {
    setValidProductionEnvironment();
    process.env.TRUSTED_PROXY_CIDRS = '0.0.0.0/0';
    expect(() => validateApiEnvironment()).toThrow('TRUSTED_PROXY_CIDRS');

    process.env.NODE_ENV = 'development';
    delete process.env.TRUSTED_PROXY_CIDRS;
    expect(() => validateApiEnvironment()).not.toThrow();
  });
  it('rejects production when API metrics evidence digest is missing or invalid', () => {
    setValidProductionEnvironment();
    delete process.env.API_METRICS_EVIDENCE_DIGEST;
    expect(() => validateApiEnvironment()).toThrow(
      'API_METRICS_EVIDENCE_DIGEST',
    );

    setValidProductionEnvironment();
    process.env.API_METRICS_EVIDENCE_DIGEST = 'not-a-digest';
    expect(() => validateApiEnvironment()).toThrow(
      'API_METRICS_EVIDENCE_DIGEST',
    );
  });

  it.each(['0', '301', 'not-a-number'])(
    'rejects an invalid production shutdown timeout: %s',
    (timeout) => {
      setValidProductionEnvironment();
      process.env.SHUTDOWN_TIMEOUT_SECONDS = timeout;

      expect(() => validateApiEnvironment()).toThrow(
        'SHUTDOWN_TIMEOUT_SECONDS',
      );
    },
  );

  it('rejects an invalid production log level', () => {
    setValidProductionEnvironment();
    process.env.LOG_LEVEL = 'verbose';

    expect(() => validateApiEnvironment()).toThrow('LOG_LEVEL');
  });

  it('rejects a relative migration evidence path', () => {
    setValidProductionEnvironment();
    process.env.MIGRATION_EVIDENCE_PATH = 'run/imeal/migration-gate.json';

    expect(() => validateApiEnvironment()).toThrow('MIGRATION_EVIDENCE_PATH');
  });

  it.each([
    'OTP_EXPIRY_SECONDS',
    'OTP_RESEND_SECONDS',
    'OTP_ATTEMPT_LIMIT',
    'OTP_RATE_WINDOW_SECONDS',
    'OTP_ADDRESS_RATE_LIMIT',
    'OTP_CLIENT_RATE_LIMIT',
  ])('rejects production when %s is missing', (name) => {
    setValidProductionEnvironment();
    delete process.env[name];

    expect(() => validateApiEnvironment()).toThrow(name);
  });

  it.each([
    'GPS_DEFAULT_GEOFENCE_RADIUS_METERS',
    'GPS_DEFAULT_MAX_FIX_AGE_SECONDS',
    'GPS_DEFAULT_MAX_ACCURACY_METERS',
  ])('rejects production when %s is missing', (name) => {
    setValidProductionEnvironment();
    delete process.env[name];

    expect(() => validateApiEnvironment()).toThrow(name);
  });

  it.each([
    'SERVING_TIME_ZONE',
    'SERVING_WINDOW_START',
    'SERVING_WINDOW_END',
    'NO_SHOW_PROCESSING_TIME',
  ])('rejects production when %s is missing', (name) => {
    setValidProductionEnvironment();
    delete process.env[name];

    expect(() => validateApiEnvironment()).toThrow(name);
  });

  it('rejects production when fixed serving timing drifts from the contract', () => {
    setValidProductionEnvironment();
    process.env.SERVING_WINDOW_START = '11:00';

    expect(() => validateApiEnvironment()).toThrow(
      'SERVING_WINDOW_START must be 10:30',
    );
  });

  it('rejects an absolute session timeout shorter than the idle timeout', () => {
    setValidProductionEnvironment();
    process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS = '60';

    expect(() => validateApiEnvironment()).toThrow(
      'SESSION_ABSOLUTE_TIMEOUT_SECONDS must be >= SESSION_IDLE_TIMEOUT_SECONDS',
    );
  });
});
