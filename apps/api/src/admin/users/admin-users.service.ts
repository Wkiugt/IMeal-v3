import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AuthSession, type User } from '@imeal/core';
import { v1 } from '@imeal/contracts';
import { getBusinessDate, parseMealDate } from '../../common/business-time.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { PrismaService } from '../../common/prisma.service.js';
import { lockUserLifecycle } from '../../common/transaction-locks.js';
import { displayNotificationName } from '../../notifications/notification-copy.js';

const MANAGED_ROLES = ['staff', 'kitchen'] as const;
const PREVIEW_ITEM_CAP = 25;
const LIFECYCLE_ACTIONS = new Set<v1.AdminUserAuditAction>([
  'USER_ROLES_UPDATED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_SESSIONS_REVOKED',
]);

type RoleRow = { role: { name: string } };
type UserWithRoles = User & { userRoles: RoleRow[] };

type AssignmentRow = {
  id: string;
  employeeCode: string;
  role: string;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  location: {
    id: string;
    shortCode: string;
    displayName: string;
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  };
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function managedRoles(allRoles: string[]): v1.AdminManagedRole[] {
  return MANAGED_ROLES.filter((name) => allRoles.includes(name));
}

function safeLocation(assignment: AssignmentRow | undefined) {
  if (!assignment) return null;
  return {
    id: assignment.location.id,
    shortCode: assignment.location.shortCode,
    displayName: assignment.location.displayName,
  };
}

function activeSessionWhere(userId: string, now: Date) {
  return {
    userId,
    revokedAt: null,
    absoluteExpiresAt: { gt: now },
    OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }],
  } satisfies Prisma.AuthSessionWhereInput;
}

type SafeAuditValue = string | number | boolean | null | v1.AdminManagedRole[];

function parseAuditDetails(value: string | null): {
  targetUserId: string;
  details: Record<string, SafeAuditValue>;
} | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const details: Record<string, SafeAuditValue> = {};
  for (const [key, item] of Object.entries(parsed)) {
    const safeArray =
      Array.isArray(item) &&
      item.length <= 2 &&
      item.every((entry) => entry === 'staff' || entry === 'kitchen');
    if (
      /(token|hash|secret|password|otp|gps|coordinate|provider|authorization)/i.test(
        key,
      ) ||
      (!safeArray &&
        typeof item !== 'string' &&
        typeof item !== 'number' &&
        typeof item !== 'boolean' &&
        item !== null)
    ) {
      return null;
    }
    details[key] = safeArray ? (item as v1.AdminManagedRole[]) : item;
  }
  const targetUserId = details.targetUserId;
  if (typeof targetUserId !== 'string' || targetUserId.length === 0) {
    return null;
  }
  return { targetUserId, details };
}

function pageMeta(page: number, limit: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async assignment(
    user: { id: string; email: string },
    at: Date,
  ): Promise<AssignmentRow | undefined> {
    const rows = await this.prisma.employeeLocationAssignment.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [
              { userId: user.id },
              { normalizedEmail: user.email.trim().toLowerCase() },
            ],
          },
          { effectiveFrom: { lte: at } },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        ],
        location: {
          is: {
            isActive: true,
            effectiveFrom: { lte: at },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
          },
        },
      },
      include: { location: true },
      orderBy: { id: 'asc' },
    });
    return rows.length === 1 ? (rows[0] as AssignmentRow) : undefined;
  }

  private async userOrThrow(userId: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!user) throw new NotFoundException('Admin user not found.');
    return user as UserWithRoles;
  }

  private async sessionCounts(userId: string, now: Date) {
    const [activeCount, totalCount] = await Promise.all([
      this.prisma.authSession.count({ where: activeSessionWhere(userId, now) }),
      this.prisma.authSession.count({ where: { userId } }),
    ]);
    return { activeCount, totalCount };
  }

  private lifecycleAuditWhere(
    userId: string,
    filters: { action?: v1.AdminUserAuditAction; from?: Date; to?: Date } = {},
  ): Prisma.AuditLogWhereInput {
    const unsafeDetails = [
      'token',
      'hash',
      'secret',
      'password',
      'otp',
      'gps',
      'coordinate',
      'provider',
      'authorization',
    ];
    return {
      action: filters.action ?? { in: [...LIFECYCLE_ACTIONS] },
      details: { contains: `"targetUserId":"${userId}"` },
      AND: unsafeDetails.map((fragment) => ({
        details: { not: { contains: fragment } },
      })),
      createdAt: { gte: filters.from, lte: filters.to },
    };
  }

  private async lifecycleAuditEntries(
    userId: string,
    filters: { action?: v1.AdminUserAuditAction; from?: Date; to?: Date } = {},
    paging: { skip?: number; take?: number } = {},
  ): Promise<v1.AdminUserAuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.lifecycleAuditWhere(userId, filters),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: paging.skip,
      take: paging.take,
    });
    const entries: v1.AdminUserAuditEntry[] = [];
    for (const row of rows) {
      const parsed = parseAuditDetails(row.details);
      if (!parsed || parsed.targetUserId !== userId) continue;
      const result = v1.AdminUserAuditEntrySchema.safeParse({
        id: row.id,
        action: row.action,
        actorUserId: row.userId,
        targetUserId: parsed.targetUserId,
        createdAt: row.createdAt.toISOString(),
        details: parsed.details,
      });
      if (result.success) entries.push(result.data);
    }
    return entries;
  }

  private async auditSummary(userId: string) {
    const [entries, grouped] = await Promise.all([
      this.lifecycleAuditEntries(userId, {}, { take: 25 }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: this.lifecycleAuditWhere(userId),
        _count: { _all: true },
      }),
    ]);
    const actionCounts: Record<string, number> = {};
    for (const row of grouped) actionCounts[row.action] = row._count._all;
    return { recent: entries, actionCounts };
  }

  async list(
    query: v1.AdminUserListQuery,
    now = new Date(),
  ): Promise<v1.AdminUserListResponse> {
    const where: Prisma.UserWhereInput = {};
    if (query.status === 'ACTIVE') where.isActive = true;
    if (query.status === 'DISABLED') where.isActive = false;
    let assignmentEmails: string[] = [];
    if (query.search) {
      const assignments = await this.prisma.employeeLocationAssignment.findMany(
        {
          where: {
            employeeCode: { contains: query.search, mode: 'insensitive' },
          },
          select: { normalizedEmail: true },
        },
      );
      assignmentEmails = [
        ...new Set(assignments.map(({ normalizedEmail }) => normalizedEmail)),
      ];
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        ...(assignmentEmails.length > 0
          ? [{ email: { in: assignmentEmails } }]
          : []),
      ];
    }
    if (query.role === 'admin') {
      where.userRoles = { some: { role: { name: 'admin' } } };
    } else if (query.role === 'staff' || query.role === 'kitchen') {
      where.userRoles = { some: { role: { name: query.role } } };
    } else if (query.role === 'unmanaged') {
      where.userRoles = {
        none: { role: { name: { in: [...MANAGED_ROLES] } } },
      };
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ name: 'asc' }, { email: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          userRoles: { select: { role: { select: { name: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const items: v1.AdminUserListItem[] = [];
    for (const user of users) {
      const roles = user.userRoles.map(({ role }) => role.name);
      const assignment = await this.assignment(user, now);
      items.push({
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        managedRoles: managedRoles(roles),
        employeeCode: assignment?.employeeCode ?? null,
        effectiveServiceLocation: safeLocation(assignment),
        activeSessionCount: await this.prisma.authSession.count({
          where: activeSessionWhere(user.id, now),
        }),
      });
    }
    return {
      items,
      pagination: pageMeta(query.page, query.limit, total),
    };
  }

  async detail(userId: string, now = new Date()): Promise<v1.AdminUserDetail> {
    const user = await this.userOrThrow(userId);
    const roles = user.userRoles.map(({ role }) => role.name);
    const assignment = await this.assignment(user, now);
    const [allowlist, sessions, auditSummary] = await Promise.all([
      this.prisma.otpAllowlist.findFirst({
        where: {
          userId,
          purpose: 'SESSION_LOGIN',
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.sessionCounts(userId, now),
      this.auditSummary(userId),
    ]);
    const lifecycleEntries = (
      await Promise.all(
        [...LIFECYCLE_ACTIONS].map((action) =>
          this.lifecycleAuditEntries(userId, { action }, { take: 1 }),
        ),
      )
    ).flat();
    const timestampFor = (action: v1.AdminUserAuditAction): string | null =>
      lifecycleEntries.find((entry) => entry.action === action)?.createdAt ??
      null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      managedRoles: managedRoles(roles),
      allRoles: roles,
      employeeCode: assignment?.employeeCode ?? null,
      effectiveServiceLocation: safeLocation(assignment),
      rosterAssignment: assignment
        ? {
            id: assignment.id,
            employeeCode: assignment.employeeCode,
            rosterRole: assignment.role,
            isActive: assignment.isActive,
            effectiveFrom: assignment.effectiveFrom.toISOString(),
            effectiveTo: iso(assignment.effectiveTo),
            serviceLocation: safeLocation(assignment),
          }
        : null,
      allowlist: allowlist
        ? {
            state: allowlist.state,
            effectiveFrom: allowlist.effectiveFrom.toISOString(),
            effectiveTo: iso(allowlist.effectiveTo),
          }
        : null,
      sessions,
      lifecycle: {
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        lastRoleChangeAt: timestampFor('USER_ROLES_UPDATED'),
        lastDisableAt: timestampFor('USER_DISABLED'),
        lastEnableAt: timestampFor('USER_ENABLED'),
        lastSessionRevokeAt: timestampFor('USER_SESSIONS_REVOKED'),
      },
      auditSummary,
    };
  }

  async updateRoles(
    userId: string,
    roles: v1.AdminManagedRole[],
    actorUserId: string,
  ): Promise<v1.AdminUserRolesUpdateResponse> {
    if (
      new Set(roles).size !== roles.length ||
      roles.some((role) => !MANAGED_ROLES.includes(role))
    ) {
      throw new BadRequestException('Invalid managed roles.');
    }
    return this.prisma.$transaction(async (tx) => {
      await lockUserLifecycle(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            select: { roleId: true, role: { select: { name: true } } },
          },
        },
      });
      if (!user) throw new NotFoundException('Admin user not found.');
      const roleRows = await tx.role.findMany({
        where: { name: { in: [...MANAGED_ROLES] } },
        select: { id: true, name: true },
      });
      if (roleRows.length !== MANAGED_ROLES.length) {
        throw new ConflictException({
          code: 'ADMIN_MANAGED_ROLES_UNAVAILABLE',
          message: 'Managed roles are not provisioned.',
        });
      }
      const previous = user.userRoles.map(({ role }) => role.name);
      const previousManaged = managedRoles(previous);
      const desired = new Set(roles);
      const remove = user.userRoles
        .filter(
          ({ role }) =>
            MANAGED_ROLES.includes(role.name as v1.AdminManagedRole) &&
            !desired.has(role.name as v1.AdminManagedRole),
        )
        .map(({ roleId }) => roleId);
      if (remove.length) {
        await tx.userRole.deleteMany({
          where: { userId, roleId: { in: remove } },
        });
      }
      const add = roleRows
        .filter(
          ({ name }) =>
            desired.has(name as v1.AdminManagedRole) &&
            !user.userRoles.some(({ role }) => role.name === name),
        )
        .map(({ id }) => ({ userId, roleId: id }));
      if (add.length)
        await tx.userRole.createMany({ data: add, skipDuplicates: true });
      const changed = remove.length > 0 || add.length > 0;
      if (changed) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'USER_ROLES_UPDATED',
            details: JSON.stringify({
              targetUserId: userId,
              previousManagedRoles: previousManaged,
              nextManagedRoles: roles,
            }),
          },
        });
      }
      return {
        userId,
        managedRoles: roles,
        allRoles: [
          ...previous.filter(
            (name) => !MANAGED_ROLES.includes(name as v1.AdminManagedRole),
          ),
          ...roles,
        ],
        changed,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  private async previewRows(userId: string, now: Date) {
    const from = parseMealDate(getBusinessDate(now));
    const registrations = await this.prisma.registration.findMany({
      where: {
        userId,
        mealDate: { gte: from },
        status: 'ACTIVE',
        mealServing: null,
        penalties: { none: {} },
      },
      orderBy: [{ mealDate: 'asc' }, { id: 'asc' }],
      include: { serviceLocation: true },
    });
    const ownerDelegations = await this.prisma.pickupDelegation.findMany({
      where: {
        status: { in: ['PENDING', 'ACCEPTED'] },
        registration: {
          userId,
          mealDate: { gte: from },
          status: 'ACTIVE',
          mealServing: null,
          penalties: { none: {} },
        },
      },
      orderBy: [{ registrationId: 'asc' }, { id: 'asc' }],
      include: { registration: true },
    });
    const incomingDelegations = await this.prisma.pickupDelegation.findMany({
      where: {
        delegateUserId: userId,
        status: { in: ['PENDING', 'ACCEPTED'] },
        registration: {
          mealDate: { gte: from },
          status: 'ACTIVE',
          mealServing: null,
          penalties: { none: {} },
        },
      },
      orderBy: [{ registrationId: 'asc' }, { id: 'asc' }],
      include: { registration: true },
    });
    const toRegistration = (registration: (typeof registrations)[number]) => ({
      id: registration.id,
      mealDate: registration.mealDate.toISOString().slice(0, 10),
      serviceLocation: registration.serviceLocation
        ? {
            id: registration.serviceLocation.id,
            shortCode: registration.serviceLocation.shortCode,
            displayName: registration.serviceLocation.displayName,
          }
        : null,
    });
    const toDelegation = (delegation: (typeof ownerDelegations)[number]) => ({
      id: delegation.id,
      registrationId: delegation.registrationId,
      mealDate: delegation.registration.mealDate.toISOString().slice(0, 10),
      status: delegation.status as 'PENDING' | 'ACCEPTED',
    });
    return {
      from,
      registrations,
      ownerDelegations,
      incomingDelegations,
      registrationItems: registrations
        .slice(0, PREVIEW_ITEM_CAP)
        .map(toRegistration),
      ownerItems: ownerDelegations.slice(0, PREVIEW_ITEM_CAP).map(toDelegation),
      incomingItems: incomingDelegations
        .slice(0, PREVIEW_ITEM_CAP)
        .map(toDelegation),
    };
  }

  async previewDisable(
    userId: string,
    now = new Date(),
  ): Promise<v1.AdminUserDisablePreviewResponse> {
    const user = await this.userOrThrow(userId);
    const roles = user.userRoles.map(({ role }) => role.name);
    const [rows, activeSessionCount] = await Promise.all([
      this.previewRows(userId, now),
      this.prisma.authSession.count({ where: activeSessionWhere(userId, now) }),
    ]);
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      managedRoles: managedRoles(roles),
      allRoles: roles,
      activeSessionCount,
      actionableFromDate: getBusinessDate(now),
      generatedAt: now.toISOString(),
      registrations: {
        count: rows.registrations.length,
        items: rows.registrationItems,
      },
      outgoingDelegations: {
        count: rows.ownerDelegations.length,
        items: rows.ownerItems,
      },
      incomingDelegations: {
        count: rows.incomingDelegations.length,
        items: rows.incomingItems,
      },
    };
  }

  private async revokeDelegation(
    tx: Prisma.TransactionClient,
    delegationId: string,
    actorUserId: string,
    reason: 'ACCOUNT_DISABLED' | 'REGISTRATION_CANCELLED',
  ): Promise<number> {
    const delegation = await tx.pickupDelegation.findUnique({
      where: { id: delegationId },
      include: {
        registration: {
          include: { user: { select: { name: true, email: true } } },
        },
        delegateUser: { select: { id: true } },
      },
    });
    if (!delegation || !['PENDING', 'ACCEPTED'].includes(delegation.status)) {
      return 0;
    }
    await tx.pickupDelegation.update({
      where: { id: delegation.id },
      data: { status: 'REVOKED' },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'delegation_revoked',
        details: `Delegation ${delegation.id} revoked because registration ${delegation.registrationId} was disabled`,
      },
    });
    await this.notificationsService.publish(tx, {
      userId: delegation.delegateUserId,
      kind: 'DELEGATION_REVOKED',
      payload: {
        delegationId: delegation.id,
        registrationId: delegation.registrationId,
        mealDate: delegation.registration.mealDate.toISOString().slice(0, 10),
        counterpartName: displayNotificationName(delegation.registration.user),
        reason,
      },
      dedupeKey: `delegation-revoked:${delegation.delegateUserId}:${delegation.id}`,
    });
    return 1;
  }

  async disable(
    userId: string,
    actorUserId: string,
    now = new Date(),
  ): Promise<v1.AdminUserDisableResponse> {
    if (userId === actorUserId) {
      throw new ConflictException({
        code: 'ADMIN_SELF_DISABLE_FORBIDDEN',
        message: 'Cannot disable your own account.',
      });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUserLifecycle(tx);
      const from = parseMealDate(getBusinessDate(now));
      const ownerRows = await tx.registration.findMany({
        where: { userId, mealDate: { gte: from }, status: 'ACTIVE' },
        orderBy: [{ mealDate: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const firstIncoming = await tx.pickupDelegation.findMany({
        where: {
          delegateUserId: userId,
          status: { in: ['PENDING', 'ACCEPTED'] },
          registration: { mealDate: { gte: from }, status: 'ACTIVE' },
        },
        orderBy: [{ registrationId: 'asc' }, { id: 'asc' }],
        select: { id: true, registrationId: true },
      });
      const ownerRegistrationIds = new Set(ownerRows.map(({ id }) => id));
      const lockedRegistrationIds = new Set<string>();
      const initialRegistrationIds = [
        ...ownerRows.map((row) => row.id),
        ...firstIncoming.map((row) => row.registrationId),
      ];
      for (const id of initialRegistrationIds) {
        if (lockedRegistrationIds.has(id)) continue;
        lockedRegistrationIds.add(id);
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isActive: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      });
      if (!target) throw new NotFoundException('Admin user not found.');
      if (!target.isActive) {
        return {
          registrationsCancelled: 0,
          delegationsRevoked: 0,
          sessionsRevoked: 0,
          changed: false,
        };
      }
      if (target.userRoles.some(({ role }) => role.name === 'admin')) {
        const activeAdmins = await tx.user.count({
          where: {
            id: { not: userId },
            isActive: true,
            userRoles: { some: { role: { name: 'admin' } } },
            otpAllowlistRecords: {
              some: {
                purpose: 'SESSION_LOGIN',
                state: 'ACTIVE',
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
              },
            },
          },
        });
        if (activeAdmins === 0) {
          throw new ConflictException({
            code: 'ADMIN_LAST_ACTIVE_ADMIN',
            message: 'Cannot disable the last active admin.',
          });
        }
      }

      const committedOwners = await tx.registration.findMany({
        where: { userId, mealDate: { gte: from }, status: 'ACTIVE' },
        orderBy: [{ mealDate: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      for (const owner of committedOwners) {
        ownerRegistrationIds.add(owner.id);
        if (lockedRegistrationIds.has(owner.id)) continue;
        lockedRegistrationIds.add(owner.id);
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${owner.id} FOR UPDATE`;
      }

      // Re-query after the target user lock so a delegation that committed
      // during initial discovery is included.
      const committedIncoming = await tx.pickupDelegation.findMany({
        where: {
          delegateUserId: userId,
          status: { in: ['PENDING', 'ACCEPTED'] },
          registration: { mealDate: { gte: from }, status: 'ACTIVE' },
        },
        orderBy: [{ registrationId: 'asc' }, { id: 'asc' }],
        select: { id: true, registrationId: true },
      });
      for (const row of committedIncoming) {
        if (lockedRegistrationIds.has(row.registrationId)) continue;
        lockedRegistrationIds.add(row.registrationId);
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${row.registrationId} FOR UPDATE`;
      }

      let registrationsCancelled = 0;
      let delegationsRevoked = 0;
      for (const ownerId of ownerRegistrationIds) {
        const registration = await tx.registration.findUnique({
          where: { id: ownerId },
          include: {
            mealServing: true,
            penalties: { select: { id: true } },
          },
        });
        if (
          !registration ||
          registration.status !== 'ACTIVE' ||
          registration.mealServing ||
          registration.penalties.length > 0
        ) {
          continue;
        }
        await tx.registration.update({
          where: { id: ownerId },
          data: {
            status: 'CANCELLED',
            version: { increment: 1 },
            cancelledAt: now,
            cancelReason: 'ACCOUNT_DISABLED',
            cancelledByUserId: actorUserId,
          },
        });
        registrationsCancelled += 1;
        const delegations = await tx.pickupDelegation.findMany({
          where: {
            registrationId: ownerId,
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
          select: { id: true },
        });
        for (const delegation of delegations) {
          delegationsRevoked += await this.revokeDelegation(
            tx,
            delegation.id,
            actorUserId,
            'ACCOUNT_DISABLED',
          );
        }
      }
      const incoming = await tx.pickupDelegation.findMany({
        where: {
          delegateUserId: userId,
          status: { in: ['PENDING', 'ACCEPTED'] },
          registrationId: {
            in: committedIncoming.map(({ registrationId }) => registrationId),
          },
        },
        include: {
          registration: {
            select: {
              status: true,
              mealServing: { select: { id: true } },
              penalties: { select: { id: true } },
            },
          },
        },
      });
      for (const delegation of incoming) {
        if (
          delegation.registration.status !== 'ACTIVE' ||
          delegation.registration.mealServing ||
          delegation.registration.penalties.length > 0
        ) {
          continue;
        }
        delegationsRevoked += await this.revokeDelegation(
          tx,
          delegation.id,
          actorUserId,
          'ACCOUNT_DISABLED',
        );
      }
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });
      const sessions = await tx.authSession.updateMany({
        where: activeSessionWhere(userId, now),
        data: { revokedAt: now, revokedReason: 'ACCOUNT_DISABLED' },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'USER_DISABLED',
          details: JSON.stringify({
            targetUserId: userId,
            registrationsCancelled,
            delegationsRevoked,
            sessionsRevoked: sessions.count,
          }),
        },
      });
      return {
        registrationsCancelled,
        delegationsRevoked,
        sessionsRevoked: sessions.count,
        changed: true,
      };
    });
    return {
      userId,
      isActive: false,
      changed: result.changed,
      affected: {
        registrationsCancelled: result.registrationsCancelled,
        delegationsRevoked: result.delegationsRevoked,
        sessionsRevoked: result.sessionsRevoked,
      },
      auditCreated: result.changed,
      completedAt: now.toISOString(),
    };
  }

  async enable(
    userId: string,
    actorUserId: string,
    now = new Date(),
  ): Promise<v1.AdminUserEnableResponse> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserLifecycle(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true },
      });
      if (!user) throw new NotFoundException('Admin user not found.');
      if (user.isActive) {
        return {
          userId,
          isActive: true as const,
          changed: false,
          auditCreated: false,
          completedAt: now.toISOString(),
        };
      }
      await tx.user.update({ where: { id: userId }, data: { isActive: true } });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'USER_ENABLED',
          details: JSON.stringify({ targetUserId: userId }),
        },
      });
      return {
        userId,
        isActive: true as const,
        changed: true,
        auditCreated: true,
        completedAt: now.toISOString(),
      };
    });
  }

  async sessions(
    userId: string,
    query: v1.AdminUserSessionsQuery,
    now = new Date(),
  ): Promise<v1.AdminUserSessionsResponse> {
    await this.userOrThrow(userId);
    const where: Prisma.AuthSessionWhereInput = query.includeRevoked
      ? { userId }
      : activeSessionWhere(userId, now);
    const [rows, total] = await Promise.all([
      this.prisma.authSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.authSession.count({ where }),
    ]);
    return {
      items: rows.map((session: AuthSession) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: iso(session.lastUsedAt),
        idleExpiresAt: iso(session.idleExpiresAt),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        revokedAt: iso(session.revokedAt),
        revokedReason: session.revokedReason,
        isActive:
          session.revokedAt === null &&
          session.absoluteExpiresAt > now &&
          (session.idleExpiresAt === null || session.idleExpiresAt > now),
      })),
      pagination: pageMeta(query.page, query.limit, total),
    };
  }

  async revokeAllSessions(
    userId: string,
    actorUserId: string,
    now = new Date(),
  ): Promise<v1.AdminUserRevokeAllResponse> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserLifecycle(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true },
      });
      if (!user) throw new NotFoundException('Admin user not found.');
      const result = await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'ADMIN_REVOKED' },
      });
      if (result.count > 0) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'USER_SESSIONS_REVOKED',
            details: JSON.stringify({
              targetUserId: userId,
              revokedCount: result.count,
            }),
          },
        });
      }
      return {
        userId,
        isActive: user.isActive,
        revokedCount: result.count,
        reason: 'ADMIN_REVOKED' as const,
        changed: result.count > 0,
        auditCreated: result.count > 0,
        completedAt: now.toISOString(),
      };
    });
  }

  async audit(
    userId: string,
    query: v1.AdminUserAuditQuery,
  ): Promise<v1.AdminUserAuditResponse> {
    await this.userOrThrow(userId);
    const filters = {
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };
    const skip = (query.page - 1) * query.limit;
    const [entries, total] = await Promise.all([
      this.lifecycleAuditEntries(userId, filters, {
        skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({
        where: this.lifecycleAuditWhere(userId, filters),
      }),
    ]);
    return {
      items: entries,
      pagination: pageMeta(query.page, query.limit, total),
    };
  }
}
