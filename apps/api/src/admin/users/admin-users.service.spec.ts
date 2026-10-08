import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service.js';

const target = {
  id: 'target-user',
  email: 'target@example.test',
  name: 'Target User',
  isActive: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

function role(name: string, id = `${name}-role`) {
  return { id, name };
}

function txMock() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        ...target,
        userRoles: [{ role: role('admin') }, { role: role('staff') }],
      }),
      update: vi.fn().mockResolvedValue({ ...target, isActive: false }),
      count: vi.fn().mockResolvedValue(2),
    },
    role: {
      findMany: vi.fn().mockResolvedValue([role('staff'), role('kitchen')]),
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([
        { roleId: 'admin-role', role: role('admin') },
        { roleId: 'staff-role', role: role('staff') },
      ]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    employeeLocationAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    registration: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    pickupDelegation: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
    },
    authSession: {
      count: vi.fn().mockResolvedValue(1),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    otpAllowlist: { findFirst: vi.fn().mockResolvedValue({ state: 'ACTIVE' }) },
  };
}

describe('AdminUsersService', () => {
  let prisma: ReturnType<typeof txMock>;
  let service: AdminUsersService;

  beforeEach(() => {
    prisma = txMock();
    const root = {
      ...prisma,
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) =>
        callback(prisma),
      ),
    };
    service = new AdminUsersService(
      root as never,
      { publish: vi.fn().mockResolvedValue(undefined) } as never,
    );
    vi.clearAllMocks();
  });

  it('replaces only managed roles and preserves admin', async () => {
    const result = await service.updateRoles(
      'target-user',
      ['kitchen'],
      'admin-user',
    );

    expect(prisma.userRole.deleteMany).toHaveBeenCalled();
    expect(prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'target-user', roleId: 'kitchen-role' }],
      skipDuplicates: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-user',
        action: 'USER_ROLES_UPDATED',
        details: expect.stringContaining('target-user'),
      }),
    });
    expect(result.managedRoles).toEqual(['kitchen']);
  });

  it('does not cancel an ACTIVE registration that already has a serving', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'served-registration' }])
      .mockResolvedValue([]);
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'served-registration',
        userId: 'target-user',
        mealDate: new Date('2026-10-02T00:00:00.000Z'),
        status: 'ACTIVE',
        mealServing: { id: 'serving-1' },
        penalties: [],
        delegations: [],
      },
    ]);

    const result = await service.disable('target-user', 'admin-user');

    expect(prisma.registration.update).not.toHaveBeenCalled();
    expect(result.affected.registrationsCancelled).toBe(0);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: { isActive: false },
    });
  });

  it('revokes only currently active sessions during disable', async () => {
    const now = new Date('2026-10-02T04:00:00.000Z');
    await service.disable('target-user', 'admin-user', now);

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'target-user',
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
        OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }],
      },
      data: { revokedAt: now, revokedReason: 'ACCOUNT_DISABLED' },
    });
  });

  it('revoke-all reports only newly revoked sessions and is idempotent', async () => {
    prisma.authSession.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await service.revokeAllSessions('target-user', 'admin-user');
    const second = await service.revokeAllSessions('target-user', 'admin-user');

    expect(first).toMatchObject({
      revokedCount: 2,
      reason: 'ADMIN_REVOKED',
      changed: true,
    });
    expect(second).toMatchObject({
      revokedCount: 0,
      reason: 'ADMIN_REVOKED',
      changed: false,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects self-disable and prevents last active admin disable', async () => {
    await expect(
      service.disable('admin-user', 'admin-user'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ADMIN_SELF_DISABLE_FORBIDDEN',
      }),
    });

    prisma.user.findUnique.mockResolvedValue({
      ...target,
      userRoles: [{ role: role('admin') }],
    });
    prisma.user.count.mockResolvedValue(0);
    await expect(
      service.disable('target-user', 'admin-user'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADMIN_LAST_ACTIVE_ADMIN' }),
    });

    prisma.user.count.mockResolvedValue(1);
    const allowed = await service.disable('target-user', 'admin-user');
    expect(allowed).toMatchObject({
      changed: true,
      affected: { sessionsRevoked: 1 },
    });
  });

  it('returns role lifecycle audit details with managed role arrays', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-role',
        action: 'USER_ROLES_UPDATED',
        userId: 'admin-user',
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        details: JSON.stringify({
          targetUserId: 'target-user',
          previousManagedRoles: ['staff'],
          nextManagedRoles: ['staff', 'kitchen'],
        }),
      },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);
    const result = await service.audit('target-user', { page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      action: 'USER_ROLES_UPDATED',
      details: {
        previousManagedRoles: ['staff'],
        nextManagedRoles: ['staff', 'kitchen'],
      },
    });
    expect(result.pagination.total).toBe(1);
  });

  it('finds email-only roster assignments when searching employee code', async () => {
    prisma.employeeLocationAssignment.findMany
      .mockResolvedValueOnce([{ normalizedEmail: target.email }])
      .mockResolvedValueOnce([
        {
          id: 'assignment-1',
          employeeCode: 'EMP-42',
          role: 'PRESENTER',
          isActive: true,
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
          effectiveTo: null,
          location: {
            id: 'location-1',
            shortCode: 'LOC-A',
            displayName: 'Location A',
            isActive: true,
            effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
            effectiveTo: null,
          },
        },
      ]);
    prisma.user.findMany.mockResolvedValue([
      {
        ...target,
        userRoles: [{ role: role('staff') }],
      },
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.list({
      page: 1,
      limit: 20,
      status: 'ALL',
      role: 'ALL',
      search: 'EMP-42',
    });

    expect(result.items[0]).toMatchObject({
      id: target.id,
      employeeCode: 'EMP-42',
      effectiveServiceLocation: {
        shortCode: 'LOC-A',
      },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ email: { in: [target.email] } }]),
        }),
      }),
    );
  });

  it('filters unsafe and unrelated lifecycle audit rows before pagination', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'unsafe',
        action: 'USER_DISABLED',
        userId: 'admin-user',
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
        details: JSON.stringify({
          targetUserId: 'target-user',
          tokenHash: 'secret',
        }),
      },
      {
        id: 'other',
        action: 'USER_ENABLED',
        userId: 'admin-user',
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        details: JSON.stringify({ targetUserId: 'other-user' }),
      },
      {
        id: 'valid',
        action: 'USER_ENABLED',
        userId: 'admin-user',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        details: JSON.stringify({ targetUserId: 'target-user' }),
      },
    ]);

    prisma.auditLog.count.mockResolvedValue(1);
    const result = await service.audit('target-user', { page: 1, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('valid');
    expect(result.pagination.total).toBe(1);
  });
});
