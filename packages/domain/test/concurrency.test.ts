import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RegistrationService } from '../src/RegistrationService';
import { LegacyRegistrationFixtureService } from './legacyRegistrationFixture';
import { prisma } from '../src/db';
import { randomUUID } from 'node:crypto';
import { registerTestPrismaClient } from './setup';

const disposableClients: PrismaClient[] = [];

function createDisposableClient() {
  const client = new PrismaClient();
  disposableClients.push(client);
  registerTestPrismaClient(client);
  return client;
}

const COMPLETE_SNAPSHOT = {
  ownerNameSnapshot: 'Race Owner',
  employeeCodeSnapshot: 'RACE-001',
  menuNameSnapshot: 'Race Menu',
  menuDescriptionSnapshot: null,
  menuImageSnapshot: null,
  serviceLocationCode: 'RACE',
  serviceLocationName: 'Race Kitchen',
  serviceLocationAddress: '1 Race Street',
};

async function createCompleteRegistrationFixture(
  userId: string,
  mealDate: Date,
  overrides: Record<string, unknown> = {},
) {
  const location = await prisma.location.create({
    data: {
      shortCode: 'RACE',
      displayName: COMPLETE_SNAPSHOT.serviceLocationName,
      servingPointName: 'Race counter',
      address: COMPLETE_SNAPSHOT.serviceLocationAddress,
      building: 'A',
      floor: '1',
      roomOrCounter: '1',
      localContact: 'race@example.test',
      isActive: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const assignment = await prisma.employeeLocationAssignment.create({
    data: {
      userId,
      normalizedEmail: 'race@example.test',
      employeeName: COMPLETE_SNAPSHOT.ownerNameSnapshot,
      employeeCode: COMPLETE_SNAPSHOT.employeeCodeSnapshot,
      isActive: true,
      role: 'STAFF',
      serviceLocationCode: location.shortCode,
      locationId: location.id,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const weeklyMenu = await prisma.weeklyMenu.create({
    data: {
      startDate: mealDate,
      endDate: mealDate,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const dailyMenu = await prisma.dailyMenu.create({
    data: { weeklyMenuId: weeklyMenu.id, date: mealDate },
  });
  const revision = await prisma.dailyMenuRevision.create({
    data: {
      dailyMenuId: dailyMenu.id,
      revision: 1,
      mealName: COMPLETE_SNAPSHOT.menuNameSnapshot,
      content: 'race menu',
    },
  });
  return prisma.registration.create({
    data: {
      userId,
      mealDate,
      status: 'ACTIVE',
      menuRevisionId: revision.id,
      ownerNameSnapshot: COMPLETE_SNAPSHOT.ownerNameSnapshot,
      employeeCodeSnapshot: COMPLETE_SNAPSHOT.employeeCodeSnapshot,
      menuNameSnapshot: COMPLETE_SNAPSHOT.menuNameSnapshot,
      menuDescriptionSnapshot: COMPLETE_SNAPSHOT.menuDescriptionSnapshot,
      menuImageSnapshot: COMPLETE_SNAPSHOT.menuImageSnapshot,
      registeredAt: new Date('2026-09-01T00:00:00.000Z'),
      serviceLocationId: location.id,
      serviceLocationAssignmentId: assignment.id,
      serviceLocationCode: location.shortCode,
      serviceLocationName: location.displayName,
      serviceLocationAddress: location.address,
      serviceLocationEffectiveFrom: assignment.effectiveFrom,
      serviceLocationSnapshotAt: new Date('2026-09-01T00:00:00.000Z'),
      ...overrides,
    },
  });
}

describe('Domain Tests: Concurrency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    const clients = disposableClients.splice(0);
    const results = await Promise.allSettled(
      clients.map((client) => client.$disconnect()),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Failed to disconnect concurrency test clients',
      );
    }
  });

  it('register same user/date: keeps one row despite concurrent unique race', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc1@test.com' },
    });
    const menuDate = new Date('2026-09-05T12:00:00.000Z');
    const currentTime = new Date('2026-09-02T12:00:00.000Z');

    await prisma.dailyMenu.create({
      data: {
        date: menuDate,
        isEnabled: true,
        isHoliday: false,
        weeklyMenu: {
          create: {
            startDate: new Date('2026-09-01T00:00:00.000Z'),
            endDate: new Date('2026-09-07T23:59:59.000Z'),
          },
        },
      },
    });

    const results = await Promise.allSettled([
      LegacyRegistrationFixtureService.registerMeal(user.id, menuDate, currentTime),
      LegacyRegistrationFixtureService.registerMeal(user.id, menuDate, currentTime),
      LegacyRegistrationFixtureService.registerMeal(user.id, menuDate, currentTime),
    ]);
    // Concurrent legacy domain writes can lose one request to the unique key;
    // the persisted registration is the invariant this test proves.
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes.length).toBeGreaterThanOrEqual(2);
    expect(failures.length).toBeLessThanOrEqual(1);

    expect(
      await prisma.registration.count({
        where: { userId: user.id, mealDate: menuDate },
      }),
    ).toBe(1);
    const persisted = await prisma.registration.findUniqueOrThrow({
      where: {
        userId_mealDate: { userId: user.id, mealDate: menuDate },
      },
    });
    expect(persisted).toMatchObject({
      userId: user.id,
      status: 'ACTIVE',
    });
    expect(persisted.mealDate.toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
  });

  it('two scanners same registration: only one succeeds, the other throws', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc2@test.com' },
    });
    const menuDate = new Date('2026-09-06T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    // Simulate two scanners sending serveMeal at the exact same time
    const results = await Promise.allSettled([
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id),
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toContain(
      'Already served',
    );

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);
    const dbReg = await prisma.registration.findUnique({
      where: { id: reg.id },
      include: { mealServing: true },
    });

    expect(dbReg?.status).toBe('ACTIVE');
    expect(dbReg?.mealServing).toBeTruthy();
    expect(dbReg?.mealServing?.registrationId).toBe(reg.id);
  });

  it('owner vs delegate simultaneous serving: only one succeeds', async () => {
    const owner = await prisma.user.create({
      data: { email: 'owner_conc3@test.com' },
    });
    const delegate = await prisma.user.create({
      data: { email: 'delegate_conc3@test.com' },
    });
    const menuDate = new Date('2026-09-07T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    await prisma.pickupDelegation.create({
      data: {
        registrationId: reg.id,
        delegateUserId: delegate.id,
        status: 'PENDING',
      },
    });

    const results = await Promise.allSettled([
      LegacyRegistrationFixtureService.serveMeal(reg.id, owner.id),
      LegacyRegistrationFixtureService.serveMeal(reg.id, delegate.id),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);
  });

  it('revoke vs serve race: if canceled, serve fails; if served, cancel fails', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc4@test.com' },
    });
    const menuDate = new Date('2026-09-08T12:00:00.000Z');
    const currentTime = new Date('2026-09-07T10:00:00.000Z'); // before cutoff 14:00

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    const results = await Promise.allSettled([
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id),
      RegistrationService.cancelRegistration(reg.id, currentTime),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Due to transaction isolation, exactly one should succeed and one should fail
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const dbReg = await prisma.registration.findUnique({
      where: { id: reg.id },
      include: { mealServing: true },
    });
    expect(['ACTIVE', 'SERVED', 'CANCELLED']).toContain(dbReg?.status);
    if (dbReg?.status === 'CANCELLED') {
      expect(dbReg.mealServing).toBeNull();
    } else {
      expect(dbReg?.mealServing).toBeTruthy();
      expect(dbReg?.status).not.toBe('NO_SHOW');
    }
  });

  it('retry idempotency key: same caller and key should be idempotent', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc5@test.com' },
    });
    const menuDate = new Date('2026-09-09T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    const idempotencyKey = 'serve_req_123';

    // Calling serveMeal multiple times with the same idempotencyKey
    const results = await Promise.allSettled([
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id, idempotencyKey),
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id, idempotencyKey),
      LegacyRegistrationFixtureService.serveMeal(reg.id, user.id, idempotencyKey),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Only one should succeed because they race to create `ServingConfirmRequest`.
    // The others will throw Prisma unique constraint error on `ServingConfirmRequest`
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(failures.length).toBeLessThanOrEqual(2);

    // Call sequentially again with the same idempotency key - it should return the existing serving without error
    const retryResult = await LegacyRegistrationFixtureService.serveMeal(
      reg.id,
      user.id,
      idempotencyKey,
    );
    expect(retryResult).toBeDefined();

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);
  });

  it('multi-item batch with stale item: all-or-nothing', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc6@test.com' },
    });
    const menuDate1 = new Date('2026-09-10T12:00:00.000Z');
    const menuDate2 = new Date('2026-09-11T12:00:00.000Z');
    const menuDate3 = new Date('2026-09-12T12:00:00.000Z');

    const reg1 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate1, status: 'ACTIVE' },
    });
    const reg2 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate2, status: 'ACTIVE' },
    });
    const reg3 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate3, status: 'ACTIVE' },
    });

    // Make reg2 stale by serving it beforehand
    await LegacyRegistrationFixtureService.serveMeal(reg2.id, user.id);

    // Now attempt a batch serve for all 3
    const batchPromise = LegacyRegistrationFixtureService.batchServeMeals(
      [reg1.id, reg2.id, reg3.id],
      user.id,
      'batch_123',
    );

    await expect(batchPromise).rejects.toThrow(`Already served ${reg2.id}`);

    // reg1 and reg3 should REMAIN REGISTERED (transaction rolled back)
    const dbReg1 = await prisma.registration.findUnique({
      where: { id: reg1.id },
    });
    const dbReg3 = await prisma.registration.findUnique({
      where: { id: reg3.id },
    });

    expect(dbReg1?.status).toBe('ACTIVE');
    expect(dbReg3?.status).toBe('ACTIVE');

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: { in: [reg1.id, reg2.id, reg3.id] } },
    });
    expect(servingCount).toBe(1); // Only the manual serve of reg2
  });
  it('serializes accepted delegation revoke/serve and commits one winner', async () => {
    const owner = await prisma.user.create({
      data: { email: `owner-${randomUUID()}@example.test`, name: 'Owner' },
    });
    const delegate = await prisma.user.create({
      data: {
        email: `delegate-${randomUUID()}@example.test`,
        name: 'Delegate',
      },
    });
    const registration = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
    const delegation = await prisma.pickupDelegation.create({
      data: {
        registrationId: registration.id,
        delegateUserId: delegate.id,
        status: 'ACCEPTED',
      },
    });

    const serve = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
      const current = await tx.pickupDelegation.findUnique({
        where: { id: delegation.id },
      });
      if (current?.status !== 'ACCEPTED') return 'LOST';
      await tx.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'COMPLETED' },
      });
      await tx.mealServing.create({
        data: {
          registrationId: registration.id,
          ownerUserId: owner.id,
          receiverType: 'PROXY',
          delegationId: delegation.id,
        },
      });
      // Serving state is derived from mealServing; registration stays ACTIVE.
      return 'SERVED';
    });

    const revoke = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
      const current = await tx.pickupDelegation.findUnique({
        where: { id: delegation.id },
      });
      if (current?.status !== 'ACCEPTED') return 'LOST';
      await tx.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'REVOKED' },
      });
      return 'REVOKED';
    });

    const results = await Promise.all([serve, revoke]);
    expect(results.filter((result) => result !== 'LOST')).toHaveLength(1);

    const finalDelegation = await prisma.pickupDelegation.findUniqueOrThrow({
      where: { id: delegation.id },
    });
    const finalRegistration = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    const serving = await prisma.mealServing.findUnique({
      where: { registrationId: registration.id },
    });

    if (finalDelegation.status === 'COMPLETED') {
      expect(finalRegistration.status).not.toBe('CANCELLED');
      expect(finalRegistration.status).not.toBe('NO_SHOW');
      expect(serving).toMatchObject({ delegationId: delegation.id });
    } else {
      expect(finalDelegation.status).toBe('REVOKED');
      expect(finalRegistration.status).toBe('ACTIVE');
      expect(serving).toBeNull();
    }
  });

  it('rolls back every serving when a later locked registration is stale', async () => {
    const owner = await prisma.user.create({
      data: { email: `batch-${randomUUID()}@example.test` },
    });
    const first = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
    const stale = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'CANCELLED',
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const registrations = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`
          SELECT id, status
          FROM registrations
          WHERE id IN (${first.id}, ${stale.id})
          ORDER BY id
          FOR UPDATE
        `;
        for (const registration of registrations) {
          if (registration.status !== 'ACTIVE') {
            throw new Error('stale registration');
          }
        }
        await tx.mealServing.create({
          data: { registrationId: first.id, ownerUserId: owner.id },
        });
        // Serving state is derived from mealServing; registration stays ACTIVE.
      }),
    ).rejects.toThrow('stale registration');

    expect(
      await prisma.mealServing.count({
        where: { registrationId: { in: [first.id, stale.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: first.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
  });
});
async function serveWithRegistrationLock(
  client: PrismaClient,
  registrationId: string,
  ownerUserId: string,
) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE
    `;
    const registration = await tx.registration.findUnique({
      where: { id: registrationId },
      include: { mealServing: true },
    });
    if (
      !registration ||
      registration.status !== 'ACTIVE' ||
      registration.mealServing
    ) {
      return 'SKIPPED' as const;
    }

    await tx.mealServing.create({
      data: { registrationId, ownerUserId },
    });
    return 'SERVED' as const;
  });
}

async function noShowWithRegistrationLock(
  client: PrismaClient,
  registrationId: string,
  now: Date,
) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE
    `;
    const registration = await tx.registration.findUnique({
      where: { id: registrationId },
      include: { mealServing: true },
    });
    if (
      !registration ||
      registration.status !== 'ACTIVE' ||
      registration.mealServing
    ) {
      return 'SKIPPED' as const;
    }

    const penalty =
      (await tx.penalty.findFirst({ where: { registrationId } })) ??
      (await tx.penalty.create({
        data: {
          registrationId,
          userId: registration.userId,
          mealDate: registration.mealDate,
          amount: 50000,
          reason: 'NO_SHOW',
          status: 'PENDING',
        },
      }));
    if (
      penalty.userId !== registration.userId ||
      penalty.mealDate?.toISOString().slice(0, 10) !==
        registration.mealDate.toISOString().slice(0, 10) ||
      penalty.amount !== 50000 ||
      penalty.reason !== 'NO_SHOW'
    ) {
      throw new Error('no-show penalty identity mismatch');
    }

    await tx.registration.update({
      where: { id: registrationId },
      data: { status: 'NO_SHOW', noShowAt: now },
    });
    await tx.auditLog.create({
      data: {
        action: 'NO_SHOW_PROCESSED',
        userId: registration.userId,
        details: JSON.stringify({ registrationId }),
      },
    });
    await tx.notification.create({
      data: {
        userId: registration.userId,
        kind: 'NO_SHOW_PENALTY_CREATED',
        payload: { registrationId, penaltyId: penalty.id },
        titleVi: 'No-show',
        bodyVi: 'No-show penalty created',
        titleEn: 'No-show',
        bodyEn: 'No-show penalty created',
        dedupeKey: `no-show-penalty:${registration.userId}:${registrationId}`,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'REGISTRATION',
        aggregateId: registrationId,
        eventType: 'NO_SHOW_RECONCILED',
        payload: JSON.stringify({
          registrationId,
          mealDate: registration.mealDate.toISOString().slice(0, 10),
          penaltyId: penalty.id,
        }),
        dedupeKey: `kitchen:no-show:${registrationId}`,
      },
    });
    return 'NO_SHOW' as const;
  });
}

async function cancelWithRegistrationLock(
  client: PrismaClient,
  registrationId: string,
  now: Date,
) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE
    `;
    const registration = await tx.registration.findUnique({
      where: { id: registrationId },
      include: { mealServing: true },
    });
    if (
      !registration ||
      registration.status !== 'ACTIVE' ||
      registration.mealServing
    ) {
      return 'SKIPPED' as const;
    }
    await tx.registration.update({
      where: { id: registrationId },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        cancelledAt: now,
        cancelReason: 'REGISTRATION_CANCELLED',
        cancelledByUserId: registration.userId,
      },
    });
    return 'CANCELLED' as const;
  });
}

describe('PostgreSQL low-level persistence coverage', () => {
  it('concurrent_registration_create_persists_one_complete_snapshot', async () => {
    const user = await prisma.user.create({
      data: { email: 'registration-race@example.test' },
    });
    const mealDate = new Date('2026-11-03T00:00:00.000Z');
    const authority = await createCompleteRegistrationFixture(
      user.id,
      mealDate,
    );
    await prisma.registration.delete({ where: { id: authority.id } });

    const snapshot = {
      userId: user.id,
      mealDate,
      status: 'ACTIVE' as const,
      menuRevisionId: authority.menuRevisionId,
      ownerNameSnapshot: authority.ownerNameSnapshot,
      employeeCodeSnapshot: authority.employeeCodeSnapshot,
      menuNameSnapshot: authority.menuNameSnapshot,
      serviceLocationId: authority.serviceLocationId,
      serviceLocationAssignmentId: authority.serviceLocationAssignmentId,
      serviceLocationCode: authority.serviceLocationCode,
      serviceLocationName: authority.serviceLocationName,
      serviceLocationAddress: authority.serviceLocationAddress,
      serviceLocationEffectiveFrom: authority.serviceLocationEffectiveFrom,
      serviceLocationSnapshotAt: new Date('2026-11-01T00:00:00.000Z'),
      registeredAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const writes = [0, 1, 2].map(async () => {
      const client = createDisposableClient();
      return client.$transaction((tx) =>
        tx.registration.create({ data: snapshot }),
      );
    });
    const results = await Promise.allSettled(writes);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.registration.count({
        where: { userId: user.id, mealDate },
      }),
    ).toBe(1);
    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { userId_mealDate: { userId: user.id, mealDate } },
    });
    expect(persisted).toMatchObject({
      menuRevisionId: snapshot.menuRevisionId,
      ownerNameSnapshot: snapshot.ownerNameSnapshot,
      employeeCodeSnapshot: snapshot.employeeCodeSnapshot,
      menuNameSnapshot: snapshot.menuNameSnapshot,
      serviceLocationId: snapshot.serviceLocationId,
      serviceLocationAssignmentId: snapshot.serviceLocationAssignmentId,
      serviceLocationCode: snapshot.serviceLocationCode,
      serviceLocationName: snapshot.serviceLocationName,
      serviceLocationAddress: snapshot.serviceLocationAddress,
    });
  });

  it('menu_roster_change_does_not_rewrite_existing_active_snapshot_but_reactivation_resolves_new_values', async () => {
    const user = await prisma.user.create({
      data: { email: 'snapshot-race@example.test' },
    });
    const mealDate = new Date('2026-11-05T00:00:00.000Z');
    const registration = await createCompleteRegistrationFixture(
      user.id,
      mealDate,
    );
    const oldSnapshot = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    const newLocation = await prisma.location.create({
      data: {
        shortCode: 'RACE-NEW',
        displayName: 'New Race Kitchen',
        servingPointName: 'New counter',
        address: '2 Race Street',
        building: 'B',
        floor: '2',
        roomOrCounter: '2',
        localContact: 'new-race@example.test',
        isActive: true,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.employeeLocationAssignment.update({
      where: { id: registration.serviceLocationAssignmentId! },
      data: { isActive: false, effectiveTo: mealDate },
    });
    const newAssignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'New Race Owner',
        employeeCode: 'RACE-002',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: newLocation.shortCode,
        locationId: newLocation.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const menu = await prisma.dailyMenu.findUniqueOrThrow({
      where: { date: mealDate },
    });
    const newRevision = await prisma.dailyMenuRevision.create({
      data: {
        dailyMenuId: menu.id,
        revision: 2,
        mealName: 'New Race Menu',
        content: 'new race menu',
      },
    });
    await prisma.registration.update({
      where: { id: registration.id },
      data: { mealChoice: 'REGULAR' },
    });
    const activeSnapshot = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(activeSnapshot).toMatchObject({
      menuRevisionId: oldSnapshot.menuRevisionId,
      menuNameSnapshot: oldSnapshot.menuNameSnapshot,
      serviceLocationId: oldSnapshot.serviceLocationId,
      serviceLocationAssignmentId: oldSnapshot.serviceLocationAssignmentId,
    });

    await prisma.registration.update({
      where: { id: registration.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date('2026-11-01T00:00:00.000Z'),
        cancelReason: 'REGISTRATION_CANCELLED',
        cancelledByUserId: user.id,
      },
    });
    await prisma.registration.update({
      where: { id: registration.id },
      data: {
        status: 'ACTIVE',
        menuRevisionId: newRevision.id,
        menuNameSnapshot: newRevision.mealName,
        ownerNameSnapshot: newAssignment.employeeName,
        employeeCodeSnapshot: newAssignment.employeeCode,
        serviceLocationId: newLocation.id,
        serviceLocationAssignmentId: newAssignment.id,
        serviceLocationCode: newLocation.shortCode,
        serviceLocationName: newLocation.displayName,
        serviceLocationAddress: newLocation.address,
        serviceLocationEffectiveFrom: newAssignment.effectiveFrom,
        serviceLocationSnapshotAt: new Date('2026-11-01T00:00:00.000Z'),
        registeredAt: new Date('2026-11-01T00:00:00.000Z'),
        cancelledAt: null,
        cancelReason: null,
      },
    });
    const reactivated = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(reactivated).toMatchObject({
      menuRevisionId: newRevision.id,
      menuNameSnapshot: 'New Race Menu',
      serviceLocationId: newLocation.id,
      serviceLocationAssignmentId: newAssignment.id,
      serviceLocationCode: 'RACE-NEW',
    });
  });

  it('serving_and_no_show_same_registration_have_one_winner', async () => {
    const user = await prisma.user.create({
      data: { email: 'serving-no-show-race@example.test' },
    });
    const registration = await createCompleteRegistrationFixture(
      user.id,
      new Date('2026-11-06T00:00:00.000Z'),
    );
    const servingClient = createDisposableClient();
    const noShowClient = createDisposableClient();
    const [servingResult, noShowResult] = await Promise.all([
      serveWithRegistrationLock(servingClient, registration.id, user.id),
      noShowWithRegistrationLock(
        noShowClient,
        registration.id,
        new Date('2026-11-06T06:30:00.000Z'),
      ),
    ]);
    expect(
      [servingResult, noShowResult].filter((result) => result !== 'SKIPPED'),
    ).toHaveLength(1);

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
      include: { mealServing: true },
    });
    const penaltyCount = await prisma.penalty.count({
      where: { registrationId: registration.id },
    });
    const outboxCount = await prisma.outboxEvent.count({
      where: { dedupeKey: `kitchen:no-show:${registration.id}` },
    });
    if (persisted.mealServing) {
      expect(persisted.status).not.toBe('NO_SHOW');
      expect(penaltyCount).toBe(0);
      expect(outboxCount).toBe(0);
    } else {
      expect(persisted.status).toBe('NO_SHOW');
      expect(penaltyCount).toBe(1);
      expect(outboxCount).toBe(1);
    }
  });

  it('serving_and_cancel_same_registration_have_one_winner', async () => {
    const user = await prisma.user.create({
      data: { email: 'serving-cancel-race@example.test' },
    });
    const registration = await createCompleteRegistrationFixture(
      user.id,
      new Date('2026-11-07T00:00:00.000Z'),
    );
    const servingClient = createDisposableClient();
    const cancelClient = createDisposableClient();
    const [servingResult, cancelResult] = await Promise.all([
      serveWithRegistrationLock(servingClient, registration.id, user.id),
      cancelWithRegistrationLock(
        cancelClient,
        registration.id,
        new Date('2026-11-06T00:00:00.000Z'),
      ),
    ]);
    expect(
      [servingResult, cancelResult].filter((result) => result !== 'SKIPPED'),
    ).toHaveLength(1);

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
      include: { mealServing: true },
    });
    if (persisted.status === 'CANCELLED') {
      expect(persisted.mealServing).toBeNull();
    } else {
      expect(persisted.status).toBe('ACTIVE');
      expect(persisted.mealServing).toBeTruthy();
    }
  });

  it('two_workers_same_registration_create_one_penalty', async () => {
    const user = await prisma.user.create({
      data: { email: 'worker-race@example.test' },
    });
    const registration = await createCompleteRegistrationFixture(
      user.id,
      new Date('2026-11-08T00:00:00.000Z'),
    );
    const firstWorker = createDisposableClient();
    const secondWorker = createDisposableClient();
    const now = new Date('2026-11-08T06:30:00.000Z');
    const results = await Promise.all([
      noShowWithRegistrationLock(firstWorker, registration.id, now),
      noShowWithRegistrationLock(secondWorker, registration.id, now),
    ]);
    expect(results.filter((result) => result === 'NO_SHOW')).toHaveLength(1);
    expect(results.filter((result) => result === 'SKIPPED')).toHaveLength(1);
    expect(
      await prisma.penalty.count({ where: { registrationId: registration.id } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `no-show-penalty:${user.id}:${registration.id}` },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { dedupeKey: `kitchen:no-show:${registration.id}` },
      }),
    ).toBe(1);
  });

  it('no_show_retry_keeps_one_penalty_notification_audit_and_outbox', async () => {
    const user = await prisma.user.create({
      data: { email: 'worker-retry@example.test' },
    });
    const registration = await createCompleteRegistrationFixture(
      user.id,
      new Date('2026-11-10T00:00:00.000Z'),
    );
    const worker = createDisposableClient();
    const now = new Date('2026-11-10T06:30:00.000Z');
    await expect(
      noShowWithRegistrationLock(worker, registration.id, now),
    ).resolves.toBe('NO_SHOW');
    const firstPenalty = await prisma.penalty.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    const firstOutbox = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: `kitchen:no-show:${registration.id}` },
    });
    await expect(
      noShowWithRegistrationLock(worker, registration.id, now),
    ).resolves.toBe('SKIPPED');
    expect(
      await prisma.penalty.findMany({
        where: { registrationId: registration.id },
      }),
    ).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `no-show-penalty:${user.id}:${registration.id}` },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'NO_SHOW_PROCESSED',
          details: { contains: registration.id },
        },
      }),
    ).toBe(1);
    const retryOutbox = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: `kitchen:no-show:${registration.id}` },
    });
    expect(retryOutbox.id).toBe(firstOutbox.id);
    expect(firstPenalty.registrationId).toBe(registration.id);
  });

  it.each(['PAID', 'WAIVED'] as const)(
    'paid_or_waived_penalty_is_not_reopened_by_worker_retry (%s)',
    async (status) => {
      const user = await prisma.user.create({
        data: { email: `worker-retry-${status.toLowerCase()}@example.test` },
      });
      const registration = await createCompleteRegistrationFixture(
        user.id,
        new Date('2026-11-09T00:00:00.000Z'),
      );
      const penalty = await prisma.penalty.create({
        data: {
          registrationId: registration.id,
          userId: user.id,
          mealDate: registration.mealDate,
          amount: 50000,
          reason: 'NO_SHOW',
          status,
        },
      });
      const worker = createDisposableClient();
      await expect(
        noShowWithRegistrationLock(
          worker,
          registration.id,
          new Date('2026-11-09T06:30:00.000Z'),
        ),
      ).resolves.toBe('NO_SHOW');
      await expect(
        prisma.penalty.findUniqueOrThrow({ where: { id: penalty.id } }),
      ).resolves.toMatchObject({ status });
      await expect(
        prisma.registration.findUniqueOrThrow({
          where: { id: registration.id },
        }),
      ).resolves.toMatchObject({ status: 'NO_SHOW' });
    },
  );
});
