import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OtpDeliveryWorker,
  type ClaimedOtpDelivery,
  type OtpClaimValidation,
  type OtpDeliveryOutboxPort,
  type OtpProvider,
  validateWorkerEnvironment,
} from './otp-delivery-worker.service.js';

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
    .map((value) => (value instanceof Buffer ? value.toString('base64url') : value))
    .join('.');
}

function delivery(overrides: Partial<ClaimedOtpDelivery> = {}): ClaimedOtpDelivery {
  return {
    id: 'outbox-1',
    challengeId: 'challenge-1',
    providerPayloadRef: encryptedPayload(),
    attemptCount: 1,
    destination: DESTINATION,
    purpose: 'SESSION_LOGIN',
    expiresAt: new Date(NOW.getTime() + 5 * 60_000),
    ...overrides,
  };
}

function fakeOutbox(
  rows: ClaimedOtpDelivery[],
  validation?: (
    row: ClaimedOtpDelivery,
    now: Date,
  ) => OtpClaimValidation,
): OtpDeliveryOutboxPort & {
  processed: Array<{ id: string; now: Date }>;
  failures: Array<{ id: string; now: Date; code: string; retryAt: Date | null }>;
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
    validateClaim: vi.fn(async (id: string, now: Date): Promise<OtpClaimValidation> => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return { valid: false, reason: 'CLAIM_LOST' as const };
      if (row.expiresAt <= now) {
        return { valid: false, reason: 'EXPIRED' as const };
      }
      return validation?.(row, now) ?? {
        valid: true,
        destination: row.destination,
        purpose: row.purpose,
        expiresAt: row.expiresAt,
      };
    }),
    markProcessed: vi.fn(async (id: string, now: Date) => {
      outbox.processed.push({ id, now });
      return true;
    }),
    markFailed: vi.fn(
      async (
        id: string,
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
      OTP_PROVIDER_URL: 'https://provider.example.test/send',
      OTP_PROVIDER_API_KEY: 'provider-key',
    } as NodeJS.ProcessEnv;

    expect(() => validateWorkerEnvironment(env)).toThrow(
      'OTP_DELIVERY_ENCRYPTION_KEY',
    );
  });
  it('claims and sends only at the provider boundary without logging the code or message', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const outbox = fakeOutbox([delivery()]);
    const log = vi.spyOn(Logger.prototype, 'log');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const error = vi.spyOn(Logger.prototype, 'error');

    const result = await new OtpDeliveryWorker(undefined, provider, outbox, () => NOW).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0, suppressed: 0 });
    expect(provider.send).toHaveBeenCalledWith({
      destination: DESTINATION,
      code: CODE,
      purpose: 'SESSION_LOGIN',
    });
    expect(outbox.processed).toEqual([{ id: 'outbox-1', now: NOW }]);
    const logs = JSON.stringify([
      ...log.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(MESSAGE);
  });

  it('uses bounded exponential retry and permanently fails at the configured attempt limit', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    process.env.OTP_DELIVERY_MAX_ATTEMPTS = '3';
    process.env.OTP_DELIVERY_RETRY_BASE_SECONDS = '10';
    process.env.OTP_DELIVERY_RETRY_MAX_SECONDS = '15';
    const provider: OtpProvider = {
      send: vi.fn().mockRejectedValue(new Error(`timeout provider echoed ${CODE}`)),
    };
    const outbox = fakeOutbox([delivery({ attemptCount: 1 })]);

    const result = await new OtpDeliveryWorker(undefined, provider, outbox, () => NOW).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 1, failed: 0, suppressed: 0 });
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
    const provider: OtpProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const outbox = fakeOutbox([delivery({ attemptCount: 3 })]);

    const result = await new OtpDeliveryWorker(undefined, provider, outbox, () => NOW).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 0, failed: 1, suppressed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'MAX_ATTEMPTS',
      retryAt: null,
    });
  });

  it('revalidates the current challenge state after a batch delay before sending', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const delayedNow = new Date(NOW.getTime() + 6 * 60_000);
    const provider: OtpProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const outbox = fakeOutbox(
      [delivery({ expiresAt: new Date(NOW.getTime() + 60_000) })],
      (_row, currentNow) => {
        expect(currentNow).toEqual(delayedNow);
        return { valid: false, reason: 'EXPIRED' };
      },
    );

    const result = await new OtpDeliveryWorker(
      undefined,
      provider,
      outbox,
      () => delayedNow,
    ).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 0, failed: 0, suppressed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'OTP_EXPIRED',
      retryAt: null,
      now: delayedNow,
    });
  });

  it('suppresses a challenge consumed after claim before the provider call', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const outbox = fakeOutbox([delivery()], () => ({
      valid: false,
      reason: 'CONSUMED',
    }));

    const result = await new OtpDeliveryWorker(undefined, provider, outbox, () => NOW).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 0, failed: 0, suppressed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(outbox.failures[0]).toMatchObject({
      code: 'OTP_CONSUMED',
      retryAt: null,
    });
  });

  it('suppresses an expired challenge and never calls the provider', async () => {
    process.env.OTP_DELIVERY_ENCRYPTION_KEY = SECRET;
    const provider: OtpProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const outbox = fakeOutbox([
      delivery({ expiresAt: new Date(NOW.getTime() - 1) }),
    ]);

    const result = await new OtpDeliveryWorker(undefined, provider, outbox, () => NOW).processOnce(NOW);

    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 0, failed: 0, suppressed: 1 });
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
});
