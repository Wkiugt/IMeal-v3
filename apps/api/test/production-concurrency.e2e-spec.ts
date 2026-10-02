import { PrismaClient, type Prisma } from '@prisma/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AdminUsersService } from '../src/admin/users/admin-users.service.js';
import { DelegationsService } from '../src/delegations/delegations.service.js';
import { PickupService } from '../src/pickup/pickup.service.js';
import { RegistrationsService } from '../src/registrations/registrations.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { WeeklyMenusService } from '../src/admin/weekly-menus/weekly-menus.service.js';
import { SessionService } from '../src/auth/session.service.js';
import { AllowlistService } from '../src/auth/allowlist.service.js';
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
function createAdminUsersService(client: PrismaClient) {
  return new AdminUsersService(
    client as never,
    new NotificationsService(client as never),
  );
}

function patchPrisma(service: RealPrismaOwner, client: PrismaClient) {
  const original = service.prisma;
  service.prisma = client;
  return original;
}

function trackClient(client: PrismaClient): PrismaClient {
  (
    globalThis as typeof globalThis & TestPrismaRegistry
  ).__imealRegisterTestPrismaClient?.(client);
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
    data: {
      id: kitchenActor.id,
      email: kitchenActor.email,
      name: kitchenActor.name,
    },
  });
  await client.userPermission.create({
    data: { userId: kitchen.id, permissionId: permission.id },
  });

  const owner = await client.user.create({
    data: { email: 'owner@example.test', name: 'Owner' },
  });
  const location = await client.location.create({
    data: {
      shortCode: 'HQ-TEST',
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
              email: `owner-${index}@example.test`,
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
  const qrHash = 'qr-production-concurrency';
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
  return {
    kitchen,
    owner,
    location,
    policy,
    revision,
    dailyMenu,
    assignment,
    registrations,
    session,
  };
}

function createPickupService(client: PrismaClient) {
  const service = new PickupService(client as never);
  return { service };
}

async function createRegistrationService(client: PrismaClient) {
  const notifications = new NotificationsService(client as never);
  const service = new RegistrationsService(client as never, notifications);
  return { service };
}

async function createWeeklyMenusService(client: PrismaClient) {
  const notifications = new NotificationsService(client as never);
  const service = new WeeklyMenusService(notifications, client as never);
  return { service };
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
    await worker.ownedClient?.$disconnect();

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

    const transactionClient = registrationClient as unknown as {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const originalTransaction =
      transactionClient.$transaction.bind(registrationClient);
    let transactionEntered!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      transactionEntered = resolve;
    });
    let releaseTransaction!: () => void;
    const transactionRelease = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    transactionClient.$transaction = (callback, options) =>
      originalTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${world.registrations[0].id} FOR UPDATE`;
        transactionEntered();
        await transactionRelease;
        return callback(tx);
      }, options);

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
    if (pickupResult.status !== 'rejected') {
      throw new Error('Pickup unexpectedly won the cancellation race');
    }
    expect(pickupResult.reason).toMatchObject({
      response: { code: 'PICKUP_INTENT_CONFLICT' },
    });
    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.registrations[0].id },
      include: { mealServing: true },
    });
    expect(finalRegistration.status).toBe('CANCELLED');
    expect(finalRegistration.mealServing).toBeNull();
    expect(cancelResult.value[0]).toMatchObject({ success: true });
    expect(
      await client.mealServing.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.servingConfirmRequest.count({
        where: {
          callerUserId: kitchenActor.id,
          idempotencyKey: 'cancel-race-key',
        },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({
        where: { action: 'SERVING_CONFIRMED' },
      }),
    ).toBe(0);
    expect(
      await client.mealEvent.count({
        where: { mealServing: { registrationId: world.registrations[0].id } },
      }),
    ).toBe(0);
    expect(
      await client.pickupSession.findUniqueOrThrow({
        where: { id: world.session.id },
      }),
    ).toMatchObject({ consumedAt: null });
    expect(
      await client.auditLog.count({
        where: { action: 'registration_cancelled' },
      }),
    ).toBe(1);
  });
  it('serializes account disable after pickup registration lock without deadlock', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const pickupClient = trackClient(new PrismaClient());
    const disableClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);

    type TransactionClientOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const pickupTransaction = pickupClient as unknown as TransactionClientOwner;
    const originalPickupTransaction =
      pickupTransaction.$transaction.bind(pickupClient);
    let pickupLockEntered!: () => void;
    const pickupLockStarted = new Promise<void>((resolve) => {
      pickupLockEntered = resolve;
    });
    let releasePickupLock!: () => void;
    const pickupLockRelease = new Promise<void>((resolve) => {
      releasePickupLock = resolve;
    });
    pickupTransaction.$transaction = (callback, options) =>
      originalPickupTransaction(async (tx) => {
        await tx.$queryRaw`
            SELECT id FROM registrations
            WHERE id = ${world.registrations[0].id}
            FOR UPDATE
          `;
        pickupLockEntered();
        await pickupLockRelease;
        return callback(tx);
      }, options);

    const disableTransaction =
      disableClient as unknown as TransactionClientOwner;
    const originalDisableTransaction =
      disableTransaction.$transaction.bind(disableClient);
    let disableTransactionEntered!: () => void;
    const disableTransactionStarted = new Promise<void>((resolve) => {
      disableTransactionEntered = resolve;
    });
    disableTransaction.$transaction = (callback, options) =>
      originalDisableTransaction(async (tx) => {
        disableTransactionEntered();
        return callback(tx);
      }, options);

    vi.setSystemTime(SERVING_TIME);
    const pickupPromise = pickup.service.confirmPickup(
      { pickupSessionId: world.session.id, idempotencyKey: 'disable-race-key' },
      kitchenActor,
    );
    await pickupLockStarted;
    const adminUsersService = createAdminUsersService(disableClient);
    const disablePromise = adminUsersService.disable(
      world.owner.id,
      world.kitchen.id,
      SERVING_TIME,
    );
    await disableTransactionStarted;
    releasePickupLock();

    const [pickupResult, disableResult] = await Promise.race([
      Promise.allSettled([pickupPromise, disablePromise]),
      sleep(5_000).then(() => {
        throw new Error('account-disable/pickup race did not complete');
      }),
    ]);
    if (pickupResult.status !== 'fulfilled') throw pickupResult.reason;
    if (disableResult.status !== 'fulfilled') throw disableResult.reason;
    expect(disableResult.value).toMatchObject({
      changed: true,
      affected: { registrationsCancelled: 0 },
    });

    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.registrations[0].id },
      include: { mealServing: true },
    });
    expect(finalRegistration).toMatchObject({
      status: 'ACTIVE',
      mealServing: { id: expect.any(String) },
    });
    expect(
      await client.user.findUniqueOrThrow({ where: { id: world.owner.id } }),
    ).toMatchObject({ isActive: false });
    expect(
      await client.auditLog.count({
        where: { action: 'registration_account_disabled' },
      }),
    ).toBe(0);
    expect(
      await client.notification.count({
        where: { kind: 'DELEGATION_REVOKED' },
      }),
    ).toBe(0);
    expect(
      await client.outboxEvent.count({
        where: { eventType: 'NOTIFICATION_CREATED' },
      }),
    ).toBe(0);
  });

  it('preserves existing penalty history and does not create no-show side effects', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const registration = world.registrations[0];
    const penalty = await client.penalty.create({
      data: {
        userId: world.owner.id,
        registrationId: registration.id,
        mealDate: registration.mealDate,
        amount: 25,
        reason: 'Existing history',
        status: 'PENDING',
      },
    });
    const result = await createAdminUsersService(client).disable(
      world.owner.id,
      world.kitchen.id,
      SERVING_TIME,
    );

    expect(result.affected.registrationsCancelled).toBe(0);
    await expect(
      client.registration.findUniqueOrThrow({
        where: { id: registration.id },
        include: { penalties: true, mealServing: true },
      }),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      mealServing: null,
      penalties: [
        expect.objectContaining({ id: penalty.id, status: 'PENDING' }),
      ],
    });
    await expect(
      client.auditLog.count({
        where: { action: 'registration_account_disabled' },
      }),
    ).resolves.toBe(0);
  });
  it('cancels before pickup when account disable owns the registration lock first', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const pickupClient = trackClient(new PrismaClient());
    const disableClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);

    type TransactionClientOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const disableTransaction =
      disableClient as unknown as TransactionClientOwner;
    const originalDisableTransaction =
      disableTransaction.$transaction.bind(disableClient);
    let disableLockEntered!: () => void;
    const disableLockStarted = new Promise<void>((resolve) => {
      disableLockEntered = resolve;
    });
    let releaseDisableLock!: () => void;
    const disableLockRelease = new Promise<void>((resolve) => {
      releaseDisableLock = resolve;
    });
    disableTransaction.$transaction = (callback, options) =>
      originalDisableTransaction(async (tx) => {
        await tx.$queryRaw`
            SELECT id FROM registrations
            WHERE id = ${world.registrations[0].id}
            FOR UPDATE
          `;
        disableLockEntered();
        await disableLockRelease;
        return callback(tx);
      }, options);

    const pickupTransaction = pickupClient as unknown as TransactionClientOwner;
    const originalPickupTransaction =
      pickupTransaction.$transaction.bind(pickupClient);
    let pickupTransactionEntered!: () => void;
    const pickupTransactionStarted = new Promise<void>((resolve) => {
      pickupTransactionEntered = resolve;
    });
    pickupTransaction.$transaction = (callback, options) =>
      originalPickupTransaction(async (tx) => {
        pickupTransactionEntered();
        return callback(tx);
      }, options);

    const adminUsersService = createAdminUsersService(disableClient);
    const disablePromise = adminUsersService.disable(
      world.owner.id,
      world.kitchen.id,
      SERVING_TIME,
    );
    await disableLockStarted;
    const pickupPromise = pickup.service.confirmPickup(
      {
        pickupSessionId: world.session.id,
        idempotencyKey: 'disable-first-key',
      },
      kitchenActor,
    );
    await pickupTransactionStarted;
    releaseDisableLock();

    const [disableResult, pickupResult] = await Promise.race([
      Promise.allSettled([disablePromise, pickupPromise]),
      sleep(5_000).then(() => {
        throw new Error('disable-first account/pickup race did not complete');
      }),
    ]);
    if (disableResult.status !== 'fulfilled') throw disableResult.reason;
    expect(disableResult.value).toMatchObject({
      changed: true,
      affected: { registrationsCancelled: 1 },
    });
    if (pickupResult.status !== 'rejected') {
      throw new Error('Pickup unexpectedly won the disable-first race');
    }
    expect(pickupResult.reason).toMatchObject({
      response: { code: 'SESSION_REVOKED' },
    });

    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.registrations[0].id },
      include: { mealServing: true },
    });
    expect(finalRegistration).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ACCOUNT_DISABLED',
      cancelledByUserId: world.kitchen.id,
      cancelledAt: SERVING_TIME,
      mealServing: null,
    });
    expect(
      await client.user.findUniqueOrThrow({ where: { id: world.owner.id } }),
    ).toMatchObject({ isActive: false });
    expect(
      await client.mealServing.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.servingConfirmRequest.count({
        where: {
          callerUserId: kitchenActor.id,
          idempotencyKey: 'disable-first-key',
        },
      }),
    ).toBe(0);
    expect(
      await client.mealEvent.count({
        where: { mealServing: { registrationId: world.registrations[0].id } },
      }),
    ).toBe(0);
    expect(
      await client.penalty.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.pickupDelegation.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(0);
    expect(
      await client.pickupSession.findUniqueOrThrow({
        where: { id: world.session.id },
      }),
    ).toMatchObject({ consumedAt: null });
    expect(
      await client.auditLog.count({
        where: { action: 'SERVING_CONFIRMED' },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({
        where: {
          action: 'USER_DISABLED',
          userId: world.kitchen.id,
        },
      }),
    ).toBe(1);
  });
  it('rejects disabling an admin when no other admin has eligible OTP recovery', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const targetAdmin = await client.user.create({
      data: { email: 'target-admin@example.test', name: 'Target Admin' },
    });
    const otherAdmin = await client.user.create({
      data: { email: 'other-admin@example.test', name: 'Other Admin' },
    });
    const adminRole = await client.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });
    await client.userRole.createMany({
      data: [
        { userId: targetAdmin.id, roleId: adminRole.id },
        { userId: otherAdmin.id, roleId: adminRole.id },
      ],
    });
    await client.otpAllowlist.create({
      data: {
        normalizedEmail: targetAdmin.email,
        userId: targetAdmin.id,
        state: 'ACTIVE',
        purpose: 'SESSION_LOGIN',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await client.otpAllowlist.create({
      data: {
        normalizedEmail: otherAdmin.email,
        userId: otherAdmin.id,
        state: 'DISABLED',
        purpose: 'SESSION_LOGIN',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const service = new AdminUsersService(
      client as never,
      new NotificationsService(client as never),
    );
    await expect(
      service.disable(targetAdmin.id, world.kitchen.id, SERVING_TIME),
    ).rejects.toMatchObject({
      response: { code: 'ADMIN_LAST_ACTIVE_ADMIN' },
    });
    await expect(
      client.user.findUniqueOrThrow({ where: { id: targetAdmin.id } }),
    ).resolves.toMatchObject({ isActive: true });
  });

  it('disables an admin when exactly one other admin has eligible OTP recovery', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const targetAdmin = await client.user.create({
      data: {
        email: 'eligible-target-admin@example.test',
        name: 'Eligible Target Admin',
      },
    });
    const otherAdmin = await client.user.create({
      data: {
        email: 'eligible-other-admin@example.test',
        name: 'Eligible Other Admin',
      },
    });
    const adminRole = await client.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });
    await client.userRole.createMany({
      data: [
        { userId: targetAdmin.id, roleId: adminRole.id },
        { userId: otherAdmin.id, roleId: adminRole.id },
      ],
    });
    await client.otpAllowlist.createMany({
      data: [
        {
          normalizedEmail: targetAdmin.email,
          userId: targetAdmin.id,
          state: 'ACTIVE',
          purpose: 'SESSION_LOGIN',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          normalizedEmail: otherAdmin.email,
          userId: otherAdmin.id,
          state: 'ACTIVE',
          purpose: 'SESSION_LOGIN',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const service = createAdminUsersService(client);
    await expect(
      service.disable(targetAdmin.id, world.kitchen.id, SERVING_TIME),
    ).resolves.toMatchObject({
      changed: true,
      affected: { registrationsCancelled: 0 },
    });
    await expect(
      client.user.findUniqueOrThrow({ where: { id: targetAdmin.id } }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it('serializes reciprocal admin role updates without deadlock', async () => {
    const clientA = trackClient(new PrismaClient());
    const clientB = trackClient(new PrismaClient());
    const adminRole = await clientA.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });
    const staffRole = await clientA.role.upsert({
      where: { name: 'staff' },
      update: {},
      create: { name: 'staff' },
    });
    const kitchenRole = await clientA.role.upsert({
      where: { name: 'kitchen' },
      update: {},
      create: { name: 'kitchen' },
    });
    const firstAdmin = await clientA.user.create({
      data: {
        email: 'reciprocal-first-admin@example.test',
        name: 'Reciprocal First Admin',
      },
    });
    const secondAdmin = await clientA.user.create({
      data: {
        email: 'reciprocal-second-admin@example.test',
        name: 'Reciprocal Second Admin',
      },
    });
    await clientA.userRole.createMany({
      data: [
        { userId: firstAdmin.id, roleId: adminRole.id },
        { userId: secondAdmin.id, roleId: adminRole.id },
      ],
    });
    const firstService = createAdminUsersService(clientA);
    const secondService = createAdminUsersService(clientB);
    const [firstResult, secondResult] = await Promise.race([
      Promise.allSettled([
        firstService.updateRoles(secondAdmin.id, ['staff'], firstAdmin.id),
        secondService.updateRoles(firstAdmin.id, ['kitchen'], secondAdmin.id),
      ]),
      sleep(5_000).then(() => {
        throw new Error('reciprocal admin role updates did not complete');
      }),
    ]);
    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('fulfilled');
    if (firstResult.status === 'fulfilled') {
      expect(firstResult.value).toMatchObject({
        managedRoles: ['staff'],
        changed: true,
      });
    }
    if (secondResult.status === 'fulfilled') {
      expect(secondResult.value).toMatchObject({
        managedRoles: ['kitchen'],
        changed: true,
      });
    }
    await expect(
      clientA.userRole.findMany({
        where: {
          userId: { in: [firstAdmin.id, secondAdmin.id] },
        },
        include: { role: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: firstAdmin.id,
          role: expect.objectContaining({ name: 'admin' }),
        }),
        expect.objectContaining({
          userId: firstAdmin.id,
          role: expect.objectContaining({ name: 'kitchen' }),
        }),
        expect.objectContaining({
          userId: secondAdmin.id,
          role: expect.objectContaining({ name: 'admin' }),
        }),
        expect.objectContaining({
          userId: secondAdmin.id,
          role: expect.objectContaining({ name: 'staff' }),
        }),
      ]),
    );
    void staffRole;
    void kitchenRole;
  });

  it('keeps roster assignment role and managed UserRole mutations independent', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const staff = await client.role.upsert({
      where: { name: 'staff' },
      update: {},
      create: { name: 'staff' },
    });
    await client.role.upsert({
      where: { name: 'kitchen' },
      update: {},
      create: { name: 'kitchen' },
    });
    await client.userRole.create({
      data: { userId: world.owner.id, roleId: staff.id },
    });
    const service = createAdminUsersService(client);

    await client.employeeLocationAssignment.update({
      where: { id: world.assignment.id },
      data: { role: 'KITCHEN' },
    });
    await service.updateRoles(world.owner.id, ['kitchen'], world.kitchen.id);
    await expect(
      client.employeeLocationAssignment.findUniqueOrThrow({
        where: { id: world.assignment.id },
      }),
    ).resolves.toMatchObject({ role: 'KITCHEN' });
    await expect(
      client.userRole.findMany({
        where: { userId: world.owner.id },
        include: { role: true },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ name: 'kitchen' }),
      }),
    ]);

    await client.employeeLocationAssignment.update({
      where: { id: world.assignment.id },
      data: { role: 'STAFF' },
    });
    await service.updateRoles(world.owner.id, ['staff'], world.kitchen.id);
    await expect(
      client.employeeLocationAssignment.findUniqueOrThrow({
        where: { id: world.assignment.id },
      }),
    ).resolves.toMatchObject({ role: 'STAFF' });
    await expect(
      client.userRole.findMany({
        where: { userId: world.owner.id },
        include: { role: true },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ name: 'staff' }),
      }),
    ]);
  });

  it('matches disable session revocation count to active preview sessions only', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const target = await client.user.create({
      data: {
        email: 'session-count-target@example.test',
        name: 'Session Count Target',
      },
    });
    const expiredAt = new Date(SERVING_TIME.getTime() - 60_000);
    const activeUntil = new Date(SERVING_TIME.getTime() + 60 * 60_000);
    await client.authSession.createMany({
      data: [
        {
          userId: target.id,
          tokenHash: `runtime-active-${randomUUID()}`,
          purpose: 'SESSION_LOGIN',
          authMethod: 'EMAIL_OTP',
          createdAt: new Date(SERVING_TIME.getTime() - 60_000),
          lastUsedAt: SERVING_TIME,
          idleExpiresAt: activeUntil,
          absoluteExpiresAt: activeUntil,
          requestId: 'active-session-count',
        },
        {
          userId: target.id,
          tokenHash: `runtime-expired-${randomUUID()}`,
          purpose: 'SESSION_LOGIN',
          authMethod: 'EMAIL_OTP',
          createdAt: new Date(SERVING_TIME.getTime() - 120_000),
          lastUsedAt: expiredAt,
          idleExpiresAt: expiredAt,
          absoluteExpiresAt: expiredAt,
          requestId: 'expired-session-count',
        },
      ],
    });
    const service = createAdminUsersService(client);
    await expect(
      service.previewDisable(target.id, SERVING_TIME),
    ).resolves.toMatchObject({ activeSessionCount: 1 });
    await expect(
      service.disable(target.id, world.kitchen.id, SERVING_TIME),
    ).resolves.toMatchObject({ affected: { sessionsRevoked: 1 } });
    await expect(
      client.authSession.count({
        where: { userId: target.id, revokedReason: 'ACCOUNT_DISABLED' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects OTP session issuance after disable commits', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const target = await client.user.create({
      data: {
        email: 'otp-disabled-target@example.test',
        name: 'OTP Disabled Target',
      },
    });
    const adminUsers = createAdminUsersService(client);
    await adminUsers.disable(target.id, world.kitchen.id, SERVING_TIME);

    const sessions = new SessionService(client as never);
    await expect(
      sessions.create({
        userId: target.id,
        purpose: 'SESSION_LOGIN',
        requestId: 'otp-after-disable',
        metadata: {},
      }),
    ).rejects.toMatchObject({ response: { code: 'SESSION_INVALID' } });
    await expect(
      client.authSession.count({ where: { userId: target.id } }),
    ).resolves.toBe(0);
    await expect(
      client.auditLog.count({
        where: { action: 'SESSION_CREATED', userId: target.id },
      }),
    ).resolves.toBe(0);
  });

  it('revokes a session when issuance commits before disable', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const target = await client.user.create({
      data: { email: 'otp-race-target@example.test', name: 'OTP Race Target' },
    });
    const sessions = new SessionService(client as never);
    await sessions.create({
      userId: target.id,
      purpose: 'SESSION_LOGIN',
      requestId: 'otp-before-disable',
      metadata: {},
    });

    const result = await createAdminUsersService(client).disable(
      target.id,
      world.kitchen.id,
      SERVING_TIME,
    );
    expect(result.affected.sessionsRevoked).toBe(1);
    await expect(
      client.authSession.count({
        where: { userId: target.id, revokedReason: 'ACCOUNT_DISABLED' },
      }),
    ).resolves.toBe(1);
  });

  it('keeps account disable and OTP allowlist state independent across re-enable', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const target = await client.user.create({
      data: {
        email: 'otp-allowlist-target@example.test',
        name: 'OTP Allowlist Target',
      },
    });
    const allowlist = await client.otpAllowlist.create({
      data: {
        normalizedEmail: target.email,
        userId: target.id,
        state: 'ACTIVE',
        purpose: 'SESSION_LOGIN',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const allowlistService = new AllowlistService(client as never);
    await expect(
      allowlistService.findEligible(
        target.email,
        'SESSION_LOGIN',
        SERVING_TIME,
      ),
    ).resolves.toMatchObject({ userId: target.id });

    const adminUsers = createAdminUsersService(client);
    await adminUsers.disable(target.id, world.kitchen.id, SERVING_TIME);
    await expect(
      allowlistService.findEligible(
        target.email,
        'SESSION_LOGIN',
        SERVING_TIME,
      ),
    ).resolves.toBeNull();

    await client.otpAllowlist.update({
      where: { id: allowlist.id },
      data: { state: 'DISABLED' },
    });
    await adminUsers.enable(target.id, world.kitchen.id, SERVING_TIME);
    await expect(
      client.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({ isActive: true });
    await expect(
      allowlistService.findEligible(
        target.email,
        'SESSION_LOGIN',
        SERVING_TIME,
      ),
    ).resolves.toBeNull();
  });

  it('preserves delegation notification and outbox semantics on disable', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const delegate = await client.user.create({
      data: {
        email: 'disable-delegate@example.test',
        name: 'Disable Delegate',
      },
    });
    const registration = await client.registration.create({
      data: {
        userId: world.owner.id,
        mealDate: MEAL_DATE,
        status: 'ACTIVE',
      },
    });
    const delegations = new DelegationsService(
      new NotificationsService(client as never),
      client as never,
    );
    await delegations.createDelegation(world.owner.id, {
      registrationId: registration.id,
      delegateUserId: delegate.id,
    });
    const service = new AdminUsersService(
      client as never,
      new NotificationsService(client as never),
    );

    const result = await service.disable(
      world.owner.id,
      world.kitchen.id,
      SERVING_TIME,
    );

    expect(result.affected.delegationsRevoked).toBe(1);
    expect(
      await client.pickupDelegation.findFirstOrThrow({
        where: { registrationId: registration.id },
      }),
    ).toMatchObject({ status: 'REVOKED' });
    const notification = await client.notification.findFirstOrThrow({
      where: { userId: delegate.id, kind: 'DELEGATION_REVOKED' },
    });
    expect(notification.payload).toMatchObject({
      delegationId: expect.any(String),
      registrationId: registration.id,
      reason: 'ACCOUNT_DISABLED',
    });
    expect(
      await client.outboxEvent.count({
        where: {
          aggregateType: 'NOTIFICATION',
          aggregateId: notification.id,
          eventType: 'NOTIFICATION_CREATED',
        },
      }),
    ).toBe(1);
  });

  it('does not revoke inbound delegation attached to an ACTIVE served registration', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 1 });
    const target = await client.user.create({
      data: { email: 'served-target@example.test', name: 'Served Target' },
    });
    const registration = world.registrations[0];
    await client.pickupDelegation.create({
      data: {
        registrationId: registration.id,
        delegateUserId: target.id,
        status: 'PENDING',
      },
    });
    const pickup = createPickupService(client).service;
    await pickup.confirmPickup(
      {
        pickupSessionId: world.session.id,
        idempotencyKey: 'serve-before-disable',
      },
      kitchenActor,
    );
    const service = new AdminUsersService(
      client as never,
      new NotificationsService(client as never),
    );

    await service.disable(target.id, world.kitchen.id, SERVING_TIME);

    await expect(
      client.pickupDelegation.findFirstOrThrow({
        where: { registrationId: registration.id, delegateUserId: target.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      client.registration.findUniqueOrThrow({
        where: { id: registration.id },
        include: { mealServing: true },
      }),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      mealServing: { id: expect.any(String) },
    });
  });

  it('revokes an inbound delegation committed after initial disable discovery', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const target = await client.user.create({
      data: { email: 'race-target@example.test', name: 'Race Target' },
    });
    const registration = await client.registration.create({
      data: {
        userId: world.owner.id,
        mealDate: MEAL_DATE,
        status: 'ACTIVE',
      },
    });
    const createClient = trackClient(new PrismaClient());
    const disableClient = trackClient(new PrismaClient());
    const delegations = new DelegationsService(
      new NotificationsService(createClient as never),
      createClient as never,
    );
    const adminUsers = new AdminUsersService(
      disableClient as never,
      new NotificationsService(disableClient as never),
    );
    type TransactionClientOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const createTransaction = createClient as unknown as TransactionClientOwner;
    const originalCreateTransaction =
      createTransaction.$transaction.bind(createClient);
    let targetLockEntered!: () => void;
    const targetLockStarted = new Promise<void>((resolve) => {
      targetLockEntered = resolve;
    });
    let releaseTargetLock!: () => void;
    const targetLockRelease = new Promise<void>((resolve) => {
      releaseTargetLock = resolve;
    });
    createTransaction.$transaction = (callback, options) =>
      originalCreateTransaction(async (tx) => {
        await tx.$queryRaw`
            SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE
          `;
        await tx.$queryRaw`
            SELECT id FROM users WHERE id = ${target.id} FOR UPDATE
          `;
        targetLockEntered();
        await targetLockRelease;
        return callback(tx);
      }, options);

    const createPromise = delegations.createDelegation(world.owner.id, {
      registrationId: registration.id,
      delegateUserId: target.id,
    });
    await targetLockStarted;
    const disablePromise = adminUsers.disable(
      target.id,
      world.kitchen.id,
      SERVING_TIME,
    );
    releaseTargetLock();
    const [created] = await Promise.all([createPromise, disablePromise]);

    expect(created.status).toBe('PENDING');
    await expect(
      client.pickupDelegation.findFirstOrThrow({
        where: { registrationId: registration.id },
      }),
    ).resolves.toMatchObject({ status: 'REVOKED' });
    await expect(
      client.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({ isActive: false });
    expect(
      await client.auditLog.count({
        where: { action: 'USER_DISABLED', userId: world.kitchen.id },
      }),
    ).toBe(1);
  });
  it('serializes real RegistrationsService create calls for one registration', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 0 });
    const firstClient = trackClient(new PrismaClient());
    const secondClient = trackClient(new PrismaClient());
    const first = await createRegistrationService(firstClient);
    const second = await createRegistrationService(secondClient);

    type TransactionClientOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const clients = [firstClient, secondClient];
    let enteredCount = 0;
    let resolveTransactionBarrier!: () => void;
    const transactionBarrier = new Promise<void>((resolve) => {
      resolveTransactionBarrier = resolve;
    });
    for (const clientForRace of clients) {
      const transactionClient =
        clientForRace as unknown as TransactionClientOwner;
      const originalTransaction =
        transactionClient.$transaction.bind(clientForRace);
      transactionClient.$transaction = (callback, options) =>
        originalTransaction(async (tx) => {
          enteredCount += 1;
          if (enteredCount === clients.length) {
            resolveTransactionBarrier();
          }
          await transactionBarrier;
          return callback(tx);
        }, options);
    }

    vi.setSystemTime(new Date('2026-09-27T06:00:00.000Z'));
    const firstPromise = first.service.batchRegister(world.owner.id, [
      { mealDate: MEAL_DATE_KEY, status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
    const secondPromise = second.service.batchRegister(world.owner.id, [
      { mealDate: MEAL_DATE_KEY, status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
    await transactionBarrier;
    const [firstResult, secondResult] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);

    expect(firstResult[0]).toMatchObject({ success: true });
    expect(secondResult[0]).toMatchObject({ success: true });
    const registration = await client.registration.findUniqueOrThrow({
      where: {
        userId_mealDate: {
          userId: world.owner.id,
          mealDate: MEAL_DATE,
        },
      },
    });
    expect(registration).toMatchObject({
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      menuRevisionId: world.revision.id,
      ownerNameSnapshot: world.assignment.employeeName,
      serviceLocationId: world.location.id,
      serviceLocationAssignmentId: world.assignment.id,
    });
    expect(
      await client.registration.count({
        where: { userId: world.owner.id, mealDate: MEAL_DATE },
      }),
    ).toBe(1);
  });
  it('preserves whitespace in verified menu names through resolution and pickup eligibility', async () => {
    const client = trackClient(new PrismaClient());
    const owner = await client.user.create({
      data: {
        email: `whitespace-owner-${randomUUID()}@example.test`,
        name: 'Whitespace Owner',
      },
    });
    const location = await client.location.create({
      data: {
        shortCode: `WS-${randomUUID().slice(0, 8)}`,
        displayName: 'Whitespace Kitchen',
        servingPointName: 'Whitespace counter',
        address: '1 Whitespace Street',
        building: 'A',
        floor: '1',
        roomOrCounter: '1',
        localContact: 'whitespace@example.test',
        isActive: true,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const assignment = await client.employeeLocationAssignment.create({
      data: {
        userId: owner.id,
        normalizedEmail: owner.email,
        employeeName: owner.name!,
        employeeCode: `WS-${randomUUID().slice(0, 8)}`,
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: location.shortCode,
        locationId: location.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const mealDate = new Date('2026-10-15T00:00:00.000Z');
    const weeklyMenu = await client.weeklyMenu.create({
      data: {
        startDate: mealDate,
        endDate: mealDate,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const dailyMenu = await client.dailyMenu.create({
      data: {
        weeklyMenuId: weeklyMenu.id,
        date: mealDate,
        isEnabled: true,
        isHoliday: false,
      },
    });
    const revision = await client.dailyMenuRevision.create({
      data: {
        dailyMenuId: dailyMenu.id,
        revision: 1,
        mealName: '  Whitespace lunch  ',
        description: 'Whitespace description',
        imageUrl: null,
        content: 'Whitespace lunch',
      },
    });
    await client.mealDay.create({
      data: {
        dailyMenuId: dailyMenu.id,
        mealType: 'LUNCH',
        isServingReady: true,
      },
    });
    await client.appSetting.create({
      data: { key: 'isServingReady:2026-10-15', value: 'true' },
    });

    vi.setSystemTime(new Date('2026-10-14T06:00:00.000Z'));
    const registrationClient = trackClient(new PrismaClient());
    const registration = await createRegistrationService(registrationClient);
    const result = await registration.service.batchRegister(owner.id, [
      { mealDate: '2026-10-15', status: 'ACTIVE', mealChoice: 'REGULAR' },
    ]);
    expect(result).toEqual([{ date: '2026-10-15', success: true }]);
    const persisted = await client.registration.findUniqueOrThrow({
      where: {
        userId_mealDate: { userId: owner.id, mealDate },
      },
    });
    expect(persisted).toMatchObject({
      menuRevisionId: revision.id,
      menuNameSnapshot: revision.mealName,
    });

    const pickupClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);
    vi.setSystemTime(new Date('2026-10-15T04:00:00.000Z'));
    const options = await pickup.service.getPickupOptions(owner.id);
    expect(options.options).toContainEqual({
      type: 'OWN',
      registrationId: persisted.id,
      mealDate: '2026-10-15',
      mealChoice: 'REGULAR',
    });
  });

  it('publishes the latest committed revision across concurrent update and publish clients', async () => {
    const client = trackClient(new PrismaClient());
    const publishClient = trackClient(new PrismaClient());
    const updateClient = trackClient(new PrismaClient());
    const startDate = new Date('2026-10-05T00:00:00.000Z');
    const owner = await client.user.create({
      data: {
        email: 'weekly-race-owner@example.test',
        name: 'Weekly Race Owner',
      },
    });
    const admin = await client.user.create({
      data: {
        email: 'weekly-race-admin@example.test',
        name: 'Weekly Race Admin',
      },
    });
    const location = await client.location.create({
      data: {
        shortCode: 'WEEKLY-RACE',
        displayName: 'Weekly Race Kitchen',
        servingPointName: 'Weekly Race counter',
        address: '1 Weekly Race Street',
        building: 'A',
        floor: '1',
        roomOrCounter: '1',
        localContact: 'weekly-race@example.test',
        isActive: true,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const assignment = await client.employeeLocationAssignment.create({
      data: {
        userId: owner.id,
        normalizedEmail: owner.email,
        employeeName: owner.name!,
        employeeCode: 'WEEKLY-RACE-001',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: location.shortCode,
        locationId: location.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const weeklyMenu = await client.weeklyMenu.create({
      data: { startDate, endDate: startDate, publishedAt: null },
    });
    const dailyMenu = await client.dailyMenu.create({
      data: { weeklyMenuId: weeklyMenu.id, date: startDate, isEnabled: true },
    });
    const revisionOne = await client.dailyMenuRevision.create({
      data: {
        dailyMenuId: dailyMenu.id,
        revision: 1,
        mealName: 'Initial lunch',
        description: 'Initial description',
        imageUrl: 'https://example.test/initial.jpg',
        content: 'Initial lunch',
      },
    });
    await client.mealDay.create({
      data: { dailyMenuId: dailyMenu.id, mealType: 'LUNCH' },
    });
    const registration = await client.registration.create({
      data: {
        userId: owner.id,
        mealDate: startDate,
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        menuRevisionId: revisionOne.id,
        ownerNameSnapshot: owner.name,
        employeeCodeSnapshot: assignment.employeeCode,
        menuNameSnapshot: revisionOne.mealName,
        menuDescriptionSnapshot: revisionOne.description,
        menuImageSnapshot: revisionOne.imageUrl,
        registeredAt: new Date('2026-09-28T00:00:00.000Z'),
        serviceLocationId: location.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: location.shortCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: assignment.effectiveFrom,
        serviceLocationSnapshotAt: new Date('2026-09-28T00:00:00.000Z'),
      },
    });
    const publisher = await createWeeklyMenusService(publishClient);
    const updater = await createWeeklyMenusService(updateClient);

    type TransactionOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    let releasePublicationRead!: () => void;
    const publicationRead = new Promise<void>((resolve) => {
      releasePublicationRead = resolve;
    });
    let publicationReadSeen!: () => void;
    const publicationReadStarted = new Promise<void>((resolve) => {
      publicationReadSeen = resolve;
    });
    const publisherTransaction = publishClient as unknown as TransactionOwner;
    const originalPublisherTransaction =
      publisherTransaction.$transaction.bind(publishClient);
    publisherTransaction.$transaction = (callback, options) =>
      originalPublisherTransaction(async (tx) => {
        let firstRead = true;
        const guardedTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== 'weeklyMenu') {
              const value = Reflect.get(target, property, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            }
            const delegate = Reflect.get(target, property, receiver);
            return new Proxy(delegate, {
              get(delegateTarget, method, delegateReceiver) {
                const value = Reflect.get(
                  delegateTarget,
                  method,
                  delegateReceiver,
                );
                if (method === 'findFirst') {
                  return async (...args: unknown[]) => {
                    const result = await value.apply(delegateTarget, args);
                    if (firstRead) {
                      firstRead = false;
                      publicationReadSeen();
                      await publicationRead;
                    }
                    return result;
                  };
                }
                return typeof value === 'function'
                  ? value.bind(delegateTarget)
                  : value;
              },
            });
          },
        });
        return callback(guardedTx);
      }, options);

    let updateLockSeen!: () => void;
    const updateLockStarted = new Promise<void>((resolve) => {
      updateLockSeen = resolve;
    });
    const updaterTransaction = updateClient as unknown as TransactionOwner;
    const originalUpdaterTransaction =
      updaterTransaction.$transaction.bind(updateClient);
    updaterTransaction.$transaction = (callback, options) =>
      originalUpdaterTransaction(async (tx) => {
        const guardedTx = new Proxy(tx, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property === '$queryRaw') {
              return async (...args: unknown[]) => {
                const result = await value.apply(target, args);
                updateLockSeen();
                return result;
              };
            }
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(guardedTx);
      }, options);

    const publishPromise = publisher.service.publishWeeklyMenu(
      '2026-10-05',
      admin.id,
    );
    await publicationReadStarted;
    const updatePromise = updater.service.updateDailyMenu(
      '2026-10-05',
      {
        mealName: 'Latest lunch',
        description: 'Latest description',
        imageUrl: 'https://example.test/latest.jpg',
      },
      admin.id,
    );
    await updateLockStarted;
    releasePublicationRead();
    const [publishResult, updateResult] = await Promise.allSettled([
      publishPromise,
      updatePromise,
    ]);
    expect(publishResult.status).toBe('fulfilled');
    expect(updateResult.status).toBe('fulfilled');

    const finalMenu = await client.dailyMenu.findUniqueOrThrow({
      where: { id: dailyMenu.id },
      include: {
        revisions: {
          where: { revision: { not: null } },
          orderBy: [{ revision: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        mealDays: true,
      },
    });
    const latestRevision = finalMenu.revisions[0];
    expect(latestRevision).toMatchObject({
      revision: 2,
      mealName: 'Latest lunch',
    });
    expect(finalMenu.mealDays[0]).toMatchObject({
      menuNameSnapshot: latestRevision.mealName,
      menuDescriptionSnapshot: latestRevision.description,
      menuImageSnapshot: latestRevision.imageUrl,
    });
    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(finalRegistration).toMatchObject({
      menuRevisionId: latestRevision.id,
      menuNameSnapshot: latestRevision.mealName,
      menuDescriptionSnapshot: latestRevision.description,
      menuImageSnapshot: latestRevision.imageUrl,
    });
  });

  it('serializes real cancellation and reactivation with refreshed snapshots', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const cancellationClient = trackClient(new PrismaClient());
    const reactivationClient = trackClient(new PrismaClient());
    const cancellation = await createRegistrationService(cancellationClient);
    const reactivation = await createRegistrationService(reactivationClient);

    const registrationId = world.registrations[0].id;
    const oldRegistration = await client.registration.findUniqueOrThrow({
      where: { id: registrationId },
    });
    const oldSnapshot = {
      menuRevisionId: oldRegistration.menuRevisionId,
      ownerNameSnapshot: oldRegistration.ownerNameSnapshot,
      serviceLocationId: oldRegistration.serviceLocationId,
      serviceLocationAssignmentId: oldRegistration.serviceLocationAssignmentId,
    };
    const delegate = await client.user.create({
      data: {
        email: 'race-delegate@example.test',
        name: 'Race Delegate',
      },
    });
    const delegation = await client.pickupDelegation.create({
      data: {
        registrationId,
        delegateUserId: delegate.id,
        status: 'ACCEPTED',
      },
    });

    type TransactionClientOwner = {
      $transaction: (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
    const transactionClient =
      cancellationClient as unknown as TransactionClientOwner;
    const originalTransaction =
      transactionClient.$transaction.bind(cancellationClient);
    let transactionEntered!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      transactionEntered = resolve;
    });
    let releaseTransaction!: () => void;
    const transactionRelease = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    transactionClient.$transaction = (callback, options) =>
      originalTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE`;
        transactionEntered();
        await transactionRelease;
        return callback(tx);
      }, options);

    vi.setSystemTime(new Date('2026-09-27T06:00:00.000Z'));
    const cancelPromise = cancellation.service.batchRegister(world.owner.id, [
      { mealDate: MEAL_DATE_KEY, status: 'CANCELLED' },
    ]);
    await transactionStarted;

    const newLocation = await client.location.create({
      data: {
        shortCode: 'RACE-NEW-HQ',
        displayName: 'Race New Kitchen',
        servingPointName: 'Race New Counter',
        address: '3 Race Street',
        building: 'C',
        floor: '3',
        roomOrCounter: '3',
        localContact: 'race-new@example.test',
        isActive: true,
        effectiveFrom: MEAL_DATE,
      },
    });
    await client.employeeLocationAssignment.update({
      where: { id: world.assignment.id },
      data: { effectiveTo: MEAL_DATE },
    });
    const newAssignment = await client.employeeLocationAssignment.create({
      data: {
        userId: world.owner.id,
        normalizedEmail: world.owner.email,
        employeeName: 'Race Reactivated Owner',
        employeeCode: 'RACE-REACTIVATED-001',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: newLocation.shortCode,
        locationId: newLocation.id,
        effectiveFrom: MEAL_DATE,
      },
    });
    const newRevision = await client.dailyMenuRevision.create({
      data: {
        dailyMenuId: world.dailyMenu.id,
        revision: 2,
        mealName: 'Race Reactivated Lunch',
        description: 'Race reactivated description',
        imageUrl: 'https://example.test/race-reactivated.jpg',
        content: 'race-reactivated',
      },
    });
    const activeWhileCancellationLocked =
      await client.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
    expect(activeWhileCancellationLocked).toMatchObject({
      status: 'ACTIVE',
      menuRevisionId: oldSnapshot.menuRevisionId,
      ownerNameSnapshot: oldSnapshot.ownerNameSnapshot,
      serviceLocationId: oldSnapshot.serviceLocationId,
      serviceLocationAssignmentId: oldSnapshot.serviceLocationAssignmentId,
    });

    const reactivatePromise = reactivation.service.batchRegister(
      world.owner.id,
      [{ mealDate: MEAL_DATE_KEY, status: 'ACTIVE', mealChoice: 'REGULAR' }],
    );
    releaseTransaction();
    const [cancelResult, reactivateResult] = await Promise.all([
      cancelPromise,
      reactivatePromise,
    ]);
    expect(cancelResult[0]).toMatchObject({ success: true });
    expect(reactivateResult[0]).toMatchObject({ success: true });

    const finalRegistration = await client.registration.findUniqueOrThrow({
      where: { id: registrationId },
    });
    expect(finalRegistration).toMatchObject({
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      menuRevisionId: newRevision.id,
      menuNameSnapshot: 'Race Reactivated Lunch',
      ownerNameSnapshot: newAssignment.employeeName,
      employeeCodeSnapshot: newAssignment.employeeCode,
      serviceLocationId: newLocation.id,
      serviceLocationAssignmentId: newAssignment.id,
    });
    expect(finalRegistration.version).toBe(3);
    expect(
      await client.auditLog.count({
        where: {
          action: {
            in: ['registration_cancelled', 'registration_reactivated'],
          },
          details: { contains: registrationId },
        },
      }),
    ).toBe(2);
    expect(
      await client.auditLog.count({
        where: { action: 'registration_cancelled' },
      }),
    ).toBe(1);
    expect(
      await client.auditLog.count({
        where: { action: 'registration_reactivated' },
      }),
    ).toBe(1);
    expect(
      await client.pickupDelegation.findUniqueOrThrow({
        where: { id: delegation.id },
      }),
    ).toMatchObject({ status: 'REVOKED' });
    expect(
      await client.notification.count({
        where: {
          kind: 'DELEGATION_REVOKED',
          userId: delegate.id,
        },
      }),
    ).toBe(1);
    const revokedNotification = await client.notification.findFirstOrThrow({
      where: {
        kind: 'DELEGATION_REVOKED',
        userId: delegate.id,
      },
    });
    expect(
      await client.outboxEvent.count({
        where: { aggregateId: revokedNotification.id },
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
      where: {
        userId_mealDate: { userId: world.owner.id, mealDate: MEAL_DATE },
      },
    });
    const oldSnapshot = {
      menuRevisionId: oldRegistration.menuRevisionId,
      ownerNameSnapshot: oldRegistration.ownerNameSnapshot,
      serviceLocationId: oldRegistration.serviceLocationId,
    };

    const served = await pickup.service.confirmPickup(
      {
        pickupSessionId: world.session.id,
        idempotencyKey: 'snapshot-serving-key',
      },
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

    const reactivationRegistration =
      await client.registration.findUniqueOrThrow({
        where: {
          userId_mealDate: {
            userId: world.owner.id,
            mealDate: new Date(`${reactivationDate}T00:00:00.000Z`),
          },
        },
      });
    const delegate = await client.user.create({
      data: {
        email: 'delegate@example.test',
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
        shortCode: 'NEW-HQ-TEST',
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

    const reactivated = await registration.service.batchRegister(
      world.owner.id,
      [{ mealDate: reactivationDate, status: 'ACTIVE', mealChoice: 'REGULAR' }],
    );
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
          dedupeKey: `notification-delivery:${
            (
              await client.notification.findFirstOrThrow({
                where: { kind: 'DELEGATION_REVOKED', userId: delegate.id },
              })
            ).id
          }`,
        },
      }),
    ).toBe(1);
  });
  it('rolls back production serving, idempotency, audit, delegation and notification side effects on failure', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client);
    const delegate = await client.user.create({
      data: {
        email: 'failing-delegate@example.test',
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
    const pickupClient = trackClient(new PrismaClient());
    const pickupService = new PickupService(
      pickupClient as never,
      undefined,
      failingNotifications as never,
    );

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
        where: {
          callerUserId: kitchenActor.id,
          idempotencyKey: 'rollback-key',
        },
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

    const body = {
      pickupSessionId: world.session.id,
      idempotencyKey: 'same-key',
    };
    const [firstResult, retryResult] = await Promise.all([
      first.service.confirmPickup(body, kitchenActor),
      retry.service.confirmPickup(body, kitchenActor),
    ]);
    expect(retryResult).toEqual(firstResult);
    expect(
      await client.mealServing.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(1);
    expect(
      await client.servingConfirmRequest.count({
        where: {
          callerUserId: kitchenActor.id,
          idempotencyKey: body.idempotencyKey,
        },
      }),
    ).toBe(1);

    await expect(
      retry.service.confirmPickup(
        {
          pickupSessionId: 'different-session',
          idempotencyKey: body.idempotencyKey,
        },
        kitchenActor,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(
      await client.mealServing.count({
        where: { registrationId: world.registrations[0].id },
      }),
    ).toBe(1);
  });

  it('rolls back the real confirmation transaction and all side effects for a stale item', async () => {
    const client = trackClient(new PrismaClient());
    const world = await createServingWorld(client, { registrationCount: 2 });
    const pickupClient = trackClient(new PrismaClient());
    const pickup = createPickupService(pickupClient);
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
        where: {
          registrationId: { in: world.registrations.map(({ id }) => id) },
        },
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
        where: {
          mealServing: {
            registrationId: { in: world.registrations.map(({ id }) => id) },
          },
        },
      }),
    ).toBe(0);
  });
});
