import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { parseTrustedProxyList, resolveTrustedClientIp } from '../common/trusted-client-ip.js';
import {
  AllowlistService,
  type AllowlistResolution,
} from './allowlist.service.js';
import { hashOtpCode, OtpService } from './otp.service.js';
import { decryptOtpProviderPayload } from '../otp/otp-provider.js';
import type { ApiMetricsService } from '../common/metrics.service.js';

type MockFunction = Mock;

interface OtpPrismaMock {
  $transaction: MockFunction;
  $queryRaw: MockFunction;
  $executeRaw: MockFunction;
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

function createPrisma(
  rawCapabilities: 'complete' | 'query-only' | 'execute-only' | 'none' =
    'complete',
) {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    otpAllowlist: { findFirst: vi.fn() },
    otpChallenge: {
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'challenge-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    otpDeliveryOutbox: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        ...USER,
        userRoles: [],
        userPermissions: [],
      }),
    },
  } satisfies OtpPrismaMock;

  if (rawCapabilities === 'query-only' || rawCapabilities === 'none') {
    Reflect.deleteProperty(prisma, '$executeRaw');
  }
  if (rawCapabilities === 'execute-only' || rawCapabilities === 'none') {
    Reflect.deleteProperty(prisma, '$queryRaw');
  }

  prisma.$transaction.mockImplementation(
    (callback: (tx: OtpPrismaMock) => unknown) => callback(prisma),
  );
  return prisma;
}

function installService(
  metrics?: Pick<ApiMetricsService, 'recordAuthAttempt'>,
  rawCapabilities: 'complete' | 'query-only' | 'execute-only' | 'none' =
    'complete',
) {
  const prisma = createPrisma(rawCapabilities);
  const allowlist = new AllowlistService(prisma as never);
  Reflect.set(allowlist, 'prisma', prisma);
  const service = new OtpService(
    allowlist,
    prisma as never,
    undefined,
    metrics as never,
  );
  Reflect.set(service, 'prisma', prisma);
  Reflect.set(service, 'generateCode', vi.fn().mockReturnValue('123456'));
  return { service, allowlist, prisma };
}


describe('AllowlistService', () => {
  it('normalizes email deterministically before lookup', async () => {
    const prisma = createPrisma();
    const allowlist = new AllowlistService(prisma as never);
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

  it.each([
    'unknown@example.test',
    'disabled@example.test',
    'not-allowlisted@example.test',
  ])('returns the same safe request response for %s', async (email) => {
      const { service, allowlist, prisma } = installService();
      vi.spyOn(allowlist, 'findEligible').mockResolvedValue(null);

      const response = await service.request(
        { email, purpose: 'SESSION_LOGIN' },
        context,
      );

      expect(response).toEqual({ accepted: true });
      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
  });

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
    expect(
      JSON.stringify(prisma.otpDeliveryOutbox.create.mock.calls),
    ).not.toContain('123456');
  });
  it('stores an encrypted provider payload that the worker can resolve without clear persistence', async () => {
    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);

    await service.request({ email: EMAIL, purpose: 'SESSION_LOGIN' }, context);

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

  it('uses both raw capabilities for OTP locking', async () => {
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

    const lockCallOrder: string[] = [];
    prisma.$executeRaw.mockImplementation(() => {
      lockCallOrder.push('advisory');
      return Promise.resolve(0);
    });
    prisma.$queryRaw.mockImplementation(() => {
      lockCallOrder.push('row-lock');
      return Promise.resolve([]);
    });

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

    const advisoryCalls = prisma.$executeRaw.mock.calls;
    const addressCalls = prisma.$queryRaw.mock.calls;
    expect(advisoryCalls).toHaveLength(2);
    expect(addressCalls).toHaveLength(2);
    expect(advisoryCalls[0][1]).toBe(advisoryCalls[1][1]);
    expect(
      advisoryCalls.every(([query]) =>
        String(query).includes('pg_advisory_xact_lock'),
      ),
    ).toBe(true);
    expect(
      addressCalls.every(
        ([query]) =>
          String(query).includes('otp_allowlists') &&
          String(query).includes('FOR UPDATE'),
      ),
    ).toBe(true);
    expect(lockCallOrder).toEqual([
      'advisory',
      'advisory',
      'row-lock',
      'row-lock',
    ]);
    expect(
      JSON.stringify([...advisoryCalls, ...addressCalls]),
    ).not.toContain(context.clientIp);
  });

  it('does not call absent raw methods', async () => {
    for (const rawCapabilities of [
      'query-only',
      'execute-only',
      'none',
    ] as const) {
      const { service, allowlist, prisma } = installService(
        undefined,
        rawCapabilities,
      );
      vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);

      await expect(
        service.request({ email: EMAIL, purpose: 'SESSION_LOGIN' }, context),
      ).resolves.toEqual({ accepted: true });

      const queryRaw = Reflect.get(prisma, '$queryRaw') as
        | MockFunction
        | undefined;
      const executeRaw = Reflect.get(prisma, '$executeRaw') as
        | MockFunction
        | undefined;

      if (rawCapabilities === 'query-only') {
        expect(queryRaw).toBeDefined();
        expect(queryRaw).not.toHaveBeenCalled();
        expect(executeRaw).toBeUndefined();
      } else if (rawCapabilities === 'execute-only') {
        expect(queryRaw).toBeUndefined();
        expect(executeRaw).toBeDefined();
        expect(executeRaw).not.toHaveBeenCalled();
      } else {
        expect(queryRaw).toBeUndefined();
        expect(executeRaw).toBeUndefined();
      }
    }
  });

  it('fails closed for an incomplete production transaction client', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEncryptionKey = process.env.OTP_DELIVERY_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    process.env.OTP_DELIVERY_ENCRYPTION_KEY =
      'otp-delivery-encryption-test-secret';
    try {
      for (const rawCapabilities of [
        'query-only',
        'execute-only',
        'none',
      ] as const) {
        const { service, allowlist, prisma } = installService(
          undefined,
          rawCapabilities,
        );
        vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);

        await expect(
          service.request({ email: EMAIL, purpose: 'SESSION_LOGIN' }, context),
        ).rejects.toThrow('OTP transaction client is missing raw lock capabilities');
        expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
      }
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEncryptionKey === undefined) {
        delete process.env.OTP_DELIVERY_ENCRYPTION_KEY;
      } else {
        process.env.OTP_DELIVERY_ENCRYPTION_KEY = originalEncryptionKey;
      }
    }
  });

  it('atomically consumes a valid code and resolves the current user', async () => {
    const metricSink = { recordAuthAttempt: vi.fn() };
    const { service, allowlist, prisma } = installService(metricSink);
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
    expect(metricSink.recordAuthAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', '000000'],
    ['expired', '123456'],
    ['consumed', '123456'],
    ['attempt-limited', '123456'],
  ])('fails closed for %s challenges', async (kind, code) => {
    const metricSink = { recordAuthAttempt: vi.fn() };
    const { service, allowlist, prisma } = installService(metricSink);
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
      service.verify({ email: EMAIL, purpose: 'SESSION_LOGIN', code }, context),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OTP_INVALID_OR_EXPIRED' }),
    });
    expect(metricSink.recordAuthAttempt).toHaveBeenCalledTimes(1);
    expect(metricSink.recordAuthAttempt).toHaveBeenCalledWith('failure');
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

  it('marks unavailable authentication dependencies as dependency_failure', async () => {
    const metricSink = { recordAuthAttempt: vi.fn() };
    const { service, prisma } = installService(metricSink);
    prisma.$transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.verify(
        { email: EMAIL, purpose: 'SESSION_LOGIN', code: '123456' },
        context,
      ),
    ).rejects.toThrow('database unavailable');
    expect(metricSink.recordAuthAttempt).toHaveBeenCalledTimes(1);
    expect(metricSink.recordAuthAttempt).toHaveBeenCalledWith(
      'dependency_failure',
    );
  });

  it('does not share an OTP client bucket across trusted forwarded clients or honor untrusted spoofing', async () => {
    const rules = parseTrustedProxyList('172.31.28.0/24');
    const firstIp = resolveTrustedClientIp(
      {
        socket: { remoteAddress: '172.31.28.2' },
        headers: { 'x-forwarded-for': '203.0.113.10' },
      },
      rules,
    );
    const secondIp = resolveTrustedClientIp(
      {
        socket: { remoteAddress: '172.31.28.2' },
        headers: { 'x-forwarded-for': '203.0.113.11' },
      },
      rules,
    );
    const spoofedIp = resolveTrustedClientIp(
      {
        socket: { remoteAddress: '198.51.100.8' },
        headers: {
          'x-forwarded-for': '203.0.113.10, 198.51.100.9',
          'x-real-ip': '203.0.113.10',
          forwarded: 'for=203.0.113.10',
        },
      },
      rules,
    );
    expect(firstIp).toBe('203.0.113.10');
    expect(secondIp).toBe('203.0.113.11');
    expect(spoofedIp).toBe('198.51.100.8');

    const { service, allowlist, prisma } = installService();
    vi.spyOn(allowlist, 'findEligible').mockResolvedValue(ALLOWLIST);
    const hashes = new Set<string>();
    for (const clientIp of [firstIp, secondIp, spoofedIp]) {
      prisma.otpChallenge.create.mockClear();
      await service.request(
        { email: EMAIL, purpose: 'SESSION_LOGIN' },
        { ...context, clientIp, clientFingerprint: undefined },
      );
      const created = prisma.otpChallenge.create.mock.calls[0]?.[0] as {
        data: { clientIpHash: string | null };
      };
      expect(created.data.clientIpHash).toEqual(expect.any(String));
      expect(JSON.stringify(prisma.otpChallenge.create.mock.calls)).not.toContain(clientIp);
      hashes.add(created.data.clientIpHash ?? '');
    }
    expect(hashes.size).toBe(3);
  });
});
