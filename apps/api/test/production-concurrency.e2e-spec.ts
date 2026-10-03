import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CheckInService } from '../src/check-in/check-in.service.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { RegistrationsService } from '../src/registrations/registrations.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-user.js';

const MEAL_DATE_KEY = '2026-09-28';
const MEAL_DATE = new Date(`${MEAL_DATE_KEY}T00:00:00.000Z`);
const SERVING_TIME = new Date(`${MEAL_DATE_KEY}T04:00:00.000Z`);
const BEFORE_WINDOW = new Date(`${MEAL_DATE_KEY}T03:29:59.000Z`);
const AFTER_WINDOW = new Date(`${MEAL_DATE_KEY}T06:30:00.000Z`);
const NO_SHOW_TIME = new Date(`${MEAL_DATE_KEY}T06:45:00.000Z`);
const LOCATION_LATITUDE = 10;
const LOCATION_LONGITUDE = 106;
const QR_SIGNING_SECRET = 'test-production-check-in-secret-at-least-32-characters';

type TestPrismaRegistry = {
  __imealRegisterTestPrismaClient?: (client: PrismaClient) => void;
};

type FixtureUser = {
  id: string;
  email: string;
  name: string | null;
};

type FixtureLocation = {
  id: string;
  shortCode: string;
  displayName: string;
  address: string;
};

type FixtureAssignment = {
  id: string;
  employeeCode: string;
  effectiveFrom: Date;
};

type FixtureRegistration = {
  id: string;
};

type CheckInWorld = {
  location: FixtureLocation;
  kitchen: FixtureUser;
  owner: FixtureUser;
  secondOwner: FixtureUser;
  inactiveOwner: FixtureUser;
  cancelledOwner: FixtureUser;
  ownerRegistration: FixtureRegistration;
  secondRegistration: FixtureRegistration;
  kitchenActor: AuthenticatedUser;
  ownerActor: AuthenticatedUser;
  secondActor: AuthenticatedUser;
};

type ActorRole = 'staff' | 'kitchen';

function trackedClient(): PrismaClient {
  const client = new PrismaClient();
  (
    globalThis as typeof globalThis & TestPrismaRegistry
  ).__imealRegisterTestPrismaClient?.(client);
  return client;
}

function actor(
  user: { id: string; email: string; name: string | null },
  role: ActorRole,
): AuthenticatedUser {
  return {
    id: user.id,
    userId: user.id,
    email: user.email,
    name: user.name ?? undefined,
    roles: [role],
    permissions: role === 'kitchen' ? ['kitchen.serve'] : [],
    sessionId: `${role}-session-${user.id}`,
    isActive: true,
  };
}

function gps(
  at: Date,
  options: {
    ageSeconds?: number;
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
  } = {},
) {
  return {
    capturedAt: new Date(
      at.getTime() - (options.ageSeconds ?? 5) * 1_000,
    ).toISOString(),
    latitude: options.latitude ?? LOCATION_LATITUDE,
    longitude: options.longitude ?? LOCATION_LONGITUDE,
    accuracyMeters: options.accuracyMeters ?? 10,
  };
}

function createCheckInService(client: PrismaClient): CheckInService {
  return new CheckInService(
    client as never,
    new LocationsService(client as never),
  );
}

async function expectCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ response: { code } });
}

async function createLocation(
  client: PrismaClient,
  shortCode: string,
  withPolicy = true,
) {
  const location = await client.location.create({
    data: {
      id: randomUUID(),
      shortCode,
      displayName: `${shortCode} Kitchen`,
      servingPointName: `${shortCode} counter`,
      address: `1 ${shortCode} Street`,
      building: 'A',
      floor: '1',
      roomOrCounter: 'Lunch counter',
      localContact: `${shortCode.toLowerCase()}@example.test`,
      isActive: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const policy = withPolicy
    ? await client.locationPolicy.create({
        data: {
          id: randomUUID(),
          locationId: location.id,
          latitude: LOCATION_LATITUDE,
          longitude: LOCATION_LONGITUDE,
          accuracySource: 'TEST_FIXTURE',
          geofenceRadiusMeters: 100,
          maxFixAgeSeconds: 60,
          maxAccuracyMeters: 50,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          isActive: true,
        },
      })
    : null;
  return { location, policy };
}

async function createWorld(
  client: PrismaClient,
  locationCode = 'HQ-TEST',
): Promise<CheckInWorld> {
  process.env.QR_SIGNING_SECRET = QR_SIGNING_SECRET;

  const { location } = await createLocation(client, locationCode);
  const fixtureTag = locationCode.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const kitchen = await client.user.create({
    data: {
      id: randomUUID(),
      email: `kitchen-check-in-${fixtureTag}@example.test`,
      name: 'Kitchen Check-in',
    },
  });
  const owner = await client.user.create({
    data: {
      id: randomUUID(),
      email: `owner-check-in-${fixtureTag}@example.test`,
      name: 'Owner Check-in',
    },
  });
  const secondOwner = await client.user.create({
    data: {
      id: randomUUID(),
      email: `second-owner-check-in-${fixtureTag}@example.test`,
      name: 'Second Owner',
    },
  });
  const inactiveOwner = await client.user.create({
    data: {
      id: randomUUID(),
      email: `inactive-owner-check-in-${fixtureTag}@example.test`,
      name: 'Inactive Owner',
      isActive: false,
    },
  });
  const cancelledOwner = await client.user.create({
    data: {
      id: randomUUID(),
      email: `cancelled-owner-check-in-${fixtureTag}@example.test`,
      name: 'Cancelled Owner',
    },
  });

  const assignmentData = (
    user: { id: string; email: string },
    employeeCode: string,
    role: string,
  ) => ({
    id: randomUUID(),
    userId: user.id,
    normalizedEmail: user.email,
    employeeName: user.email.split('@')[0],
    employeeCode,
    isActive: true,
    role,
    serviceLocationCode: location.shortCode,
    locationId: location.id,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  });

  await client.employeeLocationAssignment.create({
    data: assignmentData(kitchen, `KITCHEN-001-${fixtureTag}`, 'KITCHEN'),
  });
  const ownerAssignment = await client.employeeLocationAssignment.create({
    data: assignmentData(owner, `STAFF-001-${fixtureTag}`, 'STAFF'),
  });
  const secondAssignment = await client.employeeLocationAssignment.create({
    data: assignmentData(secondOwner, `STAFF-002-${fixtureTag}`, 'STAFF'),
  });
  const inactiveAssignment = await client.employeeLocationAssignment.create({
    data: assignmentData(inactiveOwner, `STAFF-003-${fixtureTag}`, 'STAFF'),
  });
  const cancelledAssignment = await client.employeeLocationAssignment.create({
    data: assignmentData(cancelledOwner, `STAFF-004-${fixtureTag}`, 'STAFF'),
  });

  const weeklyMenu = await client.weeklyMenu.create({
    data: {
      id: randomUUID(),
      startDate: MEAL_DATE,
      endDate: MEAL_DATE,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const dailyMenu = await client.dailyMenu.create({
    data: {
      id: randomUUID(),
      weeklyMenuId: weeklyMenu.id,
      date: MEAL_DATE,
      isEnabled: true,
      isHoliday: false,
    },
  });
  const revision = await client.dailyMenuRevision.create({
    data: {
      id: randomUUID(),
      dailyMenuId: dailyMenu.id,
      revision: 1,
      mealName: 'Check-in lunch',
      description: 'Production check-in fixture',
      imageUrl: null,
      content: 'Check-in lunch',
    },
  });
  await client.mealDay.create({
    data: {
      id: randomUUID(),
      dailyMenuId: dailyMenu.id,
      mealType: 'LUNCH',
      isServingReady: true,
      serviceStartAt: new Date(`${MEAL_DATE_KEY}T03:30:00.000Z`),
      serviceEndAt: new Date(`${MEAL_DATE_KEY}T06:30:00.000Z`),
    },
  });

  const createRegistration = async (
    user: { id: string },
    assignment: FixtureAssignment,
    status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
  ) =>
    client.registration.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        mealDate: MEAL_DATE,
        status,
        mealChoice: 'REGULAR',
        menuRevisionId: revision.id,
        ownerNameSnapshot: user.id === owner.id ? 'Owner Check-in' : `${user.id} Check-in`,
        employeeCodeSnapshot: assignment.employeeCode,
        menuNameSnapshot: revision.mealName,
        menuDescriptionSnapshot: revision.description,
        menuImageSnapshot: revision.imageUrl,
        registeredAt: SERVING_TIME,
        cancelledAt: status === 'CANCELLED' ? SERVING_TIME : null,
        cancelReason: status === 'CANCELLED' ? 'TEST_CANCELLED' : null,
        cancelledByUserId: status === 'CANCELLED' ? user.id : null,
        serviceLocationId: location.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: location.shortCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: assignment.effectiveFrom,
        serviceLocationSnapshotAt: SERVING_TIME,
      },
    });

  const ownerRegistration = await createRegistration(owner, ownerAssignment);
  const secondRegistration = await createRegistration(
    secondOwner,
    secondAssignment,
  );
  await createRegistration(inactiveOwner, inactiveAssignment);
  await createRegistration(cancelledOwner, cancelledAssignment, 'CANCELLED');

  return {
    location,
    kitchen,
    owner,
    secondOwner,
    inactiveOwner,
    cancelledOwner,
    ownerRegistration,
    secondRegistration,
    kitchenActor: actor(kitchen, 'kitchen'),
    ownerActor: actor(owner, 'staff'),
    secondActor: actor(secondOwner, 'staff'),
  };
}

async function qrFor(
  service: CheckInService,
  world: CheckInWorld,
  at: Date = SERVING_TIME,
) {
  return service.getKitchenQr(world.kitchenActor, undefined, at);
}

async function resolveFor(
  service: CheckInService,
  world: CheckInWorld,
  user: AuthenticatedUser = world.ownerActor,
  at: Date = SERVING_TIME,
  inputGps = gps(at),
) {
  const qr = await qrFor(service, world, SERVING_TIME);
  return service.resolve(user, { qr: qr.data.qr, gps: inputGps }, at);
}

// The worker is a separate Nest application; load its source dynamically so
// the API TypeScript project remains scoped to its own rootDir.
async function createNoShowWorker(client: PrismaClient) {
  const workerPath = pathToFileURL(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../worker/src/no-show-worker.service.ts',
    ),
  ).href;
  const workerModule = (await import(workerPath)) as {
    NoShowWorkerService: new (prisma: PrismaClient) => {
      processNoShows: (
        targetDate: string,
        options: { force: boolean; currentTime: Date },
      ) => Promise<{ processedCount: number }>;
    };
  };
  return new workerModule.NoShowWorkerService(client);
}

describe('Production PostgreSQL staff self check-in paths', () => {
  it('persists one stable day/location QR without employee identity', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);

    const first = await qrFor(service, world);
    const storedAfterFirst = await client.checkInSession.findUniqueOrThrow({
      where: {
        mealDate_locationId: {
          mealDate: MEAL_DATE,
          locationId: world.location.id,
        },
      },
    });
    const second = await qrFor(service, world);
    const storedAfterSecond = await client.checkInSession.findUniqueOrThrow({
      where: {
        mealDate_locationId: {
          mealDate: MEAL_DATE,
          locationId: world.location.id,
        },
      },
    });

    expect(second).toEqual(first);
    expect(storedAfterSecond.id).toBe(storedAfterFirst.id);
    expect(storedAfterSecond.updatedAt).toEqual(storedAfterFirst.updatedAt);
    expect(first.data.qr).not.toContain(world.owner.id);
    expect(first.data.qr).not.toContain(world.kitchen.id);
    await expect(
      client.checkInSession.count({ where: { locationId: world.location.id } }),
    ).resolves.toBe(1);
  });

  it('fails closed on same-day QR signing rotation without mutating the existing session', async () => {
    const client = trackedClient();
    const world = await createWorld(client, 'HQ-QR-ROTATION');
    const service = createCheckInService(client);
    await qrFor(service, world, SERVING_TIME);
    const storedBefore = await client.checkInSession.findUniqueOrThrow({
      where: {
        mealDate_locationId: {
          mealDate: MEAL_DATE,
          locationId: world.location.id,
        },
      },
    });
    process.env.QR_SIGNING_SECRET = `${QR_SIGNING_SECRET}-rotated`;

    await expect(
      qrFor(service, world, SERVING_TIME),
    ).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    });

    const storedAfter = await client.checkInSession.findUniqueOrThrow({
      where: { id: storedBefore.id },
    });
    expect(storedAfter).toEqual(storedBefore);
    await expect(
      client.checkInSession.count({ where: { locationId: world.location.id } }),
    ).resolves.toBe(1);
  });

  it('prepares one QR before 10:30, then rejects the early staff resolve without a serving', async () => {
    const client = trackedClient();
    const world = await createWorld(client, 'HQ-PREWINDOW');
    const service = createCheckInService(client);
    const beforeWindow = new Date(`${MEAL_DATE_KEY}T03:00:00.000Z`);

    const prepared = await qrFor(service, world, beforeWindow);
    expect(prepared.data).toMatchObject({
      date: MEAL_DATE_KEY,
      activeFrom: `${MEAL_DATE_KEY}T03:30:00.000Z`,
      expiresAt: `${MEAL_DATE_KEY}T06:30:00.000Z`,
    });
    const activeQr = await qrFor(service, world, SERVING_TIME);
    expect(activeQr.data.qr).toBe(prepared.data.qr);

    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: prepared.data.qr, gps: gps(beforeWindow) },
        beforeWindow,
      ),
      'OUTSIDE_CHECKIN_WINDOW',
    );
    await expect(
      client.mealServing.count({ where: { registrationId: world.ownerRegistration.id } }),
    ).resolves.toBe(0);
    await expect(
      client.servingVerification.count({ where: { presenterUserId: world.owner.id } }),
    ).resolves.toBe(0);
    await expect(
      client.checkInSession.count({
        where: { mealDate: MEAL_DATE, locationId: world.location.id },
      }),
    ).resolves.toBe(1);
  });

  it('rejects the Kitchen QR at the global close boundary without changing the stored session', async () => {
    const client = trackedClient();
    const world = await createWorld(client, 'HQ-QR-CLOSE');
    const service = createCheckInService(client);
    const prepared = await qrFor(service, world, SERVING_TIME);
    const storedBefore = await client.checkInSession.findUniqueOrThrow({
      where: {
        mealDate_locationId: {
          mealDate: MEAL_DATE,
          locationId: world.location.id,
        },
      },
    });

    await expectCode(qrFor(service, world, AFTER_WINDOW), 'OUTSIDE_CHECKIN_WINDOW');

    const storedAfter = await client.checkInSession.findUniqueOrThrow({
      where: { id: storedBefore.id },
    });
    expect(storedAfter).toMatchObject({
      id: storedBefore.id,
      qrHash: storedBefore.qrHash,
      expiresAt: storedBefore.expiresAt,
    });
    await expect(
      client.checkInSession.count({ where: { locationId: world.location.id } }),
    ).resolves.toBe(1);
  });

  it('resolves only the authenticated owner and persists verification without consuming registration', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);

    const response = await resolveFor(service, world);
    const registration = await client.registration.findUniqueOrThrow({
      where: { id: world.ownerRegistration.id },
      include: { mealServing: true },
    });
    const verifications = await client.servingVerification.findMany({
      where: { presenterUserId: world.owner.id },
    });

    expect(response.data.employee.id).toBe(world.owner.id);
    expect(response.data.registration.id).toBe(world.ownerRegistration.id);
    expect(response.data.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(response.data.intentNonce).toEqual(expect.any(String));
    expect(registration.mealServing).toBeNull();
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({
      result: 'VALID',
      safeVerificationCode: 'GPS_VALID',
      intentNonce: response.data.intentNonce,
      locationId: world.location.id,
      accuracyMeters: 10,
    });
  });

  it('rejects invalid and tampered shared QR values before any verification write', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const qr = await qrFor(service, world);
    const tamperedQr = `${qr.data.qr.slice(0, -1)}${
      qr.data.qr.endsWith('a') ? 'b' : 'a'
    }`;

    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: 'imeal-checkin-v1.unknown', gps: gps(SERVING_TIME) },
        SERVING_TIME,
      ),
      'INVALID_QR',
    );
    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: tamperedQr, gps: gps(SERVING_TIME) },
        SERVING_TIME,
      ),
      'INVALID_QR',
    );
    await expect(
      client.servingVerification.count({ where: { presenterUserId: world.owner.id } }),
    ).resolves.toBe(0);
  });

  it('returns nullable intent eligibility for cancelled and already checked-in registrations', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);

    const cancelled = await service.resolve(
      {
        ...world.ownerActor,
        id: world.cancelledOwner.id,
        userId: world.cancelledOwner.id,
        email: world.cancelledOwner.email,
      },
      {
        qr: (await qrFor(service, world)).data.qr,
        gps: gps(SERVING_TIME),
      },
      SERVING_TIME,
    );
    expect(cancelled.data.intentNonce).toBeNull();
    expect(cancelled.data.eligibility).toEqual({
      eligible: false,
      reasons: ['REGISTRATION_CANCELLED'],
    });

    const resolved = await resolveFor(service, world);
    const body = {
      sessionId: resolved.data.sessionId,
      intentNonce: resolved.data.intentNonce!,
      idempotencyKey: `already-checked-in-${randomUUID()}`,
      gps: gps(SERVING_TIME, { ageSeconds: 2 }),
    };
    await service.confirm(world.ownerActor, body, SERVING_TIME);
    const alreadyCheckedIn = await resolveFor(service, world);
    expect(alreadyCheckedIn.data.intentNonce).toBeNull();
    expect(alreadyCheckedIn.data.eligibility).toEqual({
      eligible: false,
      reasons: ['ALREADY_CHECKED_IN'],
    });
  });

  it('rejects a missing registration and never chooses a target employee from client input', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const noRegistrationUser = await client.user.create({
      data: {
        id: randomUUID(),
        email: 'no-registration@example.test',
        name: 'No Registration',
      },
    });
    await client.employeeLocationAssignment.create({
      data: {
        id: randomUUID(),
        userId: noRegistrationUser.id,
        normalizedEmail: noRegistrationUser.email,
        employeeName: 'No Registration',
        employeeCode: 'STAFF-NONE',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: world.location.shortCode,
        locationId: world.location.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await expectCode(
      resolveFor(
        service,
        world,
        actor(noRegistrationUser, 'staff'),
      ),
      'NO_REGISTRATION',
    );
    const qr = await qrFor(service, world);
    await expectCode(
      service.resolve(
        world.ownerActor,
        {
          qr: qr.data.qr,
          gps: gps(SERVING_TIME),
          targetUserId: world.secondOwner.id,
        } as never,
        SERVING_TIME,
      ),
      'INVALID_QR',
    );
    await expect(
      client.mealServing.count({ where: { registrationId: world.secondRegistration.id } }),
    ).resolves.toBe(0);
  });

  it('rejects missing, stale, inaccurate and outside-geofence GPS fixes', async () => {
    const cases = [
      {
        name: 'missing',
        input: undefined,
        code: 'GPS_REQUIRED',
      },
      {
        name: 'stale',
        input: gps(SERVING_TIME, { ageSeconds: 61 }),
        code: 'GPS_STALE',
      },
      {
        name: 'inaccurate',
        input: gps(SERVING_TIME, { accuracyMeters: 51 }),
        code: 'GPS_INACCURATE',
      },
      {
        name: 'outside geofence',
        input: gps(SERVING_TIME, { latitude: 10.01 }),
        code: 'OUTSIDE_GEOFENCE',
      },
    ] as const;
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);

    for (const testCase of cases) {
      await expectCode(
        service.resolve(
          world.ownerActor,
          {
            qr: (await qrFor(service, world)).data.qr,
            gps: testCase.input,
          } as never,
          SERVING_TIME,
        ),
        testCase.code,
      );
    }
  });

  it('rejects a roster/location mismatch even when QR and GPS are valid', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const otherLocation = await createLocation(client, 'OTHER-TEST', false);
    await client.registration.update({
      where: { id: world.ownerRegistration.id },
      data: {
        serviceLocationId: otherLocation.location.id,
        serviceLocationCode: otherLocation.location.shortCode,
        serviceLocationName: otherLocation.location.displayName,
        serviceLocationAddress: otherLocation.location.address,
      },
    });
    const service = createCheckInService(client);

    await expectCode(resolveFor(service, world), 'LOCATION_MISMATCH');
    await expect(
      client.servingVerification.count({ where: { presenterUserId: world.owner.id } }),
    ).resolves.toBe(0);
  });

  it('rejects tampered intent and another authenticated owner cannot use it', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    const tamperedIntent = `${resolved.data.intentNonce!.slice(0, -1)}${
      resolved.data.intentNonce!.endsWith('a') ? 'b' : 'a'
    }`;
    const baseBody = {
      sessionId: resolved.data.sessionId,
      idempotencyKey: `tampered-intent-${randomUUID()}`,
      gps: gps(SERVING_TIME, { ageSeconds: 2 }),
    };

    await expectCode(
      service.confirm(
        world.ownerActor,
        { ...baseBody, intentNonce: tamperedIntent },
        SERVING_TIME,
      ),
      'INACTIVE_CHECKIN_SESSION',
    );
    await expectCode(
      service.confirm(
        world.secondActor,
        {
          ...baseBody,
          intentNonce: resolved.data.intentNonce!,
          idempotencyKey: `wrong-owner-${randomUUID()}`,
        },
        SERVING_TIME,
      ),
      'INACTIVE_CHECKIN_SESSION',
    );
    await expect(
      client.mealServing.count({
        where: { registrationId: { in: [world.ownerRegistration.id, world.secondRegistration.id] } },
      }),
    ).resolves.toBe(0);
  });

  it('reevaluates Vietnam serving window, session date and session expiry', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const qr = await qrFor(service, world);

    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: qr.data.qr, gps: gps(BEFORE_WINDOW) },
        BEFORE_WINDOW,
      ),
      'OUTSIDE_CHECKIN_WINDOW',
    );
    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: qr.data.qr, gps: gps(AFTER_WINDOW) },
        AFTER_WINDOW,
      ),
      'OUTSIDE_CHECKIN_WINDOW',
    );
    await expectCode(
      service.resolve(
        world.ownerActor,
        { qr: qr.data.qr, gps: gps(new Date('2026-09-29T04:00:00.000Z')) },
        new Date('2026-09-29T04:00:00.000Z'),
      ),
      'INACTIVE_CHECKIN_SESSION',
    );
  });

  it('rejects new confirmations before and at/after close without creating a serving', async () => {
    const client = trackedClient();
    const world = await createWorld(client, 'HQ-CONFIRM-WINDOW');
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);

    await expectCode(
      service.confirm(
        world.ownerActor,
        {
          sessionId: resolved.data.sessionId,
          intentNonce: resolved.data.intentNonce!,
          idempotencyKey: `before-confirm-${randomUUID()}`,
          gps: gps(BEFORE_WINDOW, { ageSeconds: 2 }),
        },
        BEFORE_WINDOW,
      ),
      'OUTSIDE_CHECKIN_WINDOW',
    );
    await expectCode(
      service.confirm(
        world.ownerActor,
        {
          sessionId: resolved.data.sessionId,
          intentNonce: resolved.data.intentNonce!,
          idempotencyKey: `after-confirm-${randomUUID()}`,
          gps: gps(AFTER_WINDOW, { ageSeconds: 2 }),
        },
        AFTER_WINDOW,
      ),
      'OUTSIDE_CHECKIN_WINDOW',
    );
    await expect(
      client.mealServing.count({ where: { registrationId: world.ownerRegistration.id } }),
    ).resolves.toBe(0);
  });

  it('confirms one MealServing and exposes consumed history and stats', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    const response = await service.confirm(
      world.ownerActor,
      {
        sessionId: resolved.data.sessionId,
        intentNonce: resolved.data.intentNonce!,
        idempotencyKey: `confirm-${randomUUID()}`,
        gps: gps(SERVING_TIME, { ageSeconds: 2, accuracyMeters: 11 }),
      },
      SERVING_TIME,
    );

    const registration = await client.registration.findUniqueOrThrow({
      where: { id: world.ownerRegistration.id },
      include: { mealServing: true },
    });
    const serving = await client.mealServing.findUniqueOrThrow({
      where: { registrationId: world.ownerRegistration.id },
    });
    const eventCount = await client.mealEvent.count({
      where: { mealServingId: serving.id, eventType: 'CHECK_IN_CONFIRMED' },
    });
    const status = await service.getStatus(world.ownerActor, SERVING_TIME);
    const registrationService = new RegistrationsService(client as never);
    const history = await registrationService.getHistory(world.owner.id, {
      page: 1,
      limit: 50,
    } as never);
    const stats = await registrationService.getStats(world.owner.id, {
      month: '2026-09',
    } as never);

    expect(response.data.status).toBe('CHECKED_IN');
    expect(response.data.registrationId).toBe(world.ownerRegistration.id);
    expect(registration.status).toBe('ACTIVE');
    expect(registration.mealServing?.id).toBe(serving.id);
    expect(serving).toMatchObject({
      ownerUserId: world.owner.id,
      presenterUserId: world.owner.id,
      receiverType: 'SELF',
      kitchenUserId: null,
      checkInSessionId: resolved.data.sessionId,
      verificationOutcome: 'GPS_VALID',
      locationId: world.location.id,
    });
    expect(eventCount).toBe(1);
    expect(status.data.state).toBe('CHECKED_IN');
    expect(history.data[0]).toMatchObject({
      id: world.ownerRegistration.id,
      status: 'SERVED',
      servedAt: SERVING_TIME.toISOString(),
    });
    expect(stats.data).toMatchObject({ booked: 1, enjoyed: 1 });
  });

  it('replays a committed result after session expiry and a stale retry GPS', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    const body = {
      sessionId: resolved.data.sessionId,
      intentNonce: resolved.data.intentNonce!,
      idempotencyKey: `lost-response-${randomUUID()}`,
      gps: gps(SERVING_TIME, { ageSeconds: 2 }),
    };
    const first = await service.confirm(world.ownerActor, body, SERVING_TIME);
    const replay = await service.confirm(world.ownerActor, body, AFTER_WINDOW);

    expect(replay).toEqual(first);
    await expect(
      client.mealServing.count({ where: { registrationId: world.ownerRegistration.id } }),
    ).resolves.toBe(1);
    await expect(
      client.mealEvent.count({
        where: { mealServing: { registrationId: world.ownerRegistration.id } },
      }),
    ).resolves.toBe(1);
    await expect(
      client.servingConfirmRequest.count({
        where: {
          callerUserId: world.owner.id,
          idempotencyKey: body.idempotencyKey,
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects a changed body under a committed idempotency key', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    const idempotencyKey = `changed-body-${randomUUID()}`;
    const body = {
      sessionId: resolved.data.sessionId,
      intentNonce: resolved.data.intentNonce!,
      idempotencyKey,
      gps: gps(SERVING_TIME, { ageSeconds: 2 }),
    };
    await service.confirm(world.ownerActor, body, SERVING_TIME);

    await expectCode(
      service.confirm(
        world.ownerActor,
        { ...body, gps: gps(SERVING_TIME, { ageSeconds: 3, accuracyMeters: 11 }) },
        SERVING_TIME,
      ),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('allows concurrent duplicate confirmations to create one canonical serving', async () => {
    const client = trackedClient();
    const firstClient = trackedClient();
    const secondClient = trackedClient();
    const world = await createWorld(client);
    const resolved = await resolveFor(createCheckInService(client), world);
    const body = {
      sessionId: resolved.data.sessionId,
      intentNonce: resolved.data.intentNonce!,
      idempotencyKey: `concurrent-${randomUUID()}`,
      gps: gps(SERVING_TIME, { ageSeconds: 2 }),
    };
    const [first, second] = await Promise.allSettled([
      createCheckInService(firstClient).confirm(world.ownerActor, body, SERVING_TIME),
      createCheckInService(secondClient).confirm(world.ownerActor, body, SERVING_TIME),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');
    if (first.status === 'fulfilled' && second.status === 'fulfilled') {
      expect(second.value).toEqual(first.value);
    }
    await expect(
      client.mealServing.count({ where: { registrationId: world.ownerRegistration.id } }),
    ).resolves.toBe(1);
    await expect(
      client.mealEvent.count({
        where: { mealServing: { registrationId: world.ownerRegistration.id } },
      }),
    ).resolves.toBe(1);
  });

  it('rejects an account disabled after resolve before confirm', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    await client.user.update({
      where: { id: world.owner.id },
      data: { isActive: false },
    });

    await expectCode(
      service.confirm(
        world.ownerActor,
        {
          sessionId: resolved.data.sessionId,
          intentNonce: resolved.data.intentNonce!,
          idempotencyKey: `disabled-${randomUUID()}`,
          gps: gps(SERVING_TIME, { ageSeconds: 2 }),
        },
        SERVING_TIME,
      ),
      'INACTIVE_CHECKIN_SESSION',
    );
    await expect(
      client.mealServing.count({ where: { registrationId: world.ownerRegistration.id } }),
    ).resolves.toBe(0);
    await expect(
      client.servingConfirmRequest.count({ where: { callerUserId: world.owner.id } }),
    ).resolves.toBe(0);
  });

  it('normalizes an unknown session before any FK-bearing idempotency insert', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const unknownSessionId = randomUUID();

    await expectCode(
      service.confirm(
        world.ownerActor,
        {
          sessionId: unknownSessionId,
          intentNonce: 'imeal-checkin-intent-v1.invalid.invalid',
          idempotencyKey: `unknown-session-${randomUUID()}`,
          gps: gps(SERVING_TIME, { ageSeconds: 2 }),
        },
        SERVING_TIME,
      ),
      'INACTIVE_CHECKIN_SESSION',
    );
    await expect(
      client.servingConfirmRequest.count({ where: { callerUserId: world.owner.id } }),
    ).resolves.toBe(0);
  });

  it('marks only unchecked active registrations no-show at 13:45 and reports aggregate counts', async () => {
    const client = trackedClient();
    const world = await createWorld(client);
    const service = createCheckInService(client);
    const resolved = await resolveFor(service, world);
    await service.confirm(
      world.ownerActor,
      {
        sessionId: resolved.data.sessionId,
        intentNonce: resolved.data.intentNonce!,
        idempotencyKey: `no-show-race-${randomUUID()}`,
        gps: gps(SERVING_TIME, { ageSeconds: 2 }),
      },
      SERVING_TIME,
    );
    const worker = await createNoShowWorker(client);
    const workerResult = await worker.processNoShows(MEAL_DATE_KEY, {
      force: true,
      currentTime: NO_SHOW_TIME,
    });

    const ownerRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.ownerRegistration.id },
      include: { mealServing: true, penalties: true },
    });
    const secondRegistration = await client.registration.findUniqueOrThrow({
      where: { id: world.secondRegistration.id },
      include: { mealServing: true, penalties: true },
    });
    const dashboard = await service.getKitchenDashboard(
      world.kitchenActor,
      MEAL_DATE_KEY,
      undefined,
      NO_SHOW_TIME,
    );

    expect(workerResult.processedCount).toBe(1);
    expect(ownerRegistration).toMatchObject({
      status: 'ACTIVE',
      mealServing: { id: expect.any(String) },
      penalties: [],
    });
    expect(secondRegistration).toMatchObject({
      status: 'NO_SHOW',
      mealServing: null,
      penalties: [expect.objectContaining({ reason: 'NO_SHOW' })],
    });
    expect(dashboard.data.counts).toEqual({
      registered: 2,
      checkedIn: 1,
      pending: 0,
      noShow: 1,
      regular: 2,
      vegetarian: 0,
    });
  });
});
