import { describe, expect, it } from 'vitest';
import { v1 } from '../src';

const timestamps = {
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

const location = {
  id: 'location-1',
  shortCode: 'HQ',
  displayName: 'Headquarters',
};

describe('admin user lifecycle contracts', () => {
  it('parses bounded user list filters and defaults', () => {
    const parsed = v1.AdminUserListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBeGreaterThan(0);
    expect(parsed.status).toBe('ALL');
    expect(parsed.role).toBe('ALL');
    expect(v1.AdminUserListQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      v1.AdminUserListQuerySchema.safeParse({ role: 'ADMIN' }).success,
    ).toBe(false);
  });

  it('parses strict role replacement while rejecting admin and duplicates', () => {
    expect(
      v1.AdminUserRolesUpdateRequestSchema.safeParse({
        roles: ['staff', 'kitchen'],
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserRolesUpdateRequestSchema.safeParse({
        roles: ['admin'],
      }).success,
    ).toBe(false);
    expect(
      v1.AdminUserRolesUpdateRequestSchema.safeParse({
        roles: ['staff', 'staff'],
      }).success,
    ).toBe(false);
    expect(
      v1.AdminUserRolesUpdateRequestSchema.safeParse({
        roles: ['staff'],
        managedRoles: ['staff'],
      }).success,
    ).toBe(false);
  });

  it('requires explicit disable confirmation and models safe sessions', () => {
    expect(
      v1.AdminUserDisableRequestSchema.safeParse({ confirm: true }).success,
    ).toBe(true);
    expect(v1.AdminUserDisableRequestSchema.safeParse({}).success).toBe(false);
    expect(
      v1.AdminUserSessionSchema.safeParse({
        id: 'session-1',
        createdAt: timestamps.createdAt,
        lastUsedAt: timestamps.updatedAt,
        idleExpiresAt: timestamps.updatedAt,
        absoluteExpiresAt: timestamps.updatedAt,
        revokedAt: null,
        revokedReason: null,
        isActive: true,
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserSessionSchema.safeParse({
        id: 'session-1',
        createdAt: timestamps.createdAt,
        lastUsedAt: timestamps.updatedAt,
        idleExpiresAt: timestamps.updatedAt,
        absoluteExpiresAt: timestamps.updatedAt,
        revokedAt: null,
        revokedReason: null,
        isActive: true,
        tokenHash: 'must-not-cross-wire',
      }).success,
    ).toBe(false);
  });

  it('parses boolean query values explicitly for session filters', () => {
    expect(
      v1.AdminUserSessionsQuerySchema.parse({ includeRevoked: 'false' })
        .includeRevoked,
    ).toBe(false);
    expect(
      v1.AdminUserSessionsQuerySchema.parse({ includeRevoked: 'true' })
        .includeRevoked,
    ).toBe(true);
    expect(
      v1.AdminUserSessionsQuerySchema.safeParse({ includeRevoked: 'maybe' })
        .success,
    ).toBe(false);
  });

  it('bounds preview samples while preserving separate complete counts', () => {
    const registration = (index: number) => ({
      id: `registration-${index}`,
      mealDate: `2026-10-${String(index).padStart(2, '0')}`,
      serviceLocation: null,
    });
    const preview = {
      userId: 'user-1',
      name: 'Employee',
      email: 'employee@example.test',
      isActive: true,
      managedRoles: ['staff'],
      allRoles: ['staff'],
      activeSessionCount: 0,
      actionableFromDate: '2026-10-02',
      generatedAt: timestamps.updatedAt,
      registrations: {
        count: 26,
        items: Array.from({ length: 26 }, (_, index) =>
          registration(index + 1),
        ),
      },
      outgoingDelegations: { count: 0, items: [] },
      incomingDelegations: { count: 0, items: [] },
    };
    expect(
      v1.AdminUserDisablePreviewResponseSchema.safeParse(preview).success,
    ).toBe(false);
  });

  it('parses detail, preview, mutation, and safe audit shapes', () => {
    const detail = {
      id: 'user-1',
      name: 'Employee',
      email: 'employee@example.test',
      isActive: true,
      managedRoles: ['staff'],
      allRoles: ['staff'],
      employeeCode: 'EMP-1',
      effectiveServiceLocation: location,
      rosterAssignment: {
        id: 'assignment-1',
        employeeCode: 'EMP-1',
        rosterRole: 'STAFF',
        isActive: true,
        effectiveFrom: timestamps.createdAt,
        effectiveTo: null,
        serviceLocation: location,
      },
      allowlist: {
        state: 'ACTIVE',
        effectiveFrom: timestamps.createdAt,
        effectiveTo: null,
      },
      sessions: { activeCount: 1, totalCount: 1 },
      lifecycle: {
        createdAt: timestamps.createdAt,
        updatedAt: timestamps.updatedAt,
        lastRoleChangeAt: null,
        lastDisableAt: null,
        lastEnableAt: null,
        lastSessionRevokeAt: null,
      },
      auditSummary: {
        recent: [],
        actionCounts: {},
      },
    };
    expect(v1.AdminUserDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      v1.AdminUserDisablePreviewResponseSchema.safeParse({
        userId: 'user-1',
        name: 'Employee',
        email: 'employee@example.test',
        isActive: true,
        managedRoles: ['staff'],
        allRoles: ['staff'],
        activeSessionCount: 1,
        actionableFromDate: '2026-10-02',
        generatedAt: timestamps.updatedAt,
        registrations: { count: 0, items: [] },
        outgoingDelegations: { count: 0, items: [] },
        incomingDelegations: { count: 0, items: [] },
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserDisableResponseSchema.safeParse({
        userId: 'user-1',
        isActive: false,
        changed: true,
        affected: {
          registrationsCancelled: 1,
          delegationsRevoked: 2,
          sessionsRevoked: 1,
        },
        auditCreated: true,
        completedAt: timestamps.updatedAt,
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserRevokeAllResponseSchema.safeParse({
        userId: 'user-1',
        isActive: true,
        revokedCount: 1,
        reason: 'ADMIN_REVOKED',
        changed: true,
        auditCreated: true,
        completedAt: timestamps.updatedAt,
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserAuditResponseSchema.safeParse({
        items: [
          {
            id: 'audit-1',
            action: 'USER_DISABLED',
            actorUserId: 'admin-1',
            targetUserId: 'user-1',
            createdAt: timestamps.updatedAt,
            details: { registrationsCancelled: 1 },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserAuditEntrySchema.safeParse({
        id: 'audit-roles',
        action: 'USER_ROLES_UPDATED',
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        createdAt: timestamps.updatedAt,
        details: {
          previousManagedRoles: ['staff'],
          nextManagedRoles: ['staff', 'kitchen'],
          targetUserId: 'user-1',
        },
      }).success,
    ).toBe(true);
    expect(
      v1.AdminUserAuditResponseSchema.safeParse({
        items: [
          {
            id: 'audit-1',
            action: 'USER_DISABLED',
            actorUserId: 'admin-1',
            targetUserId: 'user-1',
            createdAt: timestamps.updatedAt,
            details: { token: 'secret' },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      }).success,
    ).toBe(false);
  });
});
