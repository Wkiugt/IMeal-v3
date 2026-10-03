import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../src/db.js';
import { assertLocalSeedPlan, buildLocalSeedPlan } from '../src/local-seed/plan.js';
import type { LocalSeedConfig, LocalSeedPlan } from '../src/local-seed/types.js';
import { writeLocalSeed } from '../src/local-seed/writer.js';

function selectedDisposableConfig(): LocalSeedConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('disposable DATABASE_URL must be selected by test setup');
  }
  const target = new URL(databaseUrl);
  const database = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
  const schema = target.searchParams.get('schema');
  if (!database || schema === null) {
    throw new Error('disposable DATABASE_URL must include database and schema');
  }
  return {
    baseEmail: 'seed@example.test',
    weekStart: '2026-09-28',
    serveDate: '2026-09-28',
    dryRun: false,
    databaseUrl,
    target: {
      nodeEnv: 'test',
      host: target.hostname,
      database,
      schema,
    },
  };
}

const CONFIG = selectedDisposableConfig();

const CANONICAL_ROLES = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'staff' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'kitchen' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'admin' },
] as const;
const EXPECTED_GRAPH_COUNTS = {
  roles: 3,
  userRoles: 56,
  users: 50,
  locations: 4,
  locationPolicies: 4,
  assignments: 50,
  allowlists: 50,
  weeklyMenus: 1,
  dailyMenus: 7,
  mealDays: 7,
  menuRevisions: 7,
  appSettings: 1,
  registrations: 126,
  delegations: 0,
  penalties: 10,
  servingVerifications: 40,
  pickupSessions: 40,
  servingConfirmRequests: 40,
  mealServings: 40,
  mealEvents: 40,
} as const;

const LOCATION_CODES = ['LOCAL-A', 'LOCAL-B', 'LOCAL-C', 'LOCAL-D'] as const;

async function seedGraphCounts() {
  const [
    roles,
    userRoles,
    users,
    locations,
    locationPolicies,
    assignments,
    allowlists,
    weeklyMenus,
    dailyMenus,
    mealDays,
    menuRevisions,
    appSettings,
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
  ] = await Promise.all([
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.user.count(),
    prisma.location.count(),
    prisma.locationPolicy.count(),
    prisma.employeeLocationAssignment.count(),
    prisma.otpAllowlist.count(),
    prisma.weeklyMenu.count(),
    prisma.dailyMenu.count(),
    prisma.mealDay.count(),
    prisma.dailyMenuRevision.count(),
    prisma.appSetting.count(),
    prisma.registration.count(),
    prisma.pickupDelegation.count(),
    prisma.penalty.count(),
    prisma.servingVerification.count(),
    prisma.pickupSession.count(),
    prisma.servingConfirmRequest.count(),
    prisma.mealServing.count(),
    prisma.mealEvent.count(),
  ]);

  return {
    roles,
    userRoles,
    users,
    locations,
    locationPolicies,
    assignments,
    allowlists,
    weeklyMenus,
    dailyMenus,
    mealDays,
    menuRevisions,
    appSettings,
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
  };
}

async function seedGraphIds() {
  const [
    roles,
    userRoles,
    users,
    locations,
    locationPolicies,
    assignments,
    allowlists,
    weeklyMenus,
    dailyMenus,
    mealDays,
    menuRevisions,
    appSettings,
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
  ] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.userRole.findMany({
      orderBy: [{ userId: 'asc' }, { roleId: 'asc' }],
      select: { userId: true, roleId: true },
    }),
    prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.location.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.locationPolicy.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.employeeLocationAssignment.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    prisma.otpAllowlist.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.weeklyMenu.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.dailyMenu.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.mealDay.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.dailyMenuRevision.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    prisma.appSetting.findMany({ orderBy: { key: 'asc' }, select: { key: true } }),
    prisma.registration.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.pickupDelegation.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    prisma.penalty.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.servingVerification.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    prisma.pickupSession.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.servingConfirmRequest.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
    }),
    prisma.mealServing.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.mealEvent.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
  ]);

  return {
    roles: roles.map(({ id }) => id),
    userRoles: userRoles.map(({ userId, roleId }) => `${userId}:${roleId}`),
    users: users.map(({ id }) => id),
    locations: locations.map(({ id }) => id),
    locationPolicies: locationPolicies.map(({ id }) => id),
    assignments: assignments.map(({ id }) => id),
    allowlists: allowlists.map(({ id }) => id),
    weeklyMenus: weeklyMenus.map(({ id }) => id),
    dailyMenus: dailyMenus.map(({ id }) => id),
    mealDays: mealDays.map(({ id }) => id),
    menuRevisions: menuRevisions.map(({ id }) => id),
    appSettings: appSettings.map(({ key }) => key),
    registrations: registrations.map(({ id }) => id),
    delegations: delegations.map(({ id }) => id),
    penalties: penalties.map(({ id }) => id),
    servingVerifications: servingVerifications.map(({ id }) => id),
    pickupSessions: pickupSessions.map(({ id }) => id),
    servingConfirmRequests: servingConfirmRequests.map(({ id }) => id),
    mealServings: mealServings.map(({ id }) => id),
    mealEvents: mealEvents.map(({ id }) => id),
  };
}


beforeEach(async () => {
  // The shared disposable-schema setup truncates canonical migration rows too.
  // Restore only those lookup rows; the writer must never create role definitions.
  await prisma.role.createMany({ data: [...CANONICAL_ROLES] });
});

function buildPlan(): LocalSeedPlan {
  const plan = buildLocalSeedPlan(CONFIG);
  assertLocalSeedPlan(plan);
  return plan;
}


describe('local seed transactional writer', () => {
  it('persists the complete deterministic graph with required statuses and relations', async () => {
    const plan = buildPlan();

    const result = await writeLocalSeed(prisma, plan);

    expect(result.created).toBeGreaterThan(0);
    expect(await seedGraphCounts()).toEqual(EXPECTED_GRAPH_COUNTS);
    expect(await prisma.user.findMany({ orderBy: { email: 'asc' } })).toHaveLength(50);
    expect(await prisma.employeeLocationAssignment.count({ where: { isActive: true } })).toBe(50);
    expect(
      await prisma.registration.count({
        where: { serviceLocationId: { not: null }, serviceLocationAssignmentId: { not: null } },
      }),
    ).toBe(126);
    expect(
      await prisma.mealServing.count({
        where: { registration: { status: 'SERVED' } },
      }),
    ).toBe(40);
    expect(await prisma.mealEvent.count({ where: { eventType: 'PICKUP_CONFIRMED' } })).toBe(40);
    expect(
      await prisma.otpAllowlist.count({
        where: { state: 'ACTIVE', purpose: 'SESSION_LOGIN' },
      }),
    ).toBe(50);

    const locations = await prisma.location.findMany({
      orderBy: { shortCode: 'asc' },
      select: {
        id: true,
        shortCode: true,
        isActive: true,
        timeZone: true,
        policies: {
          select: {
            latitude: true,
            longitude: true,
            accuracySource: true,
            geofenceRadiusMeters: true,
            maxFixAgeSeconds: true,
            maxAccuracyMeters: true,
            isActive: true,
          },
        },
      },
    });
    expect(locations.map(({ shortCode, isActive, timeZone }) => ({ shortCode, isActive, timeZone }))).toEqual([
      { shortCode: 'LOCAL-A', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
      { shortCode: 'LOCAL-B', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
      { shortCode: 'LOCAL-C', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
      { shortCode: 'LOCAL-D', isActive: true, timeZone: 'Asia/Ho_Chi_Minh' },
    ]);
    for (const [index, location] of locations.entries()) {
      expect(location.policies).toHaveLength(1);
      const [policy] = location.policies;
      expect(policy).toMatchObject({
        latitude: index + 1,
        longitude: index + 1,
        accuracySource: 'synthetic-local-seed',
        geofenceRadiusMeters: 150,
        maxFixAgeSeconds: 30,
        maxAccuracyMeters: 100,
        isActive: true,
      });
      expect(Number.isFinite(policy.latitude)).toBe(true);
      expect(Number.isFinite(policy.longitude)).toBe(true);
      expect(Number.isFinite(policy.maxAccuracyMeters)).toBe(true);
      expect(policy.geofenceRadiusMeters).toBeGreaterThan(0);
      expect(policy.maxFixAgeSeconds).toBeGreaterThan(0);
      expect(policy.maxAccuracyMeters).toBeGreaterThan(0);
    }
    const locationIdByCode = new Map(
      locations.map(({ shortCode, id }) => [shortCode, id]),
    );


    const assignments = await prisma.employeeLocationAssignment.findMany({
      orderBy: { employeeCode: 'asc' },
      select: {
        userId: true,
        normalizedEmail: true,
        employeeCode: true,
        isActive: true,
        serviceLocationCode: true,
        locationId: true,
      },
    });
    expect(assignments).toHaveLength(50);
    expect(new Set(assignments.map(({ userId }) => userId)).size).toBe(50);
    expect(new Set(assignments.map(({ employeeCode }) => employeeCode)).size).toBe(50);
    assignments.forEach((assignment, index) => {
      const expectedLocationCode = LOCATION_CODES[index % LOCATION_CODES.length];
      expect(assignment.userId).not.toBeNull();
      expect(assignment.normalizedEmail).toBe(plan.users[index].email);
      expect(assignment.employeeCode).toBe(`LOCAL-EMP-${String(index + 1).padStart(4, '0')}`);
      expect(assignment.isActive).toBe(true);
      expect(assignment.serviceLocationCode).toBe(expectedLocationCode);
      expect(assignment.locationId).toBe(locationIdByCode.get(expectedLocationCode));
    });

    const userRoles = await prisma.userRole.findMany({
      select: { userId: true, role: { select: { name: true } } },
    });
    const rolesByUser = new Map<string, string[]>();
    for (const { userId, role } of userRoles) {
      const roles = rolesByUser.get(userId) ?? [];
      roles.push(role.name);
      rolesByUser.set(userId, roles);
    }
    expect(rolesByUser.size).toBe(50);
    const cohorts = [...rolesByUser.values()].map((roles) => roles.sort().join('+'));
    expect(cohorts.filter((roles) => roles === 'staff').length).toBe(36);
    expect(cohorts.filter((roles) => roles === 'kitchen').length).toBe(6);
    expect(cohorts.filter((roles) => roles === 'kitchen+staff').length).toBe(5);
    expect(cohorts.filter((roles) => roles === 'admin').length).toBe(2);
    expect(cohorts.filter((roles) => roles === 'admin+staff').length).toBe(1);
    const kitchenOnlyUserIds = new Set(
      [...rolesByUser.entries()]
        .filter(([, roles]) => roles.length === 1 && roles[0] === 'kitchen')
        .map(([userId]) => userId),
    );

    const weeklyMenu = await prisma.weeklyMenu.findUnique({
      where: { id: plan.weeklyMenu.id },
      select: { startDate: true, endDate: true, publishedAt: true },
    });
    expect(weeklyMenu).toMatchObject({
      startDate: new Date('2026-09-28T00:00:00.000Z'),
      endDate: new Date('2026-10-04T00:00:00.000Z'),
    });
    expect(weeklyMenu?.publishedAt?.getTime()).toBeLessThan(new Date('2026-09-28T00:00:00.000Z').getTime());
    const dailyMenus = await prisma.dailyMenu.findMany({
      orderBy: { date: 'asc' },
      select: {
        date: true,
        weeklyMenuId: true,
        isHoliday: true,
        isEnabled: true,
        revisions: { select: { id: true, content: true } },
        mealDays: { select: { mealType: true, isServingReady: true } },
      },
    });
    expect(dailyMenus).toHaveLength(7);
    for (const [index, dailyMenu] of dailyMenus.entries()) {
      expect(dailyMenu.date.toISOString()).toBe(
        new Date(Date.UTC(2026, 8, 28 + index)).toISOString(),
      );
      expect(dailyMenu.weeklyMenuId).toBe(plan.weeklyMenu.id);
      expect(dailyMenu.isHoliday).toBe(false);
      expect(dailyMenu.isEnabled).toBe(true);
      expect(dailyMenu.revisions).toHaveLength(1);
      expect(dailyMenu.revisions[0].content).toBe(
        `Local synthetic menu ${dailyMenu.date.toISOString().slice(0, 10)}`,
      );
      expect(dailyMenu.mealDays).toEqual([
        { mealType: 'LUNCH', isServingReady: index === 0 },
      ]);
    }
    await expect(
      prisma.appSetting.findUnique({ where: { key: 'isServingReady:2026-09-28' } }),
    ).resolves.toMatchObject({ value: 'true' });

    const registrations = await prisma.registration.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        mealDate: true,
        status: true,
        mealChoice: true,
        serviceLocationId: true,
        serviceLocationAssignmentId: true,
        serviceLocationCode: true,
        serviceLocationName: true,
        serviceLocationAddress: true,
        serviceLocationEffectiveFrom: true,
        serviceLocationSnapshotAt: true,
        serviceLocation: {
          select: { id: true, shortCode: true, displayName: true, address: true },
        },
        serviceLocationAssignment: {
          select: { id: true, userId: true, serviceLocationCode: true, locationId: true },
        },
        mealServing: { select: { id: true } },
      },
    });
    expect(registrations).toHaveLength(126);
    expect(registrations.filter(({ status }) => status === 'ACTIVE')).toHaveLength(60);
    expect(registrations.filter(({ status }) => status === 'SERVED')).toHaveLength(40);
    expect(registrations.filter(({ status }) => status === 'CANCELLED')).toHaveLength(16);
    expect(registrations.filter(({ status }) => status === 'NO_SHOW')).toHaveLength(10);
    expect(registrations.every(({ userId }) => !kitchenOnlyUserIds.has(userId))).toBe(true);
    for (const registration of registrations) {
      const location = registration.serviceLocation;
      const assignment = registration.serviceLocationAssignment;
      if (!location || !assignment) {
        throw new Error(`registration ${registration.id} has an incomplete location graph`);
      }
      expect(registration.serviceLocationId).toBe(location.id);
      expect(registration.serviceLocationAssignmentId).toBe(assignment.id);
      expect(assignment.userId).toBe(registration.userId);
      expect(assignment.locationId).toBe(location.id);
      expect(registration.serviceLocationCode).toBe(location.shortCode);
      expect(registration.serviceLocationCode).toBe(assignment.serviceLocationCode);
      expect(registration.serviceLocationName).toBe(location.displayName);
      expect(registration.serviceLocationAddress).toBe(location.address);
      expect(registration.serviceLocationEffectiveFrom).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
      expect(registration.serviceLocationSnapshotAt).toEqual(
        new Date('2026-09-28T00:00:00.000Z'),
      );
      expect(registration.status === 'SERVED').toBe(registration.mealServing !== null);
    }

    const penalties = await prisma.penalty.findMany({
      select: { userId: true, amount: true, status: true, reason: true },
    });
    expect(penalties).toHaveLength(10);
    const noShowOwnersByRegistrationId = new Map(
      registrations
        .filter(({ status }) => status === 'NO_SHOW')
        .map(({ id, userId }) => [id, userId]),
    );
    const matchedNoShowIds = new Set<string>();
    for (const penalty of penalties) {
      expect(penalty.amount).toBe(50000);
      expect(penalty.status).toBe('PENDING');
      expect(penalty.reason).toContain('NO_SHOW_PENALTY_');
      const registrationId = [...noShowOwnersByRegistrationId.keys()].find((id) =>
        penalty.reason.endsWith(id),
      );
      if (!registrationId) {
        throw new Error(`penalty reason does not identify a NO_SHOW registration: ${penalty.reason}`);
      }
      matchedNoShowIds.add(registrationId);
      expect(penalty.userId).toBe(noShowOwnersByRegistrationId.get(registrationId));
    }
    expect(matchedNoShowIds.size).toBe(10);

    const delegations = await prisma.pickupDelegation.findMany({
      select: {
        registrationId: true,
        delegateUserId: true,
        status: true,
        registration: { select: { status: true, userId: true } },
      },
    });
    expect(delegations).toHaveLength(0);

    const servings = await prisma.mealServing.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        registrationId: true,
        ownerUserId: true,
        presenterUserId: true,
        receiverType: true,
        kitchenUserId: true,
        kitchenPermissionContext: true,
        locationId: true,
        menuRevisionId: true,
        pickupSessionId: true,
        intentHash: true,
        servingVerificationId: true,
        delegationId: true,
        registration: {
          select: { status: true, serviceLocationId: true, mealDate: true },
        },
        delegation: {
          select: { id: true, status: true, registrationId: true, delegateUserId: true },
        },
        pickupSession: {
          select: {
            id: true,
            registrationIds: true,
            intentRegistrationIds: true,
            servings: { select: { id: true } },
          },
        },
        servingVerification: {
          select: { id: true, result: true, accuracyMeters: true },
        },
        events: { select: { eventType: true } },
      },
    });
    expect(servings).toHaveLength(40);
    expect(servings.filter(({ receiverType }) => receiverType === 'SELF')).toHaveLength(40);
    expect(servings.filter(({ receiverType }) => receiverType === 'PROXY')).toHaveLength(0);
    for (const serving of servings) {
      expect(serving.registration.status).toBe('SERVED');
      expect(serving.ownerUserId).not.toBeNull();
      expect(serving.presenterUserId).not.toBeNull();
      expect(serving.kitchenUserId).not.toBeNull();
      expect(serving.kitchenPermissionContext).toBe('kitchen.serve');
      expect(serving.locationId).toBe(serving.registration.serviceLocationId);
      expect(serving.menuRevisionId).not.toBeNull();
      expect(serving.pickupSessionId).not.toBeNull();
      expect(serving.servingVerificationId).not.toBeNull();
      expect(serving.events).toEqual([{ eventType: 'PICKUP_CONFIRMED' }]);
      expect(serving.servingVerification).toMatchObject({
        id: serving.servingVerificationId,
        result: 'VALID',
        accuracyMeters: 5,
      });
      expect(serving.pickupSession).toMatchObject({
        id: serving.pickupSessionId,
        registrationIds: [serving.registrationId],
        intentRegistrationIds: [serving.registrationId],
      });
      expect(serving.receiverType).toBe('SELF');
      expect(serving.ownerUserId).toBe(serving.presenterUserId);
      expect(serving.delegationId).toBeNull();
      expect(serving.delegation).toBeNull();
    }

    const requests = await prisma.servingConfirmRequest.findMany({
      select: {
        callerUserId: true,
        status: true,
        intentHash: true,
        pickupSessionId: true,
        resultServingIds: true,
      },
    });
    expect(requests).toHaveLength(40);
    const servingsById = new Map(servings.map((serving) => [serving.id, serving]));
    for (const request of requests) {
      expect(request.status).toBe('SUCCESS');
      expect(request.resultServingIds).toHaveLength(1);
      const serving = servingsById.get(request.resultServingIds[0]);
      if (!serving) {
        throw new Error(`confirm request references missing serving ${request.resultServingIds[0]}`);
      }
      expect(request.callerUserId).toBe(serving.presenterUserId);
      expect(request.intentHash).toBe(serving.intentHash);
      expect(request.pickupSessionId).toBe(serving.pickupSessionId);
    }
  });

  it('reruns without creating rows, restores edits, and keeps deterministic IDs stable', async () => {
    const plan = buildPlan();

    await writeLocalSeed(prisma, plan);
    const firstIds = await seedGraphIds();
    const firstCounts = await seedGraphCounts();

    const secondResult = await writeLocalSeed(prisma, plan);
    const secondIds = await seedGraphIds();

    expect(secondResult.created).toBe(0);
    expect(secondIds).toEqual(firstIds);
    expect(await seedGraphCounts()).toEqual(firstCounts);

    await prisma.user.update({
      where: { id: plan.users[0].id },
      data: { name: 'Locally edited seed user' },
    });
    await prisma.registration.update({
      where: { id: plan.registrations[0].id },
      data: { serviceLocationName: 'Locally edited location snapshot' },
    });

    const convergenceResult = await writeLocalSeed(prisma, plan);
    expect(convergenceResult.created).toBe(0);
    expect(
      await prisma.user.findUnique({
        where: { id: plan.users[0].id },
        select: { name: true },
      }),
    ).toEqual({ name: plan.users[0].name });
    expect(
      await prisma.registration.findUnique({
        where: { id: plan.registrations[0].id },
        select: { serviceLocationName: true },
      }),
    ).toEqual({ serviceLocationName: plan.registrations[0].serviceLocationName });
    expect(await seedGraphIds()).toEqual(firstIds);
    expect(await seedGraphCounts()).toEqual(firstCounts);
  });

  it('preserves unrelated rows across a seed rerun', async () => {
    const plan = buildPlan();
    await writeLocalSeed(prisma, plan);

    const originalUser = await prisma.user.create({
      data: {
        id: 'unrelated-user-id',
        email: 'unrelated@example.net',
        name: 'Unrelated User',
        isActive: false,
        notificationLocale: 'EN',
        remindersEnabled: false,
      },
    });
    const originalLocation = await prisma.location.create({
      data: {
        id: 'unrelated-location-id',
        shortCode: 'EXT-KEEP',
        displayName: 'External Location',
        servingPointName: 'External Counter',
        address: 'External address',
        building: 'External building',
        floor: '1',
        roomOrCounter: 'External counter',
        localContact: 'external@example.test',
        timeZone: 'Asia/Ho_Chi_Minh',
        isActive: false,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        approvedScannerDeviceIds: [],
      },
    });

    await writeLocalSeed(prisma, plan);

    expect(
      await prisma.user.findUnique({ where: { email: 'unrelated@example.net' } }),
    ).toEqual(originalUser);
    expect(
      await prisma.location.findUnique({ where: { shortCode: 'EXT-KEEP' } }),
    ).toEqual(originalLocation);
  });
  it('rolls back all seed writes when a later serving foreign key fails', async () => {
    const plan = buildPlan();
    const invalidPlan: LocalSeedPlan = {
      ...plan,
      mealServings: plan.mealServings.map((serving, index) =>
        index === 0 ? { ...serving, registrationId: 'missing-registration-id' } : serving,
      ),
    };
    const before = await seedGraphCounts();

    await expect(writeLocalSeed(prisma, invalidPlan)).rejects.toMatchObject({ code: 'P2003' });

    expect(await seedGraphCounts()).toEqual(before);
  });
});
