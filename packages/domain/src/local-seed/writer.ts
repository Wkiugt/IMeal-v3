import { Prisma, PrismaClient } from '@prisma/client';

import type {
  LocalSeedPlan,
  SeedAllowlistRow,
  SeedAppSettingRow,
  SeedAssignmentRow,
  SeedDailyMenuRow,
  SeedDelegationRow,
  SeedLocationPolicyRow,
  SeedLocationRow,
  SeedMealDayRow,
  SeedMealEventRow,
  SeedMealServingRow,
  SeedMenuRevisionRow,
  SeedPenaltyRow,
  SeedPickupSessionRow,
  SeedRegistrationRow,
  SeedServingConfirmRequestRow,
  SeedServingVerificationRow,
  SeedUserRoleRow,
  SeedUserRow,
  SeedWriteOptions,
  SeedWriteResult,
  SeedWeeklyMenuRow,
} from './types.js';

const CANONICAL_ROLE_NAMES = ['staff', 'kitchen', 'admin'] as const;
type TransactionClient = Prisma.TransactionClient;

type WriteStats = Pick<SeedWriteResult, 'created' | 'updated' | 'unchanged'>;

type OperationContext = {
  entity: string;
  key: string;
};

class SeedOperationError extends Error {
  readonly entity: string;
  readonly key: string;
  readonly original: unknown;

  constructor(entity: string, key: string, original: unknown) {
    super(`local seed operation failed for ${entity} ${key}`);
    this.name = 'SeedOperationError';
    this.entity = entity;
    this.key = key;
    this.original = original;
  }
}

export class LocalSeedWriteError extends Error {
  readonly entity: string;
  readonly key: string;
  readonly code: string;

  constructor(entity: string, key: string, code: string) {
    super(`Local seed write failed for ${entity} ${key} (${code})`);
    this.name = 'LocalSeedWriteError';
    this.entity = entity;
    this.key = key;
    this.code = code;
  }
}

export async function writeLocalSeed(
  prisma: PrismaClient,
  plan: LocalSeedPlan,
  options: SeedWriteOptions = {},
): Promise<SeedWriteResult> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => writeTransaction(tx, plan),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const code = errorCode(error);
      if (code === 'P2034' && attempt < maxAttempts) {
        await sleep(25 * attempt);
        continue;
      }

      const context = operationContext(error);
      throw new LocalSeedWriteError(context.entity, context.key, code ?? 'UNKNOWN');
    }
  }

  throw new LocalSeedWriteError('transaction', 'local-seed', 'UNKNOWN');
}

export async function writeTransaction(
  tx: TransactionClient,
  plan: LocalSeedPlan,
): Promise<SeedWriteResult> {
  const stats: WriteStats = { created: 0, updated: 0, unchanged: 0 };
  const roleIds = await resolveCanonicalRoles(tx);

  for (const row of plan.users) {
    await upsertRow(
      stats,
      'users',
      row.id,
      () => tx.user.findUnique({ where: { id: row.id } }),
      () => tx.user.upsert({ where: { id: row.id }, create: userCreate(row), update: userUpdate(row) }),
      () => userUpdate(row),
    );
  }

  for (const row of plan.userRoles) {
    const roleId = roleIds.get(row.roleName);
    if (!roleId) {
      throw new SeedOperationError('roles', row.roleName, { code: 'ROLE_MISSING' });
    }
    const key = `${row.userId}:${row.roleName}`;
    await upsertRow(
      stats,
      'userRoles',
      key,
      () =>
        tx.userRole.findUnique({
          where: { userId_roleId: { userId: row.userId, roleId } },
        }),
      () =>
        tx.userRole.upsert({
          where: { userId_roleId: { userId: row.userId, roleId } },
          create: { userId: row.userId, roleId },
          update: {},
        }),
      () => ({}),
    );
  }

  for (const row of plan.locations) {
    await upsertRow(
      stats,
      'locations',
      row.id,
      () => tx.location.findUnique({ where: { id: row.id } }),
      () => tx.location.upsert({ where: { id: row.id }, create: locationCreate(row), update: locationUpdate(row) }),
      () => locationUpdate(row),
    );
  }

  for (const row of plan.locationPolicies) {
    await upsertRow(
      stats,
      'locationPolicies',
      row.id,
      () => tx.locationPolicy.findUnique({ where: { id: row.id } }),
      () =>
        tx.locationPolicy.upsert({
          where: { id: row.id },
          create: locationPolicyCreate(row),
          update: locationPolicyUpdate(row),
        }),
      () => locationPolicyUpdate(row),
    );
  }

  for (const row of plan.assignments) {
    await upsertRow(
      stats,
      'assignments',
      row.id,
      () => tx.employeeLocationAssignment.findUnique({ where: { id: row.id } }),
      () =>
        tx.employeeLocationAssignment.upsert({
          where: { id: row.id },
          create: assignmentCreate(row),
          update: assignmentUpdate(row),
        }),
      () => assignmentUpdate(row),
    );
  }

  for (const row of plan.allowlists) {
    await upsertRow(
      stats,
      'allowlists',
      row.id,
      () => tx.otpAllowlist.findUnique({ where: { id: row.id } }),
      () => tx.otpAllowlist.upsert({ where: { id: row.id }, create: allowlistCreate(row), update: allowlistUpdate(row) }),
      () => allowlistUpdate(row),
    );
  }

  await upsertRow(
    stats,
    'weeklyMenus',
    plan.weeklyMenu.id,
    () => tx.weeklyMenu.findUnique({ where: { id: plan.weeklyMenu.id } }),
    () =>
      tx.weeklyMenu.upsert({
        where: { id: plan.weeklyMenu.id },
        create: weeklyMenuCreate(plan.weeklyMenu),
        update: weeklyMenuUpdate(plan.weeklyMenu),
      }),
    () => weeklyMenuUpdate(plan.weeklyMenu),
  );

  for (const row of plan.dailyMenus) {
    await upsertRow(
      stats,
      'dailyMenus',
      row.id,
      () => tx.dailyMenu.findUnique({ where: { id: row.id } }),
      () => tx.dailyMenu.upsert({ where: { id: row.id }, create: dailyMenuCreate(row), update: dailyMenuUpdate(row) }),
      () => dailyMenuUpdate(row),
    );
  }

  for (const row of plan.mealDays) {
    await upsertRow(
      stats,
      'mealDays',
      row.id,
      () => tx.mealDay.findUnique({ where: { id: row.id } }),
      () => tx.mealDay.upsert({ where: { id: row.id }, create: mealDayCreate(row), update: mealDayUpdate(row) }),
      () => mealDayUpdate(row),
    );
  }

  for (const row of plan.menuRevisions) {
    await upsertRow(
      stats,
      'menuRevisions',
      row.id,
      () => tx.dailyMenuRevision.findUnique({ where: { id: row.id } }),
      () =>
        tx.dailyMenuRevision.upsert({
          where: { id: row.id },
          create: menuRevisionCreate(row),
          update: menuRevisionUpdate(row),
        }),
      () => menuRevisionUpdate(row),
    );
  }

  for (const row of plan.appSettings) {
    await upsertRow(
      stats,
      'appSettings',
      row.key,
      () => tx.appSetting.findUnique({ where: { key: row.key } }),
      () => tx.appSetting.upsert({ where: { key: row.key }, create: appSettingCreate(row), update: appSettingUpdate(row) }),
      () => appSettingUpdate(row),
    );
  }

  const servedRegistrationIds = plan.registrations
    .filter((row) => row.status === 'SERVED')
    .map((row) => row.id);
  const existingServingRegistrationIds = new Set(
    (
      servedRegistrationIds.length === 0
        ? []
        : await tx.mealServing.findMany({
            where: { registrationId: { in: servedRegistrationIds } },
            select: { registrationId: true },
          })
    ).map((row) => row.registrationId),
  );
  const servedRegistrationIdsToFinalize = servedRegistrationIds.filter(
    (id) => !existingServingRegistrationIds.has(id),
  );

  for (const row of plan.registrations) {
    // The migration trigger requires a SERVED registration to already have
    // its mealServing row. Seed those registrations as ACTIVE first, then
    // finalize their status after the serving upserts below.
    const registrationRow: SeedRegistrationRow =
      row.status === 'SERVED' && !existingServingRegistrationIds.has(row.id)
        ? { ...row, status: 'ACTIVE' }
        : row;
    await upsertRow(
      stats,
      'registrations',
      row.id,
      () => tx.registration.findUnique({ where: { id: row.id } }),
      () =>
        tx.registration.upsert({
          where: { id: row.id },
          create: registrationCreate(registrationRow),
          update: registrationUpdate(registrationRow),
        }),
      () => registrationUpdate(registrationRow),
    );
  }

  for (const row of plan.delegations) {
    await upsertRow(
      stats,
      'delegations',
      row.id,
      () => tx.pickupDelegation.findUnique({ where: { id: row.id } }),
      () =>
        tx.pickupDelegation.upsert({
          where: { id: row.id },
          create: delegationCreate(row),
          update: delegationUpdate(row),
        }),
      () => delegationUpdate(row),
    );
  }

  for (const row of plan.penalties) {
    await upsertRow(
      stats,
      'penalties',
      row.id,
      () => tx.penalty.findUnique({ where: { id: row.id } }),
      () => tx.penalty.upsert({ where: { id: row.id }, create: penaltyCreate(row), update: penaltyUpdate(row) }),
      () => penaltyUpdate(row),
    );
  }

  for (const row of plan.servingVerifications) {
    await upsertRow(
      stats,
      'servingVerifications',
      row.id,
      () => tx.servingVerification.findUnique({ where: { id: row.id } }),
      () =>
        tx.servingVerification.upsert({
          where: { id: row.id },
          create: servingVerificationCreate(row),
          update: servingVerificationUpdate(row),
        }),
      () => servingVerificationUpdate(row),
    );
  }

  for (const row of plan.pickupSessions) {
    await upsertRow(
      stats,
      'pickupSessions',
      row.id,
      () => tx.pickupSession.findUnique({ where: { id: row.id } }),
      () =>
        tx.pickupSession.upsert({
          where: { id: row.id },
          create: pickupSessionCreate(row),
          update: pickupSessionUpdate(row),
        }),
      () => pickupSessionUpdate(row),
    );
  }

  for (const row of plan.servingConfirmRequests) {
    await upsertRow(
      stats,
      'servingConfirmRequests',
      row.id,
      () => tx.servingConfirmRequest.findUnique({ where: { id: row.id } }),
      () =>
        tx.servingConfirmRequest.upsert({
          where: { id: row.id },
          create: servingConfirmRequestCreate(row),
          update: servingConfirmRequestUpdate(row),
        }),
      () => servingConfirmRequestUpdate(row),
    );
  }

  for (const row of plan.mealServings) {
    await upsertRow(
      stats,
      'mealServings',
      row.id,
      () => tx.mealServing.findUnique({ where: { id: row.id } }),
      () => tx.mealServing.upsert({ where: { id: row.id }, create: mealServingCreate(row), update: mealServingUpdate(row) }),
      () => mealServingUpdate(row),
    );
  }

  if (servedRegistrationIdsToFinalize.length > 0) {
    try {
      await tx.registration.updateMany({
        where: { id: { in: servedRegistrationIdsToFinalize } },
        data: { status: 'SERVED' },
      });
    } catch (error) {
      throw new SeedOperationError('registrations', 'SERVED', error);
    }
  }

  for (const row of plan.mealEvents) {
    await upsertRow(
      stats,
      'mealEvents',
      row.id,
      () => tx.mealEvent.findUnique({ where: { id: row.id } }),
      () => tx.mealEvent.upsert({ where: { id: row.id }, create: mealEventCreate(row), update: mealEventUpdate(row) }),
      () => mealEventUpdate(row),
    );
  }

  return {
    ...stats,
    counts: { ...plan.counts },
  };
}

async function resolveCanonicalRoles(tx: TransactionClient): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();
  for (const roleName of CANONICAL_ROLE_NAMES) {
    try {
      const role = await tx.role.findUnique({ where: { name: roleName }, select: { id: true } });
      if (!role) {
        throw new SeedOperationError('roles', roleName, { code: 'ROLE_MISSING' });
      }
      roleIds.set(roleName, role.id);
    } catch (error) {
      if (error instanceof SeedOperationError) throw error;
      throw new SeedOperationError('roles', roleName, error);
    }
  }
  return roleIds;
}

async function upsertRow(
  stats: WriteStats,
  entity: string,
  key: string,
  findExisting: () => Promise<unknown>,
  upsert: () => Promise<unknown>,
  expected: () => unknown,
): Promise<void> {
  try {
    const existing = await findExisting();
    if (!existing) {
      await upsert();
      stats.created += 1;
      return;
    }
    if (matchesSeedFields(existing, expected())) {
      stats.unchanged += 1;
      return;
    }
    await upsert();
    stats.updated += 1;
  } catch (error) {
    if (error instanceof SeedOperationError) throw error;
    throw new SeedOperationError(entity, key, error);
  }
}

function matchesSeedFields(existing: unknown, expected: unknown): boolean {
  if (!isRecord(existing) || !isRecord(expected)) {
    return valuesEqual(existing, expected);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue === undefined) continue;
    if (!valuesEqual(existing[key], expectedValue)) return false;
  }
  return true;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]),
    );
  }
  return Object.is(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function userCreate(row: SeedUserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    notificationLocale: row.notificationLocale,
    remindersEnabled: row.remindersEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Prisma-managed @updatedAt fields are intentionally omitted from update payloads:
// no-op comparisons must preserve their existing value, while a real update
// refreshes them once. Deterministic createdAt remains seed-owned and convergent.

function userUpdate(row: SeedUserRow) {
  return {
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    notificationLocale: row.notificationLocale,
    remindersEnabled: row.remindersEnabled,
    createdAt: row.createdAt,
  };
}

function locationCreate(row: SeedLocationRow) {
  return {
    id: row.id,
    shortCode: row.shortCode,
    displayName: row.displayName,
    servingPointName: row.servingPointName,
    address: row.address,
    building: row.building,
    floor: row.floor,
    roomOrCounter: row.roomOrCounter,
    localContact: row.localContact,
    timeZone: row.timeZone,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    operationalMetadata: jsonValue(row.operationalMetadata),
    holidayOverrides: jsonValue(row.holidayOverrides),
    capacityNotes: row.capacityNotes ?? null,
    accessibilityInstructions: row.accessibilityInstructions ?? null,
    emergencyInstructions: row.emergencyInstructions ?? null,
    kitchenTeam: row.kitchenTeam ?? null,
    approvedScannerDeviceIds: [...row.approvedScannerDeviceIds],
    networkNotes: row.networkNotes ?? null,
    lastVerifiedBy: row.lastVerifiedBy ?? null,
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    createdAt: row.createdAt,
  };
}

function locationUpdate(row: SeedLocationRow) {
  return {
    shortCode: row.shortCode,
    displayName: row.displayName,
    servingPointName: row.servingPointName,
    address: row.address,
    building: row.building,
    floor: row.floor,
    roomOrCounter: row.roomOrCounter,
    localContact: row.localContact,
    timeZone: row.timeZone,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    operationalMetadata: jsonValue(row.operationalMetadata),
    holidayOverrides: jsonValue(row.holidayOverrides),
    capacityNotes: row.capacityNotes ?? null,
    accessibilityInstructions: row.accessibilityInstructions ?? null,
    emergencyInstructions: row.emergencyInstructions ?? null,
    kitchenTeam: row.kitchenTeam ?? null,
    approvedScannerDeviceIds: [...row.approvedScannerDeviceIds],
    networkNotes: row.networkNotes ?? null,
    lastVerifiedBy: row.lastVerifiedBy ?? null,
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    createdAt: row.createdAt,
  };
}

function locationPolicyCreate(row: SeedLocationPolicyRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracySource: row.accuracySource,
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    maxFixAgeSeconds: row.maxFixAgeSeconds,
    maxAccuracyMeters: row.maxAccuracyMeters,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

function locationPolicyUpdate(row: SeedLocationPolicyRow) {
  return {
    locationId: row.locationId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracySource: row.accuracySource,
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    maxFixAgeSeconds: row.maxFixAgeSeconds,
    maxAccuracyMeters: row.maxAccuracyMeters,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

function assignmentCreate(row: SeedAssignmentRow) {
  return {
    id: row.id,
    userId: row.userId,
    normalizedEmail: row.normalizedEmail,
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    isActive: row.isActive,
    role: row.role,
    serviceLocationCode: row.serviceLocationCode,
    locationId: row.locationId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    rosterImportBatchId: row.rosterImportBatchId ?? null,
    auditEventId: row.auditEventId ?? null,
    createdAt: row.createdAt,
  };
}

function assignmentUpdate(row: SeedAssignmentRow) {
  return {
    userId: row.userId,
    normalizedEmail: row.normalizedEmail,
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    isActive: row.isActive,
    role: row.role,
    serviceLocationCode: row.serviceLocationCode,
    locationId: row.locationId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    rosterImportBatchId: row.rosterImportBatchId ?? null,
    auditEventId: row.auditEventId ?? null,
    createdAt: row.createdAt,
  };
}

function allowlistCreate(row: SeedAllowlistRow) {
  return {
    id: row.id,
    normalizedEmail: row.normalizedEmail,
    userId: row.userId,
    state: row.state,
    purpose: row.purpose,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    reason: row.reason ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
  };
}

function allowlistUpdate(row: SeedAllowlistRow) {
  return {
    normalizedEmail: row.normalizedEmail,
    userId: row.userId,
    state: row.state,
    purpose: row.purpose,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    reason: row.reason ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
  };
}

function weeklyMenuCreate(row: SeedWeeklyMenuRow) {
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function weeklyMenuUpdate(row: SeedWeeklyMenuRow) {
  return {
    startDate: row.startDate,
    endDate: row.endDate,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function dailyMenuCreate(row: SeedDailyMenuRow) {
  return {
    id: row.id,
    weeklyMenuId: row.weeklyMenuId,
    date: row.date,
    isHoliday: row.isHoliday,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
  };
}

function dailyMenuUpdate(row: SeedDailyMenuRow) {
  return {
    weeklyMenuId: row.weeklyMenuId,
    date: row.date,
    isHoliday: row.isHoliday,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
  };
}

function mealDayCreate(row: SeedMealDayRow) {
  return {
    id: row.id,
    dailyMenuId: row.dailyMenuId,
    mealType: row.mealType,
    isServingReady: row.isServingReady,
    createdAt: row.createdAt,
  };
}

function mealDayUpdate(row: SeedMealDayRow) {
  return {
    dailyMenuId: row.dailyMenuId,
    mealType: row.mealType,
    isServingReady: row.isServingReady,
    createdAt: row.createdAt,
  };
}

function menuRevisionCreate(row: SeedMenuRevisionRow) {
  return {
    id: row.id,
    dailyMenuId: row.dailyMenuId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

function menuRevisionUpdate(row: SeedMenuRevisionRow) {
  return {
    dailyMenuId: row.dailyMenuId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

function appSettingCreate(row: SeedAppSettingRow) {
  return {
    key: row.key,
    value: row.value,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function appSettingUpdate(row: SeedAppSettingRow) {
  return {
    value: row.value,
    version: row.version,
  };
}

function registrationCreate(row: SeedRegistrationRow) {
  return {
    id: row.id,
    userId: row.userId,
    mealDate: row.mealDate,
    status: row.status,
    mealChoice: row.mealChoice,
    serviceLocationId: row.serviceLocationId,
    serviceLocationAssignmentId: row.serviceLocationAssignmentId,
    serviceLocationCode: row.serviceLocationCode,
    serviceLocationName: row.serviceLocationName,
    serviceLocationAddress: row.serviceLocationAddress,
    serviceLocationEffectiveFrom: row.serviceLocationEffectiveFrom,
    serviceLocationSnapshotAt: row.serviceLocationSnapshotAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function registrationUpdate(row: SeedRegistrationRow) {
  return {
    userId: row.userId,
    mealDate: row.mealDate,
    status: row.status,
    mealChoice: row.mealChoice,
    serviceLocationId: row.serviceLocationId,
    serviceLocationAssignmentId: row.serviceLocationAssignmentId,
    serviceLocationCode: row.serviceLocationCode,
    serviceLocationName: row.serviceLocationName,
    serviceLocationAddress: row.serviceLocationAddress,
    serviceLocationEffectiveFrom: row.serviceLocationEffectiveFrom,
    serviceLocationSnapshotAt: row.serviceLocationSnapshotAt,
    createdAt: row.createdAt,
    version: row.version,
  };
}

function delegationCreate(row: SeedDelegationRow) {
  return {
    id: row.id,
    registrationId: row.registrationId,
    delegateUserId: row.delegateUserId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function delegationUpdate(row: SeedDelegationRow) {
  return {
    registrationId: row.registrationId,
    delegateUserId: row.delegateUserId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function penaltyCreate(row: SeedPenaltyRow) {
  return {
    id: row.id,
    userId: row.userId,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    paidAt: row.paidAt ?? null,
    waivedAt: row.waivedAt ?? null,
    waiveReason: row.waiveReason ?? null,
    waivedByUserId: row.waivedByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function penaltyUpdate(row: SeedPenaltyRow) {
  return {
    userId: row.userId,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    paidAt: row.paidAt ?? null,
    waivedAt: row.waivedAt ?? null,
    waiveReason: row.waiveReason ?? null,
    waivedByUserId: row.waivedByUserId ?? null,
    createdAt: row.createdAt,
  };
}

function servingVerificationCreate(row: SeedServingVerificationRow) {
  return {
    id: row.id,
    presenterUserId: row.presenterUserId,
    locationId: row.locationId,
    locationPolicyId: row.locationPolicyId,
    result: row.result,
    capturedAt: row.capturedAt,
    verifiedAt: row.verifiedAt,
    accuracyMeters: row.accuracyMeters,
    safeVerificationCode: row.safeVerificationCode,
    intentNonce: row.intentNonce,
    retentionUntil: row.retentionUntil,
    createdAt: row.createdAt,
  };
}

function servingVerificationUpdate(row: SeedServingVerificationRow) {
  return {
    presenterUserId: row.presenterUserId,
    locationId: row.locationId,
    locationPolicyId: row.locationPolicyId,
    result: row.result,
    capturedAt: row.capturedAt,
    verifiedAt: row.verifiedAt,
    accuracyMeters: row.accuracyMeters,
    safeVerificationCode: row.safeVerificationCode,
    intentNonce: row.intentNonce,
    retentionUntil: row.retentionUntil,
    createdAt: row.createdAt,
  };
}

function pickupSessionCreate(row: SeedPickupSessionRow) {
  return {
    id: row.id,
    userId: row.userId,
    presenterUserId: row.presenterUserId,
    mealDate: row.mealDate,
    registrationIds: [...row.registrationIds],
    intentRegistrationIds: [...row.intentRegistrationIds],
    intentHash: row.intentHash,
    intentNonce: row.intentNonce,
    qrHash: row.qrHash,
    locationId: row.locationId,
    servingVerificationId: row.servingVerificationId,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

function pickupSessionUpdate(row: SeedPickupSessionRow) {
  return {
    userId: row.userId,
    presenterUserId: row.presenterUserId,
    mealDate: row.mealDate,
    registrationIds: [...row.registrationIds],
    intentRegistrationIds: [...row.intentRegistrationIds],
    intentHash: row.intentHash,
    intentNonce: row.intentNonce,
    qrHash: row.qrHash,
    locationId: row.locationId,
    servingVerificationId: row.servingVerificationId,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

function servingConfirmRequestCreate(row: SeedServingConfirmRequestRow) {
  return {
    id: row.id,
    callerUserId: row.callerUserId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    requestBodyHash: row.requestBodyHash,
    intentHash: row.intentHash,
    pickupSessionId: row.pickupSessionId,
    resultServingIds: [...row.resultServingIds],
    resultSnapshot: jsonValue(row.resultSnapshot),
    originalResultRequestId: row.originalResultRequestId ?? null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

function servingConfirmRequestUpdate(row: SeedServingConfirmRequestRow) {
  return {
    callerUserId: row.callerUserId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    requestBodyHash: row.requestBodyHash,
    intentHash: row.intentHash,
    pickupSessionId: row.pickupSessionId,
    resultServingIds: [...row.resultServingIds],
    resultSnapshot: jsonValue(row.resultSnapshot),
    originalResultRequestId: row.originalResultRequestId ?? null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

function mealServingCreate(row: SeedMealServingRow) {
  return {
    id: row.id,
    registrationId: row.registrationId,
    ownerUserId: row.ownerUserId,
    ownerEmailSnapshot: row.ownerEmailSnapshot,
    ownerNameSnapshot: row.ownerNameSnapshot,
    presenterUserId: row.presenterUserId,
    receiverType: row.receiverType,
    kitchenUserId: row.kitchenUserId,
    kitchenPermissionContext: row.kitchenPermissionContext,
    scannerDeviceId: row.scannerDeviceId ?? null,
    locationId: row.locationId,
    locationShortCode: row.locationShortCode,
    locationNameSnapshot: row.locationNameSnapshot,
    locationAddressSnapshot: row.locationAddressSnapshot,
    mealDate: row.mealDate,
    menuRevisionId: row.menuRevisionId,
    requestId: row.requestId,
    pickupSessionId: row.pickupSessionId,
    intentHash: row.intentHash,
    verificationOutcome: row.verificationOutcome,
    servingVerificationId: row.servingVerificationId,
    delegationId: row.delegationId,
    servedAt: row.servedAt,
  };
}

function mealServingUpdate(row: SeedMealServingRow) {
  return {
    registrationId: row.registrationId,
    ownerUserId: row.ownerUserId,
    ownerEmailSnapshot: row.ownerEmailSnapshot,
    ownerNameSnapshot: row.ownerNameSnapshot,
    presenterUserId: row.presenterUserId,
    receiverType: row.receiverType,
    kitchenUserId: row.kitchenUserId,
    kitchenPermissionContext: row.kitchenPermissionContext,
    scannerDeviceId: row.scannerDeviceId ?? null,
    locationId: row.locationId,
    locationShortCode: row.locationShortCode,
    locationNameSnapshot: row.locationNameSnapshot,
    locationAddressSnapshot: row.locationAddressSnapshot,
    mealDate: row.mealDate,
    menuRevisionId: row.menuRevisionId,
    requestId: row.requestId,
    pickupSessionId: row.pickupSessionId,
    intentHash: row.intentHash,
    verificationOutcome: row.verificationOutcome,
    servingVerificationId: row.servingVerificationId,
    delegationId: row.delegationId,
    servedAt: row.servedAt,
  };
}

function mealEventCreate(row: SeedMealEventRow) {
  return {
    id: row.id,
    mealServingId: row.mealServingId,
    eventType: row.eventType,
    createdAt: row.createdAt,
  };
}

function mealEventUpdate(row: SeedMealEventRow) {
  return {
    mealServingId: row.mealServingId,
    eventType: row.eventType,
    createdAt: row.createdAt,
  };
}

function jsonValue(value: SeedLocationRow['operationalMetadata'] | SeedLocationRow['holidayOverrides'] | SeedServingConfirmRequestRow['resultSnapshot']):
  | Prisma.InputJsonValue
  | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  return Math.min(value, 3);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof SeedOperationError) return errorCode(error.original);
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('errorCode' in error && typeof error.errorCode === 'string') return error.errorCode;
  return undefined;
}

function operationContext(error: unknown): OperationContext {
  if (error instanceof SeedOperationError) {
    return { entity: error.entity, key: error.key };
  }
  return { entity: 'transaction', key: 'local-seed' };
}
