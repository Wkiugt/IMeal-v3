import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PickupService } from '../src/pickup/pickup.service.js';
import { RegistrationsService } from '../src/registrations/registrations.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

const MEAL_DATE = new Date('2026-09-28T00:00:00.000Z');
const MEAL_DATE_KEY = '2026-09-28';
const SERVING_TIME = new Date('2026-09-28T04:00:00.000Z');
const NO_SHOW_TIME = new Date('2026-09-28T06:30:00.000Z');

const kitchenActor = {
  id: 'kitchen-user',
  userId: 'kitchen-user',
  email: 'kitchen@example.test',
  name: 'Kitchen',
  roles: [] as string[],
  permissions: ['kitchen.serve'] as string[],
  sessionId: 'kitchen-session',
  isActive: true,
};

type RealPrismaOwner = { prisma: PrismaClient };
type TestPrismaRegistry = {
  __imealRegisterTestPrismaClient?: (client: PrismaClient) => void;
};
type NoShowWorker = RealPrismaOwner & {
  processNoShows: (
    targetDate: string,
    options: { force: boolean; currentTime: Date },
  ) => Promise<{ processedCount: number }>;
};

function patchPrisma(service: RealPrismaOwner, client: PrismaClient) {
  const original = service.prisma;
  service.prisma = client;
  return original;
}

function trackClient(client: PrismaClient): PrismaClient {
  (globalThis as typeof globalThis & TestPrismaRegistry)
    .__imealRegisterTestPrismaClient?.(client);
  return client;
}

async function createWorkerService(client: PrismaClient) {
  const workerPath = pathToFileURL(
    resolve(process.cwd(), '../worker/src/no-show-worker.service.ts'),
  ).href;
  const workerModule = (await import(workerPath)) as {
    NoShowWorkerService: new () => NoShowWorker;
  };
  const service = new workerModule.NoShowWorkerService();
  const ownedClient = patchPrisma(service, client);
  return { service, ownedClient };
}

async function disconnectOwnedPrisma(service: RealPrismaOwner) {
  await service.prisma.$disconnect();
}

async function createServingWorld(
  client: PrismaClient,
  options: { registrationCount?: number } = {},
) {
  const permission = await client.permission.upsert({
    where: { name: 'kitchen.serve' },
    update: {},
    create: { name: 'kitchen.serve' },
  });
  const kitchen = await client.user.create({
    data: { id: kitchenActor.id, email: kitchenActor.email, name: kitchenActor.name },
  });
  await client.userPermission.create({
    data: { userId: kitchen.id, permissionId: permission.id },
  });

  const owner = await client.user.create({
    data: { email: `owner-${Date.now()}-${Math.random()}@example.test`, name: 'Owner' },
  });
  const location = await client.location.create({
    data: {
      shortCode: `HQ${Math.floor(Math.random() * 100000)}`,
      displayName: 'Original Kitchen',
      servingPointName: 'Original counter',
      address: '1 Original Street',
      building: 'A',
      floor: '1',
      roomOrCounter: '1',
      localContact: 'original@example.test',
      isActive: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const policy = await client.locationPolicy.create({
    data: {
      locationId: location.id,
      latitude: 10,
      longitude: 106,
      accuracySource: 'TEST',
      geofenceRadiusMeters: 100,
      maxFixAgeSeconds: 3600,
      maxAccuracyMeters: 100,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true,
      updatedAt: SERVING_TIME,
    },
  });
  const weeklyMenu = await client.weeklyMenu.create({
    data: {
      startDate: MEAL_DATE,
      endDate: MEAL_DATE,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const dailyMenu = await client.dailyMenu.create({
    data: { weeklyMenuId: weeklyMenu.id, date: MEAL_DATE, isEnabled: true },
  });
  const revision = await client.dailyMenuRevision.create({
    data: {
      dailyMenuId: dailyMenu.id,
      revision: 1,
      mealName: 'Original lunch',
      description: 'Original description',
      imageUrl: 'https://example.test/original.jpg',
      content: 'original',
    },
  });
  await client.mealDay.create({
    data: {
      dailyMenuId: dailyMenu.id,
      mealType: 'LUNCH',
      isServingReady: true,
      serviceStartAt: new Date('2026-09-28T03:30:00.000Z'),
      serviceEndAt: new Date('2026-09-28T06:30:00.000Z'),
    },
  });
  await client.appSetting.create({
    data: { key: `isServingReady:${MEAL_DATE_KEY}`, value: 'true' },
  });
  const assignment = await client.employeeLocationAssignment.create({
    data: {
      userId: owner.id,
      normalizedEmail: owner.email,
      employeeName: 'Original Owner',
      employeeCode: 'ORIGINAL-001',
      isActive: true,
      role: 'STAFF',
      serviceLocationCode: location.shortCode,
      locationId: location.id,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });

  const registrations = [];
  const count = options.registrationCount ?? 1;
  for (let index = 0; index < count; index += 1) {
    const mealOwner =
      index === 0
        ? owner
        : await client.user.create({
            data: {
              email: `owner-${Date.now()}-${index}-${Math.random()}@example.test`,
              name: `Owner ${index}`,
            },
          });
    const mealAssignment =
      index === 0
        ? assignment
        : await client.employeeLocationAssignment.create({
            data: {
              userId: mealOwner.id,
              normalizedEmail: mealOwner.email,
              employeeName: `Original Owner ${index}`,
              employeeCode: `ORIGINAL-${index}`,
              isActive: true,
              role: 'STAFF',
              serviceLocationCode: location.shortCode,
              locationId: location.id,
              effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            },
          });
    registrations.push(
      await client.registration.create({
        data: {
          userId: mealOwner.id,
          mealDate: MEAL_DATE,
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
          menuRevisionId: revision.id,
          ownerNameSnapshot: mealAssignment.employeeName,
          employeeCodeSnapshot: mealAssignment.employeeCode,
          menuNameSnapshot: revision.mealName,
          menuDescriptionSnapshot: revision.description,
          menuImageSnapshot: revision.imageUrl,
          registeredAt: SERVING_TIME,
          serviceLocationId: location.id,
          serviceLocationAssignmentId: mealAssignment.id,
          serviceLocationCode: location.shortCode,
          serviceLocationName: location.displayName,
          serviceLocationAddress: location.address,
          serviceLocationEffectiveFrom: mealAssignment.effectiveFrom,
          serviceLocationSnapshotAt: SERVING_TIME,
        },
      }),
    );
  }

  const qrHash = `qr-${Date.now()}-${Math.random()}`;
  await client.servingVerification.create({
    data: {
      id: qrHash,
      presenterUserId: owner.id,
      locationId: location.id,
      locationPolicyId: policy.id,
      result: 'VALID',
      capturedAt: SERVING_TIME,
      verifiedAt: SERVING_TIME,
      accuracyMeters: 10,
      safeVerificationCode: 'verified',
      intentNonce: 'nonce',
      retentionUntil: new Date('2027-01-01T00:00:00.000Z'),
    },
  });
  const session = await client.pickupSession.create({
    data: {
      userId: owner.id,
      presenterUserId: owner.id,
      mealDate: MEAL_DATE,
      registrationIds: registrations.map(({ id }) => id).sort(),
      intentRegistrationIds: registrations.map(({ id }) => id).sort(),
      intentHash: qrHash,
      intentNonce: 'nonce',
      qrHash,
      locationId: location.id,
      servingVerificationId: qrHash,
      expiresAt: new Date('2026-09-28T04:00:30.000Z'),
    },
  });
  return { kitchen, owner, location, policy, revision, dailyMenu, assignment, registrations, session };
}

function createPickupService(client: PrismaClient) {
  const service = new PickupService();
  const ownedClient = patchPrisma(
    service as unknown as RealPrismaOwner,
    client,
  );
  return { service, ownedClient };
}

async function createRegistrationService(client: PrismaClient) {
  const notifications = new NotificationsService();
  const ownedNotificationsClient = (notifications as unknown as RealPrismaOwner).prisma;
  await disconnectOwnedPrisma(notifications as unknown as RealPrismaOwner);
  const service = new RegistrationsService(notifications);
  const ownedClient = patchPrisma(
    service as unknown as RealPrismaOwner,
    client,
  );
  return { service, ownedClient, ownedNotificationsClient };
}

describe('Production PostgreSQL concurrency paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVING_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes real PickupService confirmation against real NoShowWorkerService', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const pickupClient = trackClient(new PrismaClient());
    const workerClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);
    const worker = await createWorkerService(workerClient);
    await pickup.ownedClient.$disconnect();
    await worker.ownedClient.$disconnect();

    const pickupPromise = pickup.service.confirmPickup(
      { pickupSessionId: world.session.id, idempotencyKey: 'race-key' },
      kitchenActor,
    );
    const workerPromise = worker.service.processNoShows(MEAL_DATE_KEY, {
      force: true,
      currentTime: NO_SHOW_TIME,
    });
    const [pickupResult, workerResult] = await Promise.allSettled([
      pickupPromise,
      workerPromise,
    ]);

    expect(workerResult.status).toBe('fulfilled');
    const registration = await client.registration.findUniqueOrThrow({
      where: { id: world.registrations[0].id },
      include: { mealServing: true, penalties: true },
    });
    expect(
      Boolean(registration.mealServing) && registration.status === 'NO_SHOW',
    ).toBe(false);
    if (pickupResult.status === 'fulfilled') {
      expect(registration.status).toBe('ACTIVE');
      expect(registration.mealServing).toBeTruthy();
      expect(registration.penalties).toHaveLength(0);
    } else {
      expect(registration.status).toBe('NO_SHOW');
      expect(registration.mealServing).toBeNull();
      expect(registration.penalties).toHaveLength(1);
    }
  });

  it('serializes real PickupService confirmation against real RegistrationsService cancellation', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const pickupClient = trackClient(new PrismaClient());
    const registrationClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);
    const registration = await createRegistrationService(registrationClient);
    await pickup.ownedClient.$disconnect();
    await registration.ownedClient.$disconnect();
    await registration.ownedNotificationsClient.$disconnect();

    const transactionClient = registrationClient as unknown as {
      $transaction: (
        callback: (tx: unknown) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const originalTransaction = transactionClient.$transaction.bind(
      registrationClient,
    );
    let transactionEntered!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      transactionEntered = resolve;
    });
    let releaseTransaction!: () => void;
    const transactionRelease = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    transactionClient.$transaction = (callback, options) =>
      originalTransaction(
        async (tx) => {
          transactionEntered();
          await transactionRelease;
          return callback(tx);
        },
        options,
      );

    vi.setSystemTime(new Date('2026-09-27T06:00:00.000Z'));
    const cancelPromise = registration.service.batchRegister(world.owner.id, [
      { mealDate: MEAL_DATE_KEY, status: 'CANCELLED' },
    ]);
    await transactionStarted;
    vi.setSystemTime(SERVING_TIME);
    const pickupPromise = pickup.service.confirmPickup(
      { pickupSessionId: world.session.id, idempotencyKey: 'cancel-race-key' },
      kitchenActor,
    );
    releaseTransaction();
    const [pickupResult, cancelResult] = await Promise.allSettled([
      pickupPromise,
      cancelPromise,
    ]);

    if (cancelResult.status !== 'fulfilled') {
      throw cancelResult.reason;
    }
    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.registrations[0].id },
      include: { mealServing: true },
    });
    expect(pickupResult.status).toBe('rejected');
    expect(finalRegistration.status).toBe('CANCELLED');
    expect(finalRegistration.mealServing).toBeNull();
    expect(cancelResult.value[0]).toMatchObject({ success: true });
    expect(
      await client.auditLog.count({
        where: { action: 'registration_cancelled' },
      }),
    ).toBe(1);
  });

  it('resolves real registration reactivation snapshots while preserving served snapshots', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const registrationClient = trackClient(new PrismaClient());
    const pickupClient = trackClient(new PrismaClient());
    const registration = await createRegistrationService(registrationClient);
    const pickup = createPickupService(pickupClient);
    await registration.ownedClient.$disconnect();
    await registration.ownedNotificationsClient.$disconnect();
    const reactivationDate = '2026-09-29';
    const reactivationDateValue = new Date(`${reactivationDate}T00:00:00.000Z`);
    const reactivationMenu = await client.weeklyMenu.create({
      data: {
        startDate: reactivationDateValue,
        endDate: reactivationDateValue,
        publishedAt: SERVING_TIME,
      },
    });
    const reactivationDailyMenu = await client.dailyMenu.create({
      data: {
        weeklyMenuId: reactivationMenu.id,
        date: reactivationDateValue,
      },
    });
    await client.dailyMenuRevision.create({
      data: {
        dailyMenuId: reactivationDailyMenu.id,
        revision: 1,
        mealName: 'Original reactivation lunch',
        description: 'Original reactivation description',
        imageUrl: 'https://example.test/original-reactivation.jpg',
        content: 'original reactivation',
      },
    });
    const activeOld = await registration.service.batchRegister(world.owner.id, [
      { mealDate: reactivationDate, status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
    expect(activeOld[0]).toMatchObject({ success: true });
    const oldRegistration = await client.registration.findUniqueOrThrow({
      where: { userId_mealDate: { userId: world.owner.id, mealDate: MEAL_DATE } },
    });
    const oldSnapshot = {
      menuRevisionId: oldRegistration.menuRevisionId,
      ownerNameSnapshot: oldRegistration.ownerNameSnapshot,
      serviceLocationId: oldRegistration.serviceLocationId,
    };

    const served = await pickup.service.confirmPickup(
      { pickupSessionId: world.session.id, idempotencyKey: 'snapshot-serving-key' },
      kitchenActor,
    );
    expect(served.success).toBe(true);
    const serving = await client.mealServing.findUniqueOrThrow({
      where: { registrationId: oldRegistration.id },
    });
    expect(serving).toMatchObject({
      menuRevisionId: oldSnapshot.menuRevisionId,
      ownerNameSnapshot: oldSnapshot.ownerNameSnapshot,
      locationId: oldSnapshot.serviceLocationId,
    });

    const reactivationRegistration = await client.registration.findUniqueOrThrow({
      where: {
        userId_mealDate: {
          userId: world.owner.id,
          mealDate: new Date(`${reactivationDate}T00:00:00.000Z`),
        },
      },
    });
    const delegate = await client.user.create({
      data: {
        email: `delegate-${Date.now()}@example.test`,
        name: 'Delegate',
      },
    });
    const delegation = await client.pickupDelegation.create({
      data: {
        registrationId: reactivationRegistration.id,
        delegateUserId: delegate.id,
        status: 'ACCEPTED',
      },
    });
    const cancelled = await registration.service.batchRegister(world.owner.id, [
      { mealDate: reactivationDate, status: 'CANCELLED' },
    ]);
    expect(cancelled[0]).toMatchObject({ success: true });

    const newLocation = await client.location.create({
      data: {
        shortCode: `NEW${Math.floor(Math.random() * 100000)}`,
        displayName: 'New Kitchen',
        servingPointName: 'New counter',
        address: '2 New Street',
        building: 'B',
        floor: '2',
        roomOrCounter: '2',
        localContact: 'new@example.test',
        isActive: true,
        effectiveFrom: new Date('2026-09-29T00:00:00.000Z'),
      },
    });
    await client.employeeLocationAssignment.update({
      where: { id: world.assignment.id },
      data: { effectiveTo: new Date('2026-09-29T00:00:00.000Z') },
    });
    const newAssignment = await client.employeeLocationAssignment.create({
      data: {
        userId: world.owner.id,
        normalizedEmail: world.owner.email,
        employeeName: 'Reactivated Owner',
        employeeCode: 'REACTIVATED-002',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: newLocation.shortCode,
        locationId: newLocation.id,
        effectiveFrom: new Date('2026-09-29T00:00:00.000Z'),
      },
    });
    const newRevision = await client.dailyMenuRevision.create({
      data: {
        dailyMenuId: reactivationDailyMenu.id,
        revision: 2,
        mealName: 'Reactivated lunch',
        description: 'Reactivated description',
        imageUrl: 'https://example.test/reactivated.jpg',
        content: 'reactivated',
      },
    });

    const reactivated = await registration.service.batchRegister(world.owner.id, [
      { mealDate: reactivationDate, status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
    expect(reactivated[0]).toMatchObject({ success: true });
    const finalReactivated = await client.registration.findUniqueOrThrow({
      where: { id: reactivationRegistration.id },
    });
    expect(finalReactivated).toMatchObject({
      status: 'ACTIVE',
      menuRevisionId: newRevision.id,
      menuNameSnapshot: 'Reactivated lunch',
      ownerNameSnapshot: newAssignment.employeeName,
      employeeCodeSnapshot: newAssignment.employeeCode,
      serviceLocationId: newLocation.id,
      serviceLocationAssignmentId: newAssignment.id,
      mealChoice: 'REGULAR',
    });
    expect(finalReactivated.version).toBeGreaterThan(1);
    expect(oldRegistration.menuRevisionId).toBe(oldSnapshot.menuRevisionId);
    expect(
      await client.auditLog.count({
        where: { action: 'registration_reactivated' },
      }),
    ).toBe(1);
    const finalDelegation = await client.pickupDelegation.findUniqueOrThrow({
      where: { id: delegation.id },
    });
    expect(finalDelegation.status).toBe('REVOKED');
    expect(
      await client.notification.count({
        where: {
          kind: 'DELEGATION_REVOKED',
          userId: delegate.id,
        },
      }),
    ).toBe(1);
    expect(
      await client.outboxEvent.count({
        where: {
          dedupeKey: `notification-delivery:${(
            await client.notification.findFirstOrThrow({
              where: { kind: 'DELEGATION_REVOKED', userId: delegate.id },
            })
          ).id}`,
        },
      }),
    ).toBe(1);
  });
  it('rolls back production serving, idempotency, audit, delegation and notification side effects on failure', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const delegate = await client.user.create({
      data: {
        email: `failing-delegate-${Date.now()}@example.test`,
        name: 'Failing Delegate',
      },
    });
    await client.pickupDelegation.create({
      data: {
        registrationId: world.registrations[0].id,
        delegateUserId: delegate.id,
        status: 'ACCEPTED',
      },
    });
    await client.servingVerification.update({
      where: { id: world.session.qrHash },
      data: { presenterUserId: delegate.id },
    });
    await client.pickupSession.update({
      where: { id: world.session.id },
      data: { presenterUserId: delegate.id },
    });
    await client.pickupSession.update({
      where: { id: world.session.id },
      data: { userId: delegate.id },
    });

    const failingNotifications = {
      publish: async () => {
        throw new Error('injected notification failure');
      },
    };
    const pickupService = new PickupService(
      undefined,
      failingNotifications as never,
    );
    const pickupClient = trackClient(new PrismaClient());
    const ownedClient = patchPrisma(
      pickupService as unknown as RealPrismaOwner,
      pickupClient,
    );
    await ownedClient.$disconnect();

    await expect(
      pickupService.confirmPickup(
        { pickupSessionId: world.session.id, idempotencyKey: 'rollback-key' },
        kitchenActor,
      ),
    ).rejects.toThrow('injected notification failure');
    expect(
      await client.mealServing.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.mealEvent.count({
        where: { mealServing: { registrationId: world.registrations[0].id } },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({ where: { action: 'SERVING_CONFIRMED' } }),
    ).toBe(0);
    expect(
      await client.notification.count({
        where: { userId: world.owner.id },
      }),
    ).toBe(0);
    expect(
      await client.outboxEvent.count({
        where: { aggregateId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.servingConfirmRequest.count({
        where: { callerUserId: kitchenActor.id, idempotencyKey: 'rollback-key' },
      }),
    ).toBe(0);
    expect(
      await client.pickupSession.findUniqueOrThrow({
        where: { id: world.session.id },
      }),
    ).toMatchObject({ consumedAt: null });
  });


  it('confirms duplicate production requests idempotently and rejects a changed body', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const firstClient = trackClient(new PrismaClient());
    const retryClient = trackClient(new PrismaClient());
    const first = createPickupService(firstClient);
    const retry = createPickupService(retryClient);
    await first.ownedClient.$disconnect();
    await retry.ownedClient.$disconnect();

    const body = { pickupSessionId: world.session.id, idempotencyKey: 'same-key' };
    const [firstResult, retryResult] = await Promise.all([
      first.service.confirmPickup(body, kitchenActor),
      retry.service.confirmPickup(body, kitchenActor),
    ]);
    expect(retryResult).toEqual(firstResult);
    expect(await client.mealServing.count({ where: { registrationId: world.registrations[0].id } })).toBe(1);
    expect(await client.servingConfirmRequest.count({ where: { callerUserId: kitchenActor.id, idempotencyKey: body.idempotencyKey } })).toBe(1);

    await expect(
      retry.service.confirmPickup(
        { pickupSessionId: 'different-session', idempotencyKey: body.idempotencyKey },
        kitchenActor,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(await client.mealServing.count({ where: { registrationId: world.registrations[0].id } })).toBe(1);
  });

  it('rolls back the real confirmation transaction and all side effects for a stale item', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 2 });
    const pickupClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);
    await pickup.ownedClient.$disconnect();
    await client.registration.update({
      where: { id: world.registrations[1].id },
      data: {
        status: 'CANCELLED',
        cancelledAt: SERVING_TIME,
        cancelReason: 'TEST_STALE',
        cancelledByUserId: world.registrations[1].userId,
      },
    });

    await expect(
      pickup.service.confirmPickup(
        { pickupSessionId: world.session.id, idempotencyKey: 'stale-key' },
        kitchenActor,
      ),
    ).rejects.toMatchObject({ response: { code: 'PICKUP_INTENT_CONFLICT' } });
    expect(
      await client.mealServing.count({
        where: { registrationId: { in: world.registrations.map(({ id }) => id) } },
      }),
    ).toBe(0);
    expect(
      await client.servingConfirmRequest.count({
        where: { callerUserId: kitchenActor.id, idempotencyKey: 'stale-key' },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({ where: { action: 'SERVING_CONFIRMED' } }),
    ).toBe(0);
    expect(
      await client.mealEvent.count({
        where: { mealServing: { registrationId: { in: world.registrations.map(({ id }) => id) } } },
      }),
    ).toBe(0);
  });
});
