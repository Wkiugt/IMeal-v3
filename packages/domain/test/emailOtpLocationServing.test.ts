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
});
