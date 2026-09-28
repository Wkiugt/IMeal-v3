import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService, type SessionMetadata } from './session.service.js';

const prisma = {
  authSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return prisma;
    }
  },
}));

const metadata: SessionMetadata = {
  deviceId: 'device-1',
  clientIp: '198.51.100.10',
  userAgent: 'test-agent',
};

const activeUser = {
  id: 'u1',
  email: 'employee@example.test',
  name: 'Employee',
  isActive: true,
  userRoles: [
    {
      role: {
        name: 'staff',
        rolePermissions: [{ permission: { name: 'registration.read' } }],
      },
    },
  ],
  userPermissions: [{ permission: { name: 'profile.read' } }],
};

function sessionRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-24T03:00:00.000Z');
  return {
    id: 'session-1',
    userId: 'u1',
    tokenHash: 'stored-hash',
    purpose: 'SESSION_LOGIN',
    authMethod: 'EMAIL_OTP',
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt: new Date(now.getTime() + 1_800_000),
    absoluteExpiresAt: new Date(now.getTime() + 604_800_000),
    revokedAt: null,
    revokedReason: null,
    deviceIdHash: 'device-hash',
    clientIpHash: 'ip-hash',
    userAgentHash: 'agent-hash',
    requestId: 'request-1',
    auditEventId: 'audit-1',
    user: activeUser,
    ...overrides,
  };
}

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prisma.authSession.create.mockResolvedValue({ id: 'session-1' });
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    process.env.NODE_ENV = 'test';
    delete process.env.SESSION_IDLE_TIMEOUT_SECONDS;
    delete process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS;
    service = new SessionService(prisma as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an opaque token while storing only its one-way hash', async () => {
    const result = await service.create({
      userId: 'u1',
      purpose: 'SESSION_LOGIN',
      requestId: 'r1',
      metadata,
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(result.token).not.toContain('u1');
    expect(prisma.authSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          userId: 'u1',
          requestId: 'r1',
          auditEventId: 'audit-1',
        }),
      }),
    );
    expect(JSON.stringify(prisma.authSession.create.mock.calls)).not.toContain(
      result.token,
    );
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      result.token,
    );
  });

  it('rechecks current account status and permissions on every resolve', async () => {
    vi.setSystemTime(new Date('2026-09-24T03:01:00.000Z'));
    prisma.authSession.findUnique.mockResolvedValue(sessionRecord());

    const resolved = await service.resolve('opaque-token');

    expect(resolved).toEqual({
      id: 'u1',
      userId: 'u1',
      email: 'employee@example.test',
      name: 'Employee',
      roles: ['staff'],
      permissions: ['registration.read', 'profile.read'],
      isActive: true,
      sessionId: 'session-1',
    });
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }),
    );
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'session-1', revokedAt: null }),
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects a disabled account and records an account-disabled revocation', async () => {
    prisma.authSession.findUnique.mockResolvedValue(
      sessionRecord({ user: { ...activeUser, isActive: false } }),
    );

    await expect(service.resolve('opaque-token')).resolves.toBeNull();
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', revokedAt: null },
        data: expect.objectContaining({ revokedReason: 'ACCOUNT_DISABLED' }),
      }),
    );
  });

  it('revokes expired sessions and all supported administrative reasons', async () => {
    const reasons = [
      'LOGOUT',
      'ACCOUNT_DISABLED',
      'COMPROMISED',
      'OTP_REPLAY',
      'ADMIN_REVOKED',
      'EXPIRED',
    ] as const;

    for (const reason of reasons) {
      await service.revoke('session-1', reason, 'request-2');
    }

    expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(reasons.length);
    for (const reason of reasons) {
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: reason },
      });
    }
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(reasons.length);
  });

  it('rejects revoked and expired sessions without returning a principal', async () => {
    vi.setSystemTime(new Date('2026-09-24T03:00:00.000Z'));
    prisma.authSession.findUnique.mockResolvedValue(
      sessionRecord({
        idleExpiresAt: new Date('2026-09-24T02:59:59.000Z'),
      }),
    );

    await expect(service.resolve('opaque-token')).resolves.toBeNull();
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedReason: 'EXPIRED' }),
      }),
    );

    prisma.authSession.findUnique.mockResolvedValue(
      sessionRecord({ revokedAt: new Date(), revokedReason: 'LOGOUT' }),
    );
    await expect(service.resolve('opaque-token')).resolves.toBeNull();
  });
});
