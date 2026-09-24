import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AllowlistService, type AllowlistResolution } from './allowlist.service.js';
import { hashOtpCode, OtpService } from './otp.service.js';
import { decryptOtpProviderPayload } from '../otp/otp-provider.js';

type MockFunction = Mock;

interface OtpPrismaMock {
  $transaction: MockFunction;
  $queryRaw: MockFunction;
  otpAllowlist: { findFirst: MockFunction };
  otpChallenge: {
    findFirst: MockFunction;
    count: MockFunction;
    create: MockFunction;
    update: MockFunction;
    updateMany: MockFunction;
  };
  otpDeliveryOutbox: { create: MockFunction };
  auditLog: { create: MockFunction };
  user: { findUnique: MockFunction };
}

const NOW = new Date('2026-09-24T03:00:00.000Z');
const EMAIL = 'employee@example.test';
const USER = {
  id: 'user-1',
  email: EMAIL,
  name: 'Employee',
  isActive: true,
};
const ALLOWLIST: AllowlistResolution = {
  id: 'allow-1',
  normalizedEmail: EMAIL,
  userId: USER.id,
  user: USER,
};

function createPrisma() {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    otpAllowlist: { findFirst: vi.fn() },
    otpChallenge: {
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'challenge-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    otpDeliveryOutbox: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        ...USER,
        userRoles: [],
        userPermissions: [],
      }),
    },
  } satisfies OtpPrismaMock;
  prisma.$transaction.mockImplementation(
    (callback: (tx: OtpPrismaMock) => unknown) => callback(prisma),
  );
  return prisma;
}

function installService() {
  const prisma = createPrisma();
  const allowlist = new AllowlistService();
  Reflect.set(allowlist, 'prisma', prisma);
  const service = new OtpService(allowlist);
  Reflect.set(service, 'prisma', prisma);
  Reflect.set(service, 'generateCode', vi.fn().mockReturnValue('123456'));
  return { service, allowlist, prisma };
}

describe('AllowlistService', () => {
  it('normalizes email deterministically before lookup', async () => {
    const allowlist = new AllowlistService();
    const prisma = createPrisma();
    prisma.otpAllowlist.findFirst.mockResolvedValue(null);
    Reflect.set(allowlist, 'prisma', prisma);

    expect(allowlist.normalizeEmail('  Employee@EXAMPLE.test  ')).toBe(EMAIL);
    await allowlist.findEligible(
      '  Employee@EXAMPLE.test  ',
      'SESSION_LOGIN',
      NOW,
    );

    expect(prisma.otpAllowlist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ normalizedEmail: EMAIL }),
      }),
    );
  });
});

describe('OtpService', () => {
  const context = {
    requestId: 'request-1',
    clientIp: '198.51.100.10',
    clientFingerprint: 'device-1',
    now: NOW,
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.OTP_HASH_SECRET = 'otp-test-secret-that-is-at-least-32-bytes';
  });

  afterEach(() => {
    delete process.env.OTP_HASH_SECRET;
  });

  it.each(['unknown@example.test', 'disabled@example.test', 'not-allowlisted@example.test'])(
    'returns the same safe request response for %s',
    async (email) => {
      const { service, allowlist, prisma } = installService();
      vi.spyOn(allowlist, 'findEligible').mockResolvedValue(null);

      const response = await service.request(
        { email, purpose: 'SESSION_LOGIN' },
        context,
      );

      expect(response).toEqual({ accepted: true });
      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
    },
  );

  it('creates a hash-backed challenge and delivery outbox without persisting the code', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);

    const response = await service.request(
      { email: ' Employee@EXAMPLE.test ', purpose: 'SESSION_LOGIN' },
      context,
    );

    expect(response).toEqual({ accepted: true });
    expect(prisma.otpChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          normalizedEmail: EMAIL,
          purpose: 'SESSION_LOGIN',
          verifierHash: hashOtpCode(
            '123456',
            EMAIL,
            'SESSION_LOGIN',
            process.env.OTP_HASH_SECRET!,
          ),
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(JSON.stringify(prisma.otpChallenge.create.mock.calls)).not.toContain(
      '123456',
    );
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      '123456',
    );
    expect(JSON.stringify(prisma.otpDeliveryOutbox.create.mock.calls)).not.toContain(
      '123456',
    );
  });
  it('stores an encrypted provider payload that the worker can resolve without clear persistence', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);

    await service.request(
      { email: EMAIL, purpose: 'SESSION_LOGIN' },
      context,
    );

    const outboxInput = prisma.otpDeliveryOutbox.create.mock.calls[0][0] as {
      data: { providerPayloadRef: string };
    };
    expect(
      decryptOtpProviderPayload(
        outboxInput.data.providerPayloadRef,
        process.env.OTP_DELIVERY_ENCRYPTION_KEY ??
          'test-only-otp-delivery-encryption-secret',
      ),
    ).toEqual({
      destination: EMAIL,
      code: '123456',
      purpose: 'SESSION_LOGIN',
    });
  });

  it('returns the same safe request shape while an active challenge is throttled', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      resendAfter: new Date(NOW.getTime() + 30_000),
      expiresAt: new Date(NOW.getTime() + 300_000),
      consumedAt: null,
    });

    await expect(
      service.request({ email: EMAIL, purpose: 'SESSION_LOGIN' }, context),
    ).resolves.toEqual({ accepted: true });
    expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
  });

  it('uses shared client and address locks across concurrent allowlisted addresses', async () => {
    const { service, allowlist, prisma } = installService();
    const first = {
      ...ALLOWLIST,
      id: 'allow-1',
      normalizedEmail: 'first@example.test',
      user: { ...USER, email: 'first@example.test' },
    };
    const second = {
      ...ALLOWLIST,
      id: 'allow-2',
      normalizedEmail: 'second@example.test',
      user: { ...USER, email: 'second@example.test' },
    };
    vi.spyOn(allowlist, 'findEligible').mockImplementation(async (email) =>
      email === first.normalizedEmail ? first : second,
    );

    await Promise.all([
      service.request(
        { email: first.normalizedEmail, purpose: 'SESSION_LOGIN' },
        { ...context, clientFingerprint: undefined, requestId: 'request-1' },
      ),
      service.request(
        { email: second.normalizedEmail, purpose: 'SESSION_LOGIN' },
        { ...context, clientFingerprint: undefined, requestId: 'request-2' },
      ),
    ]);

    const rawCalls = prisma.$queryRaw.mock.calls;
    const advisoryCalls = rawCalls.filter(([template]) =>
      Array.isArray(template) &&
      template.join('').includes('pg_advisory_xact_lock'),
    );
    const addressCalls = rawCalls.filter(([template]) =>
      Array.isArray(template) &&
      template.join('').includes('otp_allowlists'),
    );
    expect(advisoryCalls).toHaveLength(2);
    expect(addressCalls).toHaveLength(2);
    expect(advisoryCalls[0][1]).toBe(advisoryCalls[1][1]);
    expect(JSON.stringify(rawCalls)).not.toContain(context.clientIp);
  });

  it('atomically consumes a valid code and resolves the current user', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      normalizedEmail: EMAIL,
      purpose: 'SESSION_LOGIN',
      verifierHash: hashOtpCode(
        '123456',
        EMAIL,
        'SESSION_LOGIN',
        process.env.OTP_HASH_SECRET!,
      ),
      expiresAt: new Date(NOW.getTime() + 300_000),
      attemptCount: 0,
      attemptLimit: 5,
      consumedAt: null,
      allowlist: { userId: USER.id, user: USER },
    });

    const principal = await service.verify(
      { email: EMAIL, purpose: 'SESSION_LOGIN', code: '123456' },
      context,
    );

    expect(principal.userId).toBe(USER.id);
    expect(principal.user.email).toBe(EMAIL);
    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          consumedAt: null,
          verifierHash: expect.any(String),
        }),
        data: { consumedAt: NOW },
      }),
    );
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      '123456',
    );
  });

  it.each([
    ['invalid', '000000'],
    ['expired', '123456'],
    ['consumed', '123456'],
    ['attempt-limited', '123456'],
  ])('fails closed for %s challenges', async (kind, code) => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);
    const challenge = {
      id: 'challenge-1',
      normalizedEmail: EMAIL,
      purpose: 'SESSION_LOGIN',
      verifierHash: hashOtpCode(
        '123456',
        EMAIL,
        'SESSION_LOGIN',
        process.env.OTP_HASH_SECRET!,
      ),
      expiresAt:
        kind === 'expired'
          ? new Date(NOW.getTime() - 1)
          : new Date(NOW.getTime() + 300_000),
      attemptCount: kind === 'attempt-limited' ? 5 : 0,
      attemptLimit: 5,
      consumedAt: kind === 'consumed' ? NOW : null,
      allowlist: { userId: USER.id, user: USER },
    };
    prisma.otpChallenge.findFirst.mockResolvedValue(challenge);
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.verify(
        { email: EMAIL, purpose: 'SESSION_LOGIN', code },
        context,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OTP_INVALID_OR_EXPIRED' }),
    });
  });

  it('rejects a race when the conditional consume updates no row', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      normalizedEmail: EMAIL,
      purpose: 'SESSION_LOGIN',
      verifierHash: hashOtpCode(
        '123456',
        EMAIL,
        'SESSION_LOGIN',
        process.env.OTP_HASH_SECRET!,
      ),
      expiresAt: new Date(NOW.getTime() + 300_000),
      attemptCount: 0,
      attemptLimit: 5,
      consumedAt: null,
      allowlist: { userId: USER.id, user: USER },
    });
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.verify(
        { email: EMAIL, purpose: 'SESSION_LOGIN', code: '123456' },
        context,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OTP_INVALID_OR_EXPIRED' }),
    });
  });
});
