import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CheckInService } from './check-in.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { createHash, createHmac } from 'node:crypto';

const NOW = new Date('2026-09-30T04:00:00.000Z');
const LOCATION = {
  id: 'location-1',
  shortCode: 'LOC-A',
  displayName: 'Main Hall',
  servingPointName: 'Lunch counter',
  address: '1 Main Street',
  locationPolicy: {
    id: 'policy-1',
    locationId: 'location-1',
    latitude: 10.77,
    longitude: 106.69,
    geofenceRadiusMeters: 100,
    maxFixAgeSeconds: 30,
    maxAccuracyMeters: 50,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isActive: true,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
};
const ASSIGNMENT = {
  id: 'assignment-1',
  userId: 'staff-1',
  employeeName: 'Nguyen Staff',
  employeeCode: 'EMP-1',
  locationId: 'location-1',
  serviceLocationCode: 'LOC-A',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  isActive: true,
  location: {
    id: 'location-1',
    shortCode: 'LOC-A',
    displayName: 'Main Hall',
    servingPointName: 'Lunch counter',
    address: '1 Main Street',
  },
};
const REGISTRATION = {
  id: 'registration-1',
  userId: 'staff-1',
  mealDate: new Date('2026-09-30T00:00:00.000Z'),
  status: 'ACTIVE',
  mealChoice: 'REGULAR' as const,
  ownerNameSnapshot: 'Nguyen Staff',
  employeeCodeSnapshot: 'EMP-1',
  menuRevisionId: 'revision-1',
  menuNameSnapshot: 'Chicken rice',
  menuDescriptionSnapshot: 'Lunch',
  menuImageSnapshot: null,
  serviceLocationId: 'location-1',
  serviceLocationCode: 'LOC-A',
  serviceLocationName: 'Main Hall',
  serviceLocationAddress: '1 Main Street',
  mealServing: null,
  user: {
    id: 'staff-1',
    email: 'staff@example.test',
    name: 'Nguyen Staff',
    isActive: true,
  },
  menuRevision: {
    id: 'revision-1',
    mealName: 'Chicken rice',
    description: 'Lunch',
    imageUrl: null,
  },
};
const SESSION = {
  id: 'check-in-session-1',
  mealDate: new Date('2026-09-30T00:00:00.000Z'),
  locationId: 'location-1',
  qrHash: createHash('sha256')
    .update(stableQr('2026-09-30', 'location-1'), 'utf8')
    .digest('hex'),
  activeFrom: new Date('2026-09-30T03:30:00.000Z'),
  expiresAt: new Date('2026-09-30T06:30:00.000Z'),
  location: LOCATION,
};
const STAFF: AuthenticatedUser = {
  id: 'staff-1',
  userId: 'staff-1',
  email: 'staff@example.test',
  name: 'Nguyen Staff',
  roles: ['staff'],
  permissions: [],
  isActive: true,
};
const KITCHEN: AuthenticatedUser = {
  id: 'kitchen-1',
  userId: 'kitchen-1',
  email: 'kitchen@example.test',
  name: 'Kitchen',
  roles: ['kitchen'],
  permissions: ['kitchen.serve'],
  isActive: true,
};
const GPS = {
  capturedAt: '2026-09-30T03:59:45.000Z',
  latitude: 10.77,
  longitude: 106.69,
  accuracyMeters: 12,
};

function stableQr(dateKey: string, locationId: string): string {
  const digest = createHmac(
    'sha256',
    'test-check-in-secret-at-least-32-characters',
  )
    .update(`check-in:v1:${dateKey}:${locationId}`, 'utf8')
    .digest('base64url');
  return `imeal-checkin-v1.${digest}`;
}

const RESOLVE_INTENT = (() => {
  const payload = {
    version: 1,
    callerUserId: 'staff-1',
    registrationId: 'registration-1',
    sessionId: 'check-in-session-1',
    locationId: 'location-1',
    expiresAt: '2026-09-30T06:30:00.000Z',
    nonce: 'intent-nonce',
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac(
    'sha256',
    'test-check-in-secret-at-least-32-characters',
  )
    .update(encoded, 'utf8')
    .digest('base64url');
  return `imeal-checkin-intent-v1.${encoded}.${signature}`;
})();

type TransactionMock = {
  $queryRaw: Mock;
  checkInSession: { findUnique: Mock };
  employeeLocationAssignment: { findMany: Mock };
  registration: { findUnique: Mock };
  servingConfirmRequest: { update: Mock };
  servingVerification: { create: Mock; findFirst: Mock };
  mealServing: { create: Mock };
  mealEvent: { create: Mock };
  auditLog: { create: Mock };
};

type PrismaMock = {
  employeeLocationAssignment: { findMany: Mock };
  user: { findUnique: Mock };
  registration: { findUnique: Mock; findMany: Mock };
  checkInSession: { findUnique: Mock; create: Mock };
  servingVerification: { create: Mock };
  $transaction: Mock;
  tx: TransactionMock;
};

function createPrisma(): PrismaMock {
  const tx = {
    $queryRaw: vi.fn(),
    checkInSession: { findUnique: vi.fn() },
    employeeLocationAssignment: { findMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    servingConfirmRequest: { update: vi.fn() },
    servingVerification: { create: vi.fn(), findFirst: vi.fn() },
    mealServing: { create: vi.fn() },
    mealEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    employeeLocationAssignment: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn(), findMany: vi.fn() },
    checkInSession: { findUnique: vi.fn(), create: vi.fn() },
    servingVerification: { create: vi.fn() },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    tx,
  };
  return prisma;
}

function configureBase(prisma: PrismaMock) {
  prisma.employeeLocationAssignment.findMany.mockResolvedValue([ASSIGNMENT]);
  prisma.user.findUnique.mockResolvedValue(STAFF);
  prisma.registration.findUnique.mockResolvedValue(REGISTRATION);
  prisma.tx.checkInSession.findUnique.mockResolvedValue(SESSION);
  prisma.tx.employeeLocationAssignment.findMany.mockResolvedValue([ASSIGNMENT]);
  prisma.tx.registration.findUnique.mockResolvedValue(REGISTRATION);
  prisma.servingVerification.create.mockResolvedValue({ id: 'resolved-verification-1' });
  prisma.tx.servingVerification.findFirst.mockResolvedValue({
    id: 'resolved-verification-1',
  });
  prisma.tx.servingVerification.create.mockResolvedValue({ id: 'verification-1' });
  prisma.tx.mealServing.create.mockResolvedValue({
    id: 'serving-1',
    registrationId: 'registration-1',
  });
  prisma.tx.mealEvent.create.mockResolvedValue({ id: 'event-1' });
  prisma.tx.servingConfirmRequest.update.mockResolvedValue({});
  prisma.tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

type CheckInLocationsMock = {
  resolveEffectiveLocation: Mock;
  evaluatePresenterEvidence: Mock;
};

describe('CheckInService', () => {
  let prisma: PrismaMock;
  let locations: CheckInLocationsMock;
  let service: CheckInService;

  beforeEach(() => {
    vi.stubEnv('QR_SIGNING_SECRET', 'test-check-in-secret-at-least-32-characters');
    prisma = createPrisma();
    configureBase(prisma);
    locations = {
      resolveEffectiveLocation: vi.fn().mockResolvedValue(LOCATION),
      evaluatePresenterEvidence: vi.fn().mockResolvedValue({
        result: 'VALID',
        locationId: 'location-1',
        locationPolicyId: 'policy-1',
        capturedAt: GPS.capturedAt,
        verifiedAt: NOW.toISOString(),
        accuracyMeters: GPS.accuracyMeters,
        safeVerificationCode: 'GPS_VALID',
      }),
    };
    service = new CheckInService(prisma as never, locations as never);
  });

  it('reuses one stable date/location QR without employee data', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique.mockResolvedValue(SESSION);

    const first = await service.getKitchenQr(
      KITCHEN,
      undefined,
      new Date('2026-09-30T03:00:00.000Z'),
    );
    const second = await service.getKitchenQr(KITCHEN, undefined, NOW);

    expect(first).toEqual(second);
    expect(first.data.qr).not.toContain('kitchen-1');
    expect(first.data.qr).not.toContain('staff-1');
  });

  it('creates the canonical shared QR before 10:30 with Vietnam window timestamps', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique.mockResolvedValue(null);
    prisma.checkInSession.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...SESSION,
        ...data,
      }),
    );

    const response = await service.getKitchenQr(
      KITCHEN,
      undefined,
      new Date('2026-09-30T03:00:00.000Z'),
    );

    expect(response.data).toMatchObject({
      qr: stableQr('2026-09-30', 'location-1'),
      date: '2026-09-30',
      activeFrom: '2026-09-30T03:30:00.000Z',
      expiresAt: '2026-09-30T06:30:00.000Z',
    });
    expect(prisma.checkInSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qrHash: createHash('sha256')
            .update(stableQr('2026-09-30', 'location-1'), 'utf8')
            .digest('hex'),
          activeFrom: new Date('2026-09-30T03:30:00.000Z'),
          expiresAt: new Date('2026-09-30T06:30:00.000Z'),
        }),
      }),
    );
  });

  it('rejects an already-expired stored session without returning its QR', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique.mockResolvedValue({
      ...SESSION,
      expiresAt: new Date('2026-09-30T04:30:00.000Z'),
    });

    await expect(
      service.getKitchenQr(KITCHEN, undefined, new Date('2026-09-30T05:00:00.000Z')),
    ).rejects.toMatchObject({
      response: { code: 'INACTIVE_CHECKIN_SESSION' },
    });
  });

  it('rejects Kitchen QR requests at and after the exact global close boundary', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique.mockResolvedValue(SESSION);

    for (const checkInAt of [
      new Date('2026-09-30T06:30:00.000Z'),
      new Date('2026-09-30T06:30:01.000Z'),
    ]) {
      await expect(
        service.getKitchenQr(KITCHEN, undefined, checkInAt),
      ).rejects.toMatchObject({
        response: { code: 'OUTSIDE_CHECKIN_WINDOW' },
      });
    }
    expect(prisma.checkInSession.create).not.toHaveBeenCalled();
  });

  it('fails closed when a stored QR hash does not match the deterministic QR', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique.mockResolvedValue({
      ...SESSION,
      qrHash: 'unexpected-hash',
    });

    await expect(
      service.getKitchenQr(KITCHEN, undefined, NOW),
    ).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    });
    expect(prisma.checkInSession.create).not.toHaveBeenCalled();
  });

  it('fails closed when a concurrent create winner has a mismatched QR hash', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.checkInSession.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...SESSION, qrHash: 'unexpected-hash' });
    prisma.checkInSession.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.getKitchenQr(KITCHEN, undefined, NOW),
    ).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    });
    expect(prisma.checkInSession.create).toHaveBeenCalledTimes(1);
  });

  it('resolves only the authenticated owner and does not consume the shared session', async () => {
    prisma.checkInSession.findUnique.mockResolvedValue(SESSION);
    const qr = 'imeal-checkin-v1.shared-token';

    const response = await service.resolve(
      STAFF,
      { qr, gps: GPS },
      NOW,
    );

    expect(response.data.sessionId).toBe('check-in-session-1');
    expect(response.data.registration.id).toBe('registration-1');
    expect(response.data.employee.id).toBe('staff-1');
    expect(response.data.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(prisma.tx.mealServing.create).not.toHaveBeenCalled();
    expect(locations.evaluatePresenterEvidence).toHaveBeenCalledWith(
      'location-1',
      GPS,
      NOW,
    );
  });

  it('rejects an early staff resolve before 10:30 without writing a serving', async () => {
    prisma.checkInSession.findUnique.mockResolvedValue(SESSION);

    await expect(
      service.resolve(
        STAFF,
        { qr: 'imeal-checkin-v1.shared-token', gps: GPS },
        new Date('2026-09-30T03:29:59.000Z'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'OUTSIDE_CHECKIN_WINDOW' },
    });
    expect(prisma.servingVerification.create).not.toHaveBeenCalled();
    expect(prisma.tx.mealServing.create).not.toHaveBeenCalled();
  });
  it('rejects new confirms before opening and at or after close without creating a serving', async () => {
    const boundaryTimes = [
      new Date('2026-09-30T03:29:59.000Z'),
      new Date('2026-09-30T06:30:00.000Z'),
      new Date('2026-09-30T06:30:01.000Z'),
    ];

    for (const [index, checkInAt] of boundaryTimes.entries()) {
      prisma.tx.$queryRaw.mockReset();
      prisma.tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: `confirm-request-boundary-${index}`,
            callerUserId: 'staff-1',
            idempotencyKey: `boundary-${index}`,
            status: 'PROCESSING',
            requestBodyHash: 'hash',
            checkInSessionId: 'check-in-session-1',
            resultSnapshot: null,
          },
        ]);

      await expect(
        service.confirm(
          STAFF,
          {
            sessionId: 'check-in-session-1',
            intentNonce: RESOLVE_INTENT,
            idempotencyKey: `boundary-${index}`,
            gps: GPS,
          },
          checkInAt,
        ),
      ).rejects.toMatchObject({
        response: { code: 'OUTSIDE_CHECKIN_WINDOW' },
      });
    }

    expect(prisma.tx.mealServing.create).not.toHaveBeenCalled();
  });

  it('does not treat a shared session id alone as confirmation authority', async () => {
    prisma.tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'confirm-request-1',
          callerUserId: 'staff-1',
          idempotencyKey: 'idem-no-intent',
          status: 'PROCESSING',
          requestBodyHash: 'hash',
          checkInSessionId: 'check-in-session-1',
          resultSnapshot: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'registration-1' }]);

    await expect(
      service.confirm(
        STAFF,
        {
          sessionId: 'check-in-session-1',
          intentNonce: 'tampered-resolve-intent',
          idempotencyKey: 'idem-no-intent',
          gps: GPS,
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INACTIVE_CHECKIN_SESSION' },
    });
    expect(prisma.tx.mealServing.create).not.toHaveBeenCalled();
  });


  it('creates one authoritative serving for a valid resolved intent', async () => {
    prisma.tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'confirm-request-1',
          callerUserId: 'staff-1',
          idempotencyKey: 'idem-1',
          status: 'PROCESSING',
          requestBodyHash: 'hash',
          checkInSessionId: 'check-in-session-1',
          resultSnapshot: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'registration-1' }]);

    const response = await service.confirm(
      STAFF,
      {
        sessionId: 'check-in-session-1',
        intentNonce: RESOLVE_INTENT,
        idempotencyKey: 'idem-1',
        gps: GPS,
      },
      NOW,
    );

    expect(response.data.status).toBe('CHECKED_IN');
    expect(response.data.registrationId).toBe('registration-1');
    expect(prisma.tx.mealServing.create).toHaveBeenCalledTimes(1);
    expect(prisma.tx.servingVerification.create).toHaveBeenCalledTimes(1);
  });

  it('replays a committed idempotent result without creating a second serving', async () => {
    prisma.tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'confirm-request-1',
          callerUserId: 'staff-1',
          idempotencyKey: 'idem-1',
          status: 'PROCESSING',
          requestBodyHash: 'hash',
          checkInSessionId: 'check-in-session-1',
          resultSnapshot: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'registration-1' }]);

    const first = await service.confirm(
      STAFF,
      {
        sessionId: 'check-in-session-1',
        intentNonce: RESOLVE_INTENT,
        idempotencyKey: 'idem-1',
        gps: GPS,
      },
      NOW,
    );
    expect(prisma.tx.mealServing.create).toHaveBeenCalledTimes(1);

    const requestBodyHash = String(
      prisma.tx.$queryRaw.mock.calls[1][4],
    );
    prisma.tx.$queryRaw.mockReset();
    prisma.tx.$queryRaw.mockResolvedValueOnce([
      {
        id: 'confirm-request-1',
        callerUserId: 'staff-1',
        idempotencyKey: 'idem-1',
        status: 'SUCCESS',
        requestBodyHash,
        checkInSessionId: 'check-in-session-1',
        resultSnapshot: first,
      },
    ]);

    const replay = await service.confirm(
      STAFF,
      {
        sessionId: 'check-in-session-1',
        intentNonce: RESOLVE_INTENT,
        idempotencyKey: 'idem-1',
        gps: GPS,
      },
      NOW,
    );
    expect(replay).toEqual(first);
    expect(prisma.tx.mealServing.create).toHaveBeenCalledTimes(1);

    prisma.tx.$queryRaw.mockReset();
    prisma.tx.$queryRaw.mockResolvedValueOnce([
      {
        id: 'confirm-request-1',
        callerUserId: 'staff-1',
        idempotencyKey: 'idem-1',
        status: 'SUCCESS',
        requestBodyHash,
        checkInSessionId: 'check-in-session-1',
        resultSnapshot: first,
      },
    ]);
    const replayAfterClose = await service.confirm(
      STAFF,
      {
        sessionId: 'check-in-session-1',
        intentNonce: RESOLVE_INTENT,
        idempotencyKey: 'idem-1',
        gps: GPS,
      },
      new Date('2026-09-30T06:30:01.000Z'),
    );
    expect(replayAfterClose).toEqual(first);
    expect(prisma.tx.mealServing.create).toHaveBeenCalledTimes(1);
  });

  it('excludes cancelled registrations from dashboard totals and returns no staff rows', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      { ...ASSIGNMENT, userId: 'kitchen-1' },
    ]);
    prisma.registration.findMany.mockResolvedValue([
      { status: 'ACTIVE', mealChoice: 'REGULAR', mealServing: null },
      { status: 'ACTIVE', mealChoice: 'VEGETARIAN', mealServing: { id: 's-1' } },
      { status: 'NO_SHOW', mealChoice: 'REGULAR', mealServing: null },
    ]);

    const response = await service.getKitchenDashboard(KITCHEN, undefined, undefined, NOW);

    expect(response.data.counts).toEqual({
      registered: 3,
      checkedIn: 1,
      pending: 1,
      noShow: 1,
      regular: 2,
      vegetarian: 1,
    });
    expect(response.data).not.toHaveProperty('employees');
    expect(response.data.lastUpdated).toBe(NOW.toISOString());
  });
});
