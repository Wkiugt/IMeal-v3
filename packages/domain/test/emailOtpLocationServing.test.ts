import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';

const TEST_DATE = new Date('2026-09-24T00:00:00.000Z');

async function createUser(email: string) {
  return prisma.user.create({ data: { email, name: email.split('@')[0] } });
}

async function createLocation(shortCode: string) {
  return prisma.location.create({
    data: {
      shortCode,
      displayName: `Test ${shortCode}`,
      servingPointName: `Counter ${shortCode}`,
      address: `${shortCode} test address`,
      building: 'Test building',
      floor: '1',
      roomOrCounter: `Counter ${shortCode}`,
      localContact: 'Test contact',
      timeZone: 'Asia/Ho_Chi_Minh',
      effectiveFrom: TEST_DATE,
    },
  });
}

describe('Task 2 persistence boundaries', () => {
  it('has no location or employee rows after migration', async () => {
    expect(await prisma.location.count()).toBe(0);
    expect(await prisma.employeeLocationAssignment.count()).toBe(0);
  });

  it('requires one unique active session hash and one serving per registration', async () => {
    const user = await createUser('session@example.test');
    const tokenHash = 'session-hash';

    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        purpose: 'SESSION_LOGIN',
        authMethod: 'EMAIL_OTP',
        absoluteExpiresAt: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.authSession.create({
        data: {
          userId: user.id,
          tokenHash,
          purpose: 'SESSION_LOGIN',
          authMethod: 'EMAIL_OTP',
          absoluteExpiresAt: new Date('2026-09-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });
    await prisma.mealServing.create({
      data: { registrationId: registration.id },
    });

    await expect(
      prisma.mealServing.create({
        data: { registrationId: registration.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('retains registration service-location snapshot after assignment changes', async () => {
    const user = await createUser('employee@example.test');
    const firstLocation = await createLocation('TEST-A');
    const secondLocation = await createLocation('TEST-B');
    const assignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Test Employee',
        employeeCode: 'EMP-001',
        isActive: true,
        role: 'staff',
        serviceLocationCode: firstLocation.shortCode,
        locationId: firstLocation.id,
        effectiveFrom: TEST_DATE,
      },
    });

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
        serviceLocationId: firstLocation.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: firstLocation.shortCode,
        serviceLocationName: firstLocation.displayName,
        serviceLocationAddress: firstLocation.address,
        serviceLocationSnapshotAt: TEST_DATE,
      },
    });

    await prisma.employeeLocationAssignment.update({
      where: { id: assignment.id },
      data: {
        locationId: secondLocation.id,
        serviceLocationCode: secondLocation.shortCode,
        effectiveFrom: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(persisted.serviceLocationId).toBe(firstLocation.id);
    expect(persisted.serviceLocationAssignmentId).toBe(assignment.id);
    expect(persisted.serviceLocationCode).toBe(firstLocation.shortCode);
    expect(persisted.serviceLocationName).toBe(firstLocation.displayName);
    expect(persisted.serviceLocationAddress).toBe(firstLocation.address);
    expect(persisted.serviceLocationSnapshotAt).toEqual(TEST_DATE);
  });

  it('rejects a duplicate employee code across all active assignments', async () => {
    const user = await createUser('active-code@example.test');
    const firstLocation = await createLocation('TEST-C');
    const secondLocation = await createLocation('TEST-D');

    await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Active Code Employee',
        employeeCode: 'EMP-ACTIVE',
        isActive: true,
        role: 'staff',
        serviceLocationCode: firstLocation.shortCode,
        locationId: firstLocation.id,
        effectiveFrom: TEST_DATE,
        effectiveTo: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.employeeLocationAssignment.create({
        data: {
          userId: user.id,
          normalizedEmail: user.email,
          employeeName: 'Active Code Employee',
          employeeCode: 'EMP-ACTIVE',
          isActive: true,
          role: 'staff',
          serviceLocationCode: secondLocation.shortCode,
          locationId: secondLocation.id,
          effectiveFrom: new Date('2026-09-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('requires finite accuracy for a valid serving verification', async () => {
    const user = await createUser('verification@example.test');
    const location = await createLocation('TEST-E');

    await expect(
      prisma.servingVerification.create({
        data: {
          presenterUserId: user.id,
          locationId: location.id,
          result: 'VALID',
          capturedAt: TEST_DATE,
          safeVerificationCode: 'GPS_VALID',
          accuracyMeters: null,
        },
      }),
    ).rejects.toThrow(/serving_verifications_accuracy_check/);
  });

  it('keeps serving verification IDs unique', async () => {
    const user = await createUser('verification-id@example.test');
    const location = await createLocation('TEST-F');
    const verificationId = 'verification-id';

    await prisma.servingVerification.create({
      data: {
        id: verificationId,
        presenterUserId: user.id,
        locationId: location.id,
        result: 'GPS_UNAVAILABLE',
        capturedAt: TEST_DATE,
        safeVerificationCode: 'GPS_UNAVAILABLE',
      },
    });

    await expect(
      prisma.servingVerification.create({
        data: {
          id: verificationId,
          presenterUserId: user.id,
          locationId: location.id,
          result: 'GPS_STALE',
          capturedAt: TEST_DATE,
          safeVerificationCode: 'GPS_STALE',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('requires_complete_registration_snapshots_for_new_operational_rows', async () => {
    const user = await createUser('complete-registration@example.test');
    const location = await createLocation('COMPLETE');
    const assignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Complete Registration Owner',
        employeeCode: 'COMPLETE-001',
        isActive: true,
        role: 'staff',
        serviceLocationCode: location.shortCode,
        locationId: location.id,
        effectiveFrom: TEST_DATE,
      },
    });
    const weeklyMenu = await prisma.weeklyMenu.create({
      data: {
        startDate: TEST_DATE,
        endDate: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
    const dailyMenu = await prisma.dailyMenu.create({
      data: {
        weeklyMenuId: weeklyMenu.id,
        date: TEST_DATE,
      },
    });
    const revision = await prisma.dailyMenuRevision.create({
      data: {
        dailyMenuId: dailyMenu.id,
        revision: 1,
        mealName: 'Complete menu',
        content: 'legacy content retained',
      },
    });

    await expect(
      prisma.registration.create({
        data: {
          userId: user.id,
          mealDate: TEST_DATE,
          status: 'ACTIVE',
          registeredAt: TEST_DATE,
        },
      }),
    ).rejects.toThrow(/registration_lifecycle_snapshot_complete/);

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
        menuRevisionId: revision.id,
        ownerNameSnapshot: assignment.employeeName,
        employeeCodeSnapshot: assignment.employeeCode,
        menuNameSnapshot: revision.mealName,
        serviceLocationId: location.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: location.shortCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: location.effectiveFrom,
        serviceLocationSnapshotAt: TEST_DATE,
        registeredAt: TEST_DATE,
      },
    });

    const serving = await prisma.mealServing.create({
      data: { registrationId: registration.id },
    });
    expect(serving.registrationId).toBe(registration.id);
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: registration.id },
        select: { status: true, mealServing: { select: { id: true } } },
      }),
    ).toMatchObject({ status: 'ACTIVE', mealServing: { id: serving.id } });
  });

  it('retains_legacy_null_snapshots_without_fabricating_values', async () => {
    const user = await createUser('legacy-registration@example.test');
    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(persisted.registeredAt).toBeNull();
    expect(persisted.menuRevisionId).toBeNull();
    expect(persisted.ownerNameSnapshot).toBeNull();
    expect(persisted.employeeCodeSnapshot).toBeNull();
    expect(persisted.serviceLocationId).toBeNull();
    expect(persisted.serviceLocationSnapshotAt).toBeNull();
  });

  it('rejects_duplicate_penalty_registration_id', async () => {
    const user = await createUser('penalty-registration@example.test');
    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });

    await prisma.penalty.create({
      data: {
        userId: user.id,
        registrationId: registration.id,
        mealDate: TEST_DATE,
        amount: 50000,
        reason: 'NO_SHOW',
      },
    });
    await expect(
      prisma.penalty.create({
        data: {
          userId: user.id,
          registrationId: registration.id,
          mealDate: TEST_DATE,
          amount: 50000,
          reason: 'NO_SHOW',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects_served_status_without_meal_serving', async () => {
    const user = await createUser('served-without-serving@example.test');
    await expect(
      prisma.registration.create({
        data: {
          userId: user.id,
          mealDate: TEST_DATE,
          status: 'SERVED',
        },
      }),
    ).rejects.toThrow(/registration_serving_consistency/);
  });

});
