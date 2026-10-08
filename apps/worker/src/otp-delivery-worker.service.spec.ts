import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { StructuredLogger } from '@imeal/observability';
import type { PrismaService } from './common/prisma.service.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OtpDeliveryWorker,
  WorkerOtpOutboxService,
  type ClaimedOtpDelivery,
  type OtpClaimValidation,
  type OtpDeliveryOutboxPort,
  type OtpProvider,
  validateWorkerEnvironment,
} from './otp-delivery-worker.service.js';
import {
  GmailSmtpOtpProvider,
  type OtpSmtpTransport,
  type OtpSmtpTransportFactory,
} from './gmail-smtp-otp-provider.js';
import { WorkerMetricsService } from './metrics/metrics.service.js';

const NOW = new Date('2026-09-24T03:00:00.000Z');
const SECRET = 'delivery-encryption-secret-that-is-at-least-32-bytes';
const CODE = '123456';
const DESTINATION = 'employee@example.test';
const MESSAGE = 'Your verification code is 123456. It expires soon.';

function encryptedPayload(): string {
  const key = createHash('sha256').update(SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('imeal:otp-delivery:v1'));
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext]
    .map((value) =>
      value instanceof Buffer ? value.toString('base64url') : value,
    )
    .join('.');
}

function validWorkerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/imeal',
    OTP_DELIVERY_ENCRYPTION_KEY: SECRET,
    OTP_SMTP_USERNAME: 'otp-sender@company.invalid',
    OTP_SMTP_PASSWORD: 'app-password-not-a-google-password',
    OTP_SMTP_FROM: 'otp-sender@company.invalid',
    OTP_EXPIRY_SECONDS: '600',
    OTP_DELIVERY_BATCH_SIZE: '100',
    OTP_DELIVERY_MAX_ATTEMPTS: '4',
    OTP_DELIVERY_RETRY_BASE_SECONDS: '60',
    OTP_DELIVERY_RETRY_MAX_SECONDS: '900',
    OTP_DELIVERY_CLAIM_TIMEOUT_SECONDS: '300',
    SERVING_TIME_ZONE: 'Asia/Ho_Chi_Minh',
    SERVING_WINDOW_START: '10:30',
    SERVING_WINDOW_END: '13:30',
    NO_SHOW_PROCESSING_TIME: '13:45',
    RELEASE_VERSION: 'release-1',
    LOG_LEVEL: 'info',
    SHUTDOWN_TIMEOUT_SECONDS: '30',
    MIGRATION_EVIDENCE_PATH: '/run/imeal/migration-gate.json',
    MIGRATION_TARGET_IDENTITY: 'staging-schema',
  };
}

function delivery(
  overrides: Partial<ClaimedOtpDelivery> = {},
): ClaimedOtpDelivery {
  return {
    id: 'outbox-1',
    challengeId: 'challenge-1',
    providerPayloadRef: encryptedPayload(),
    claimToken: 'claim-token-1',
    attemptCount: 1,
    destination: DESTINATION,
    purpose: 'SESSION_LOGIN',
    expiresAt: new Date(NOW.getTime() + 5 * 60_000),
    ...overrides,
  };
}

function fakeOutbox(
  rows: ClaimedOtpDelivery[],
  validation?: (row: ClaimedOtpDelivery, now: Date) => OtpClaimValidation,
): OtpDeliveryOutboxPort & {
  processed: Array<{ id: string; now: Date }>;
  failures: Array<{
    id: string;
    now: Date;
    code: string;
    retryAt: Date | null;
  }>;
} {
  const processed: Array<{ id: string; now: Date }> = [];
  const failures: Array<{
    id: string;
    now: Date;
    code: string;
    retryAt: Date | null;
  }> = [];
  const outbox = {
    processed,
    failures,
    claimBatch: vi.fn(async () => rows),
    validateClaim: vi.fn(
      async (
        id: string,
        _claimToken: string,
        now: Date,
      ): Promise<OtpClaimValidation> => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) return { valid: false, reason: 'CLAIM_LOST' as const };
        if (row.expiresAt <= now) {
          return { valid: false, reason: 'EXPIRED' as const };
        }
        return (
          validation?.(row, now) ?? {
            valid: true,
            destination: row.destination,
            purpose: row.purpose,
            expiresAt: row.expiresAt,
          }
        );
      },
    ),
    markProcessed: vi.fn(async (id: string, _claimToken: string, now: Date) => {
      outbox.processed.push({ id, now });
      return true;
    }),
    markFailed: vi.fn(
      async (
        id: string,
        _claimToken: string,
        now: Date,
        failure: { code: string; retryAt: Date | null },
      ) => {
        outbox.failures.push({ id, now, ...failure });
        return true;
      },
    ),
  };
  return outbox;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OTP_DELIVERY_ENCRYPTION_KEY;
  delete process.env.OTP_DELIVERY_MAX_ATTEMPTS;
  delete process.env.OTP_DELIVERY_RETRY_BASE_SECONDS;
  delete process.env.OTP_DELIVERY_RETRY_MAX_SECONDS;
});

describe('OtpDeliveryWorker', () => {
  it('fails worker startup when the encrypted payload key is missing', () => {
    const env = {
      NODE_ENV: 'production',
      OTP_SMTP_USERNAME: 'otp-sender@company.invalid',
    } as NodeJS.ProcessEnv;

    expect(() => validateWorkerEnvironment(env)).toThrow(
      'OTP_DELIVERY_ENCRYPTION_KEY',
    );
  });
  it('accepts a complete production worker contract', () => {
    expect(() =>
      validateWorkerEnvironment(validWorkerEnvironment()),
    ).not.toThrow();
  });

  it.each(['OTP_SMTP_USERNAME', 'OTP_SMTP_PASSWORD', 'OTP_SMTP_FROM'])(
    'rejects production when %s is missing',
    (name) => {
      const env = validWorkerEnvironment();
      delete env[name];

      expect(() => validateWorkerEnvironment(env)).toThrow(name);
    },
  );

  it('rejects production when the SMTP port is not 587', () => {
    const env = validWorkerEnvironment();
    env.OTP_SMTP_PORT = '465';

    expect(() => validateWorkerEnvironment(env)).toThrow('OTP_SMTP_PORT');
  });

  it('rejects disabled SMTP TLS and a non-Gmail production host', () => {
    const tls = validWorkerEnvironment();
    tls.OTP_SMTP_REQUIRE_TLS = 'false';
    expect(() => validateWorkerEnvironment(tls)).toThrow(
      'OTP_SMTP_REQUIRE_TLS',
    );

    const host = validWorkerEnvironment();
    host.OTP_SMTP_HOST = 'smtp-relay.gmail.com';
    expect(() => validateWorkerEnvironment(host)).toThrow('OTP_SMTP_HOST');
  });

  it('accepts production SMTP when host and port use the Gmail defaults', () => {
    const env = validWorkerEnvironment();
    delete env.OTP_SMTP_HOST;
    delete env.OTP_SMTP_PORT;

    expect(() => validateWorkerEnvironment(env)).not.toThrow();
    expect(() =>
      validateWorkerEnvironment({
        ...env,
        OTP_SMTP_HOST: 'smtp.gmail.com',
        OTP_SMTP_PORT: '587',
      }),
    ).not.toThrow();
  });

  it('rejects provider placeholders without exposing their values', () => {
    const env = validWorkerEnvironment();
    env.OTP_SMTP_PASSWORD = 'CHANGE_ME_LOCAL';

    let error: unknown;
    try {
      validateWorkerEnvironment(env);
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain('OTP_SMTP_PASSWORD');
    expect(String(error)).not.toContain('CHANGE_ME_LOCAL');
  });

  it.each([
    'DATABASE_URL',
    'RELEASE_VERSION',
    'LOG_LEVEL',
    'SHUTDOWN_TIMEOUT_SECONDS',
    'MIGRATION_EVIDENCE_PATH',
    'MIGRATION_TARGET_IDENTITY',
    'OTP_DELIVERY_BATCH_SIZE',
    'OTP_DELIVERY_MAX_ATTEMPTS',
    'OTP_DELIVERY_RETRY_BASE_SECONDS',
    'OTP_DELIVERY_RETRY_MAX_SECONDS',
    'OTP_DELIVERY_CLAIM_TIMEOUT_SECONDS',
    'SERVING_TIME_ZONE',
    'SERVING_WINDOW_START',
    'SERVING_WINDOW_END',
    'NO_SHOW_PROCESSING_TIME',
  ])('rejects production when %s is missing', (name) => {
    const env = validWorkerEnvironment();
    delete env[name];

    expect(() => validateWorkerEnvironment(env)).toThrow(name);
  });

  it.each(['0', '301', 'not-a-number'])(
    'rejects an invalid production shutdown timeout: %s',
    (timeout) => {
      const env = validWorkerEnvironment();
      env.SHUTDOWN_TIMEOUT_SECONDS = timeout;

      expect(() => validateWorkerEnvironment(env)).toThrow(
        'SHUTDOWN_TIMEOUT_SECONDS',
      );
    },
  );

  it.each(['1.0', '1e2', '0x10'])(
    'rejects non-decimal worker numeric settings: %s',
    (value) => {
      const env = validWorkerEnvironment();
      env.OTP_DELIVERY_BATCH_SIZE = value;

      expect(() => validateWorkerEnvironment(env)).toThrow(
        'OTP_DELIVERY_BATCH_SIZE',
      );
    },
  );

  it('rejects a missing, unsupported, or whitespace-padded worker environment', () => {
    const missingNodeEnv = validWorkerEnvironment();
    delete missingNodeEnv.NODE_ENV;
    expect(() => validateWorkerEnvironment(missingNodeEnv)).toThrow('NODE_ENV');

    const unsupportedNodeEnv = validWorkerEnvironment();
    unsupportedNodeEnv.NODE_ENV = 'staging';
    expect(() => validateWorkerEnvironment(unsupportedNodeEnv)).toThrow(
      'NODE_ENV',
    );

    const whitespaceNodeEnv = validWorkerEnvironment();
    whitespaceNodeEnv.NODE_ENV = 'production ';
    expect(() => validateWorkerEnvironment(whitespaceNodeEnv)).toThrow(
      'NODE_ENV',
    );
  });

  it('rejects a retry ceiling below the retry base', () => {
    const env = validWorkerEnvironment();
    env.OTP_DELIVERY_RETRY_BASE_SECONDS = '900';
    env.OTP_DELIVERY_RETRY_MAX_SECONDS = '60';

    expect(() => validateWorkerEnvironment(env)).toThrow(
      'OTP_DELIVERY_RETRY_MAX_SECONDS must be >= OTP_DELIVERY_RETRY_BASE_SECONDS',
    );
  });
  it('runs the scheduled entrypoint with a generated timestamp', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox([delivery()]);
    const jobRunCreate = vi.fn().mockResolvedValue({ id: 'job-1' });

    const result = await new OtpDeliveryWorker(
      { jobRun: { create: jobRunCreate } } as unknown as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).handleOtpDeliveryCron();

    expect(result).toMatchObject({
      claimed: 1,
      sent: 1,
      failed: 0,
      suppressed: 0,
    });
    expect(jobRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: expect.stringMatching(/^otp_delivery_/),
        status: 'COMPLETED',
        successCount: 1,
        failureCount: 0,
        failureCode: null,
        failureMessage: null,
      }),
    });
    expect(JSON.stringify(jobRunCreate.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(jobRunCreate.mock.calls)).not.toContain(DESTINATION);
  });

  it('preserves active max-attempt PROCESSING claims during cleanup', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await new WorkerOtpOutboxService(
      prisma as unknown as PrismaService,
    ).claimBatch(NOW, 10);

    const cleanupSql = JSON.stringify(tx.$executeRaw.mock.calls[0]?.[0]);
    expect(cleanupSql).toContain('updated_at');
    expect(cleanupSql).toContain(' <=');
    expect(cleanupSql).toContain('PROCESSING');
  });
  it('counts max-attempt rows finalized by the claim cleanup prepass', async () => {
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    const tx = {
      $executeRaw: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const metrics = new WorkerMetricsService();

    await new WorkerOtpOutboxService(
      prisma as unknown as PrismaService,
      metrics,
    ).claimBatch(NOW, 10);

    expect(metrics.serializeApplicationMetrics()).toContain(
      'imeal_otp_delivery_failures_total 2',
    );
  });
  it('passes metrics to the fallback outbox when no outbox port is injected', async () => {
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    const tx = {
      $executeRaw: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const metrics = new WorkerMetricsService();

    await new OtpDeliveryWorker(
      prisma as unknown as PrismaService,
      undefined,
      undefined,
      () => NOW,
      undefined,
      undefined,
      metrics,
    ).processOnce(NOW);

    expect(metrics.serializeApplicationMetrics()).toContain(
      'imeal_otp_delivery_failures_total 1',
    );
  });
  it('claims and sends only at the provider boundary without logging the code or message', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox([delivery()]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
      logger as unknown as StructuredLogger,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      suppressed: 0,
    });
    expect(provider.send).toHaveBeenCalledWith({
      destination: DESTINATION,
      code: CODE,
      purpose: 'SESSION_LOGIN',
    });
    expect(outbox.processed).toEqual([{ id: 'outbox-1', now: NOW }]);
    const logs = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(MESSAGE);
  });

  it('captures structured OTP provider logs without provider secrets or payloads', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const providerError = Object.assign(
      new Error('provider payload {"code":"otp-secret"}'),
      {
        providerCode:
          'provider-secret=super-secret;payload={"code":"otp-secret"}',
      },
    );
    const provider: OtpProvider = {
      send: vi.fn().mockRejectedValue(providerError),
    };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const outbox = fakeOutbox([delivery()]);

    await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
      logger as unknown as StructuredLogger,
    ).processOnce(NOW);

    const logs = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logs).not.toContain('provider-secret=super-secret');
    expect(logs).not.toContain('otp-secret');
    expect(logs).toContain('"providerCode":"UNKNOWN"');
  });

  it('uses bounded exponential retry and permanently fails at the configured attempt limit', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    process.env.OTP_DELIVERY_RETRY_BASE_SECONDS = '10';
    process.env.OTP_DELIVERY_RETRY_MAX_SECONDS = '15';
    const provider: OtpProvider = {
      send: vi
        .fn()
        .mockRejectedValue(new Error(`timeout provider echoed ${CODE}`)),
    };
    const outbox = fakeOutbox([delivery({ attemptCount: 1 })]);

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 0,
      retried: 1,
      failed: 0,
      suppressed: 0,
    });
    expect(outbox.failures).toEqual([
      {
        id: 'outbox-1',
        now: NOW,
        code: 'PROVIDER_TRANSIENT',
        retryAt: new Date(NOW.getTime() + 10_000),
      },
    ]);
  });
  it('does not send a delivery whose attempt count is already at the configured maximum', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox([delivery({ attemptCount: 3 })]);

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 1,
      suppressed: 0,
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'MAX_ATTEMPTS',
      retryAt: null,
    });
  });

  it('revalidates the current challenge state after a batch delay before sending', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const delayedNow = new Date(NOW.getTime() + 6 * 60_000);
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox(
      [delivery({ expiresAt: new Date(NOW.getTime() + 60_000) })],
      (_row, currentNow) => {
        expect(currentNow).toEqual(delayedNow);
        return { valid: false, reason: 'EXPIRED' };
      },
    );

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => delayedNow,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 0,
      suppressed: 1,
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'OTP_EXPIRED',
      retryAt: null,
      now: delayedNow,
    });
  });

  it('suppresses a challenge consumed after claim before the provider call', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox([delivery()], () => ({
      valid: false,
      reason: 'CONSUMED',
    }));

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 0,
      suppressed: 1,
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'OTP_CONSUMED',
      retryAt: null,
    });
  });

  it('revalidates claim ownership immediately before provider send', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    let validations = 0;
    const outbox = fakeOutbox([delivery()], (row) => {
      validations += 1;
      return validations === 1
        ? {
            valid: true,
            destination: row.destination,
            purpose: row.purpose,
            expiresAt: row.expiresAt,
          }
        : { valid: false, reason: 'CONSUMED' };
    });

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).processOnce(NOW);

    expect(validations).toBe(2);
    expect(result).toMatchObject({ claimed: 1, sent: 0, suppressed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'OTP_CONSUMED',
      retryAt: null,
    });
  });

  it('suppresses an expired challenge and never calls the provider', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox([
      delivery({ expiresAt: new Date(NOW.getTime() - 1) }),
    ]);

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
    ).processOnce(NOW);

    expect(result).toMatchObject({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 0,
      suppressed: 1,
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures).toEqual([
      {
        id: 'outbox-1',
        now: NOW,
        code: 'OTP_EXPIRED',
        retryAt: null,
      },
    ]);
  });
  it('records provider attempts, retries, and terminal failures at persisted boundaries', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '2';
    const metrics = new WorkerMetricsService();
    let sends = 0;
    const provider: OtpProvider = {
      send: vi.fn().mockImplementation(async () => {
        sends += 1;
        if (sends === 1) {
          throw Object.assign(new Error('network'), { code: 'NETWORK' });
        }
        throw new Error('provider rejected');
      }),
    };
    const outbox = fakeOutbox([
      delivery({ id: 'retry-row' }),
      delivery({ id: 'terminal-row' }),
    ]);

    await new OtpDeliveryWorker(
      {} as PrismaService,
      provider,
      outbox,
      () => NOW,
      undefined,
      undefined,
      metrics,
    ).processOnce(NOW);

    const text = metrics.serializeApplicationMetrics();
    expect(text).toContain('imeal_otp_delivery_total 2');
    expect(text).toContain('imeal_otp_delivery_retries_total 1');
    expect(text).toContain('imeal_otp_delivery_failures_total 1');
  });

  it('delivers a claimed OTP through Gmail SMTP and records it processed', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const password = 'app-password-not-a-google-password';
    const sendMail = vi.fn<OtpSmtpTransport['sendMail']>(async () => ({
      accepted: [DESTINATION],
      rejected: [],
    }));
    const factory = vi.fn<OtpSmtpTransportFactory>(() => ({ sendMail }));
    const smtp = new GmailSmtpOtpProvider(
      {
        NODE_ENV: 'test',
        OTP_SMTP_USERNAME: 'otp-sender@company.invalid',
        OTP_SMTP_PASSWORD: password,
        OTP_SMTP_FROM: 'otp-sender@company.invalid',
        OTP_EXPIRY_SECONDS: '600',
      },
      factory,
    );
    const outbox = fakeOutbox([delivery()]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await new OtpDeliveryWorker(
      {} as PrismaService,
      smtp,
      outbox,
      () => NOW,
      logger as unknown as StructuredLogger,
    ).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(outbox.processed).toEqual([{ id: 'outbox-1', now: NOW }]);
    expect(outbox.failures).toEqual([]);
    expect(smtp.send).toBeTypeOf('function');
    expect(factory.mock.calls[0]?.[0]).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: 'otp-sender@company.invalid',
        pass: password,
      },
      tls: { minVersion: 'TLSv1.2', servername: 'smtp.gmail.com' },
    });
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toBe(DESTINATION);
    expect(message?.from).toEqual({
      name: 'IMeal',
      address: 'otp-sender@company.invalid',
    });
    expect(message?.subject).toBe('Your IMeal verification code');
    expect(message?.text).toContain(`Your verification code is ${CODE}.`);
    expect(message?.text).toContain('This code expires in 10 minutes.');
    expect(message?.html).toContain(CODE);
    expect(message?.html).toContain('This code expires in 10 minutes.');
    expect(message?.html).not.toContain('<script');
    const logs = JSON.stringify(logger.info.mock.calls);
    expect(logs).toContain('"provider":"gmail-smtp"');
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(password);
  });

  it('records authentication rejection as permanent without logging secrets', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const password = 'app-password-not-a-google-password';
    const sendMail = vi.fn<OtpSmtpTransport['sendMail']>(async () => {
      throw Object.assign(new Error(`535 rejected ${password} code ${CODE}`), {
        code: 'EAUTH',
        responseCode: 535,
      });
    });
    const factory = vi.fn<OtpSmtpTransportFactory>(() => ({ sendMail }));
    const smtp = new GmailSmtpOtpProvider(
      {
        NODE_ENV: 'test',
        OTP_SMTP_USERNAME: 'otp-sender@company.invalid',
        OTP_SMTP_PASSWORD: password,
        OTP_SMTP_FROM: 'otp-sender@company.invalid',
        OTP_EXPIRY_SECONDS: '600',
      },
      factory,
    );
    const outbox = fakeOutbox([delivery()]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await new OtpDeliveryWorker(
      {} as PrismaService,
      smtp,
      outbox,
      () => NOW,
      logger as unknown as StructuredLogger,
    ).processOnce(NOW);

    expect(outbox.processed).toEqual([]);
    expect(outbox.failures[0]).toMatchObject({
      code: 'PROVIDER_PERMANENT',
      retryAt: null,
    });
    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logs).toContain('"providerCode":"AUTHENTICATION"');
    expect(logs).toContain('"provider":"gmail-smtp"');
    expect(logs).not.toContain(password);
    expect(logs).not.toContain(CODE);
  });

  it('keeps network and SMTP 4xx failures retryable and other SMTP 5xx permanent', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const env = {
      NODE_ENV: 'test',
      OTP_SMTP_USERNAME: 'otp-sender@company.invalid',
      OTP_SMTP_PASSWORD: 'app-password-not-a-google-password',
      OTP_SMTP_FROM: 'otp-sender@company.invalid',
      OTP_EXPIRY_SECONDS: '600',
    };
    const network = vi.fn<OtpSmtpTransport['sendMail']>(async () => {
      throw Object.assign(new Error('connection reset'), {
        code: 'ECONNECTION',
      });
    });
    const networkOutbox = fakeOutbox([delivery({ id: 'network-row' })]);
    await new OtpDeliveryWorker(
      {} as PrismaService,
      new GmailSmtpOtpProvider(env, () => ({ sendMail: network })),
      networkOutbox,
      () => NOW,
    ).processOnce(NOW);
    expect(networkOutbox.processed).toEqual([]);
    expect(networkOutbox.failures[0]).toMatchObject({
      code: 'PROVIDER_TRANSIENT',
      retryAt: new Date(NOW.getTime() + 60_000),
    });

    const rateLimited = vi.fn<OtpSmtpTransport['sendMail']>(async () => {
      throw Object.assign(new Error('450 busy'), { responseCode: 450 });
    });
    const rateOutbox = fakeOutbox([delivery({ id: 'rate-row' })]);
    await new OtpDeliveryWorker(
      {} as PrismaService,
      new GmailSmtpOtpProvider(env, () => ({ sendMail: rateLimited })),
      rateOutbox,
      () => NOW,
    ).processOnce(NOW);
    expect(rateOutbox.failures[0]).toMatchObject({
      code: 'PROVIDER_TRANSIENT',
    });
    expect(rateOutbox.failures[0]?.retryAt).not.toBeNull();

    const rejected = vi.fn<OtpSmtpTransport['sendMail']>(async () => {
      throw Object.assign(new Error('550 unavailable'), { responseCode: 550 });
    });
    const rejectedOutbox = fakeOutbox([delivery({ id: 'rejected-row' })]);
    await new OtpDeliveryWorker(
      {} as PrismaService,
      new GmailSmtpOtpProvider(env, () => ({ sendMail: rejected })),
      rejectedOutbox,
      () => NOW,
    ).processOnce(NOW);
    expect(rejectedOutbox.processed).toEqual([]);
    expect(rejectedOutbox.failures[0]).toMatchObject({
      code: 'PROVIDER_PERMANENT',
      retryAt: null,
    });
  });
});
