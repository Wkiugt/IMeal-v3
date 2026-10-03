import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { getBusinessDate, parseMealDate } from '../src/common/business-time.js';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import {
  SessionService,
  hashSessionToken,
} from '../src/auth/session.service.js';
import { hashOtpCode, OtpService } from '../src/auth/otp.service.js';
import { AllowlistService } from '../src/auth/allowlist.service.js';

type LifecycleFixture = {
  actorId: string;
  actorToken: string;
  targetId: string;
  targetToken: string;
  targetSecondToken: string;
  targetRegistrationIds: string[];
  historyRegistrationId: string;
  historyPenaltyId: string;
  noShowRegistrationId: string;
  noShowPenaltyId: string;
  outgoingDelegationIds: string[];
  incomingDelegationIds: string[];
  incomingRegistrationIds: string[];
  servedRegistrationId: string;
  legacyServedRegistrationId: string;
  acceptedServedDelegationId: string;
  completedDelegationId: string;
  targetEmail: string;
};

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const TEST_BUSINESS_DATE = parseMealDate(getBusinessDate());

function dateOnly(offsetDays: number): Date {
  const date = new Date(TEST_BUSINESS_DATE);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

async function seedLifecycle(
  prisma: PrismaService,
  sessions: SessionService,
): Promise<LifecycleFixture> {
  const adminRole = await prisma.role.create({ data: { name: 'admin' } });
  const staffRole = await prisma.role.create({ data: { name: 'staff' } });
  const kitchenRole = await prisma.role.create({ data: { name: 'kitchen' } });
  const kitchenPermission = await prisma.permission.create({
    data: { name: 'kitchen.serve' },
  });
  await prisma.rolePermission.create({
    data: { roleId: kitchenRole.id, permissionId: kitchenPermission.id },
  });
  const managePermission = await prisma.permission.create({
    data: { name: 'user.manage' },
  });
  await prisma.rolePermission.create({
    data: { roleId: adminRole.id, permissionId: managePermission.id },
  });
  const staffPermission = await prisma.permission.create({
    data: { name: 'registration.cutoff.manage' },
  });
  await prisma.rolePermission.create({
    data: { roleId: staffRole.id, permissionId: staffPermission.id },
  });
  const actor = await prisma.user.create({
    data: { email: 'lifecycle-admin@example.test', name: 'Lifecycle Admin' },
  });
  const target = await prisma.user.create({
    data: { email: 'lifecycle-target@example.test', name: 'Lifecycle Target' },
  });
  await prisma.userRole.createMany({
    data: [
      { userId: actor.id, roleId: adminRole.id },
      { userId: target.id, roleId: staffRole.id },
    ],
  });
  const outgoing = await prisma.user.create({
    data: {
      email: 'lifecycle-outgoing@example.test',
      name: 'Outgoing Delegate',
    },
  });
  const incomingOwner = await prisma.user.create({
    data: {
      email: 'lifecycle-incoming-owner@example.test',
      name: 'Incoming Owner',
    },
  });
  const actorSession = await sessions.create({
    userId: actor.id,
    purpose: 'SESSION_LOGIN',
    requestId: 'lifecycle-admin-login',
    metadata: { deviceId: 'lifecycle-admin', userAgent: 'lifecycle-e2e' },
  });
  const targetSession = await sessions.create({
    userId: target.id,
    purpose: 'SESSION_LOGIN',
    requestId: 'lifecycle-target-login',
    metadata: {
      deviceId: 'lifecycle-target',
      clientIp: '192.0.2.10',
      userAgent: 'lifecycle-e2e',
    },
  });
  const targetSecondSession = await sessions.create({
    userId: target.id,
    purpose: 'SESSION_LOGIN',
    requestId: 'lifecycle-target-second-login',
    metadata: {
      deviceId: 'lifecycle-target-second',
      clientIp: '192.0.2.11',
      userAgent: 'lifecycle-e2e',
    },
  });
  const expiredAt = new Date(Date.now() - 60_000);
  await prisma.authSession.create({
    data: {
      userId: target.id,
      tokenHash: hashSessionToken('lifecycle-expired-token'),
      purpose: 'SESSION_LOGIN',
      authMethod: 'EMAIL_OTP',
      createdAt: new Date(Date.now() - 120_000),
      lastUsedAt: expiredAt,
      idleExpiresAt: expiredAt,
      absoluteExpiresAt: expiredAt,
      requestId: 'lifecycle-expired',
    },
  });

  const mealDates = [0, 1, 2, 3].map(dateOnly);
  const targetRegistrations = [];
  for (const mealDate of mealDates) {
    targetRegistrations.push(
      await prisma.registration.create({
        data: {
          userId: target.id,
          mealDate,
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      }),
    );
  }
  const historyRegistration = await prisma.registration.create({
    data: {
      userId: target.id,
      mealDate: dateOnly(-1),
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      cancelledAt: new Date(),
      cancelReason: 'HISTORICAL_TEST',
    },
  });
  const historyPenalty = await prisma.penalty.create({
    data: {
      userId: target.id,
      registrationId: historyRegistration.id,
      mealDate: historyRegistration.mealDate,
      amount: 25,
      reason: 'Historical penalty',
      status: 'PAID',
      paidAt: new Date(),
    },
  });
  const noShowRegistration = await prisma.registration.create({
    data: {
      userId: target.id,
      mealDate: dateOnly(-4),
      status: 'NO_SHOW',
      mealChoice: 'REGULAR',
    },
  });
  const noShowPenalty = await prisma.penalty.create({
    data: {
      userId: target.id,
      registrationId: noShowRegistration.id,
      mealDate: noShowRegistration.mealDate,
      amount: 25,
      reason: 'No-show penalty',
      status: 'PENDING',
    },
  });
  const servedRegistration = await prisma.registration.create({
    data: {
      userId: target.id,
      mealDate: dateOnly(-2),
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
    },
  });
  await prisma.mealServing.create({
    data: {
      registrationId: servedRegistration.id,
      ownerUserId: target.id,
      mealDate: servedRegistration.mealDate,
      servedAt: new Date(),
    },
  });
  const acceptedServedDelegation = await prisma.pickupDelegation.create({
    data: {
      registrationId: servedRegistration.id,
      delegateUserId: outgoing.id,
      status: 'ACCEPTED',
    },
  });
  await prisma.mealServing.update({
    where: { registrationId: servedRegistration.id },
    data: { delegationId: acceptedServedDelegation.id },
  });
  const legacyRegistration = await prisma.registration.create({
    data: {
      userId: target.id,
      mealDate: dateOnly(-3),
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
    },
  });
  const completedDelegation = await prisma.pickupDelegation.create({
    data: {
      registrationId: legacyRegistration.id,
      delegateUserId: outgoing.id,
      status: 'COMPLETED',
    },
  });
  await prisma.mealServing.create({
    data: {
      registrationId: legacyRegistration.id,
      ownerUserId: target.id,
      mealDate: legacyRegistration.mealDate,
      delegationId: completedDelegation.id,
      servedAt: new Date(),
    },
  });
  await prisma.registration.update({
    where: { id: legacyRegistration.id },
    data: { status: 'SERVED' },
  });
  const incomingRegistrations = await Promise.all(
    [0, 1].map((index) =>
      prisma.registration.create({
        data: {
          userId: incomingOwner.id,
          mealDate: mealDates[index],
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      }),
    ),
  );
  const outgoingDelegations = await Promise.all(
    [
      ['PENDING', targetRegistrations[0].id],
      ['ACCEPTED', targetRegistrations[1].id],
    ].map(([status, registrationId]) =>
      prisma.pickupDelegation.create({
        data: {
          registrationId,
          delegateUserId: outgoing.id,
          status: status as 'PENDING' | 'ACCEPTED',
        },
      }),
    ),
  );
  const incomingDelegations = await Promise.all(
    [
      ['PENDING', incomingRegistrations[0].id],
      ['ACCEPTED', incomingRegistrations[1].id],
    ].map(([status, registrationId]) =>
      prisma.pickupDelegation.create({
        data: {
          registrationId,
          delegateUserId: target.id,
          status: status as 'PENDING' | 'ACCEPTED',
        },
      }),
    ),
  );
  const allowlist = await prisma.otpAllowlist.create({
    data: {
      normalizedEmail: target.email,
      userId: target.id,
      state: 'ACTIVE',
      purpose: 'SESSION_LOGIN',
      effectiveFrom: dateOnly(-10),
    },
  });
  void allowlist;

  return {
    actorId: actor.id,
    actorToken: actorSession.token,
    targetId: target.id,
    targetToken: targetSession.token,
    targetSecondToken: targetSecondSession.token,
    targetRegistrationIds: targetRegistrations.map(({ id }) => id),
    historyRegistrationId: historyRegistration.id,
    historyPenaltyId: historyPenalty.id,
    noShowRegistrationId: noShowRegistration.id,
    noShowPenaltyId: noShowPenalty.id,
    outgoingDelegationIds: outgoingDelegations.map(({ id }) => id),
    incomingDelegationIds: incomingDelegations.map(({ id }) => id),
    incomingRegistrationIds: incomingRegistrations.map(({ id }) => id),
    servedRegistrationId: servedRegistration.id,
    legacyServedRegistrationId: legacyRegistration.id,
    acceptedServedDelegationId: acceptedServedDelegation.id,
    completedDelegationId: completedDelegation.id,
    targetEmail: target.email,
  };
}

describe('Admin user lifecycle with real opaque SessionGuard', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let sessions: SessionService;
  let fixture: LifecycleFixture;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'true';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    fixture = await seedLifecycle(prisma, sessions);
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses one opaque token for live role changes, staff access, and Kitchen403', async () => {
    const targetHeaders = bearer(fixture.targetToken);
    const adminHeaders = bearer(fixture.actorToken);
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/admin/users')
          .set(adminHeaders)
      ).status,
    ).toBe(200);
    const deniedManageBefore = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(targetHeaders)
      .send({ roles: ['staff'] });
    expect(deniedManageBefore.status).toBe(403);
    const initialProfile = await request(app.getHttpServer())
      .get('/auth/me')
      .set(targetHeaders);
    expect(initialProfile.status).toBe(200);
    expect(initialProfile.body.roles).toEqual(['staff']);

    const deniedBefore = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set(targetHeaders);
    expect(deniedBefore.status).toBe(403);
    const deniedUnprefixed = await request(app.getHttpServer())
      .get('/admin/users')
      .set(targetHeaders);
    expect(deniedUnprefixed.status).toBe(403);

    const addedKitchen = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['staff', 'kitchen'] });
    expect(addedKitchen.status).toBe(200);
    expect(addedKitchen.body.managedRoles).toEqual(['staff', 'kitchen']);

    const sameTokenKitchen = await request(app.getHttpServer())
      .get('/auth/me')
      .set(targetHeaders);
    expect(sameTokenKitchen.status).toBe(200);
    expect(sameTokenKitchen.body.roles).toEqual(
      expect.arrayContaining(['staff', 'kitchen']),
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/admin/users')
          .set(targetHeaders)
      ).status,
    ).toBe(403);
    const deniedKitchenUnprefixed = await request(app.getHttpServer())
      .get('/admin/users')
      .set(targetHeaders);
    expect(deniedKitchenUnprefixed.status).toBe(403);
    const checkInLocation = await prisma.location.create({
      data: {
        shortCode: 'LIFECYCLE-CHECKIN',
        displayName: 'Lifecycle Check-in',
        servingPointName: 'Lifecycle Counter',
        address: '1 Lifecycle Street',
        building: 'A',
        floor: '1',
        roomOrCounter: '1',
        localContact: 'lifecycle-checkin@example.test',
        isActive: true,
        effectiveFrom: dateOnly(-10),
      },
    });
    await prisma.locationPolicy.create({
      data: {
        locationId: checkInLocation.id,
        latitude: 10.77,
        longitude: 106.69,
        accuracySource: 'LIFECYCLE_TEST',
        geofenceRadiusMeters: 100,
        maxFixAgeSeconds: 60,
        maxAccuracyMeters: 50,
        effectiveFrom: dateOnly(-10),
        isActive: true,
      },
    });
    await prisma.employeeLocationAssignment.create({
      data: {
        userId: fixture.targetId,
        normalizedEmail: fixture.targetEmail,
        employeeName: 'Lifecycle Target',
        employeeCode: 'LIFECYCLE-CHECKIN-001',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: checkInLocation.shortCode,
        locationId: checkInLocation.id,
        effectiveFrom: dateOnly(-10),
      },
    });
    const removedLegacyKitchenRoute = await request(app.getHttpServer())
      .get('/v1/kitchen/today/dashboard')
      .set(targetHeaders);
    expect(removedLegacyKitchenRoute.status).toBe(404);
    const deniedManageKitchen = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(targetHeaders)
      .send({ roles: ['staff', 'kitchen'] });
    expect(deniedManageKitchen.status).toBe(403);
    const onlyKitchen = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['kitchen'] });
    expect(onlyKitchen.status).toBe(200);
    const canonicalKitchenDashboard = await request(app.getHttpServer())
      .get('/api/kitchen/check-in/dashboard')
      .set(targetHeaders);
    expect(canonicalKitchenDashboard.status).toBe(200);
    const onlyKitchenProfile = await request(app.getHttpServer())
      .get('/auth/me')
      .set(targetHeaders);
    expect(onlyKitchenProfile.status).toBe(200);
    expect(onlyKitchenProfile.body.roles).toEqual(['kitchen']);
    const deniedStaffEndpoint = await request(app.getHttpServer())
      .put('/api/registrations/cutoff')
      .set(targetHeaders)
      .send({ cutoffTime: '18:00', version: 1 });
    expect(deniedStaffEndpoint.status).toBe(403);
    const deniedOnlyKitchenAdminList = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set(targetHeaders);
    expect(deniedOnlyKitchenAdminList.status).toBe(403);
    const deniedOnlyKitchenManage = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(targetHeaders)
      .send({ roles: ['kitchen'] });
    expect(deniedOnlyKitchenManage.status).toBe(403);

    const removedKitchen = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['staff'] });
    expect(removedKitchen.status).toBe(200);
    const sameTokenStaff = await request(app.getHttpServer())
      .get('/auth/me')
      .set(targetHeaders);
    expect(sameTokenStaff.status).toBe(200);
    expect(sameTokenStaff.body.roles).toEqual(['staff']);
    const deniedKitchenAfterRemoval = await request(app.getHttpServer())
      .get('/v1/kitchen/today/dashboard')
      .set(targetHeaders);
    expect(deniedKitchenAfterRemoval.status).toBe(404);
    const canonicalKitchenAfterRemoval = await request(app.getHttpServer())
      .get('/api/kitchen/check-in/dashboard')
      .set(targetHeaders);
    expect(canonicalKitchenAfterRemoval.status).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/registrations/history')
          .set(targetHeaders)
      ).status,
    ).toBe(200);
    const sameSet = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['staff'] });
    expect(sameSet.body.changed).toBe(false);

    const preservedAdmin = await prisma.user.create({
      data: {
        email: 'lifecycle-preserved-admin@example.test',
        name: 'Preserved Admin',
      },
    });
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'admin' },
    });
    const staffRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'staff' },
    });
    await prisma.userRole.createMany({
      data: [
        { userId: preservedAdmin.id, roleId: adminRole.id },
        { userId: preservedAdmin.id, roleId: staffRole.id },
      ],
    });
    await request(app.getHttpServer())
      .put(`/v1/admin/users/${preservedAdmin.id}/roles`)
      .set(adminHeaders)
      .send({ roles: ['kitchen'] })
      .expect(200);
    expect(
      (
        await prisma.userRole.findMany({
          where: { userId: preservedAdmin.id },
          include: { role: true },
        })
      )
        .map(({ role }) => role.name)
        .sort(),
    ).toEqual(['admin', 'kitchen']);
    await request(app.getHttpServer())
      .put(`/v1/admin/users/${preservedAdmin.id}/roles`)
      .set(adminHeaders)
      .send({ roles: [] })
      .expect(200);
    expect(
      (
        await prisma.userRole.findMany({
          where: { userId: preservedAdmin.id },
          include: { role: true },
        })
      ).map(({ role }) => role.name),
    ).toEqual(['admin']);

    const rejectedAdminRole = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['admin'] });
    expect(rejectedAdminRole.status).toBe(400);
  });

  it('keeps sessions and audit private while previewing four meals, two active sessions, history, penalty, and both delegations', async () => {
    const adminHeaders = bearer(fixture.actorToken);
    const preview = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/disable/preview`)
      .set(adminHeaders);
    expect(preview.status).toBe(201);
    expect(preview.body.registrations).toMatchObject({ count: 4 });
    expect(preview.body.activeSessionCount).toBe(2);
    expect(preview.body.outgoingDelegations).toMatchObject({ count: 2 });
    expect(preview.body.incomingDelegations).toMatchObject({ count: 2 });
    expect(preview.body.registrations.items).toHaveLength(4);

    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/users/${fixture.targetId}`)
      .set(adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.sessions).toEqual({ activeCount: 2, totalCount: 3 });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /tokenHash|deviceIdHash|clientIpHash|userAgentHash|authorization|password|secret/i,
    );

    const sessionsResponse = await request(app.getHttpServer())
      .get(`/v1/admin/users/${fixture.targetId}/sessions?includeRevoked=true`)
      .set(adminHeaders);
    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body.items).toHaveLength(3);
    expect(JSON.stringify(sessionsResponse.body)).not.toMatch(
      /tokenHash|deviceIdHash|clientIpHash|userAgentHash|authorization|password|secret/i,
    );

    await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['staff', 'kitchen'] });
    const audit = await request(app.getHttpServer())
      .get(`/v1/admin/users/${fixture.targetId}/audit?limit=20`)
      .set(adminHeaders);
    expect(audit.status).toBe(200);
    expect(audit.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'USER_ROLES_UPDATED' }),
      ]),
    );
    expect(JSON.stringify(audit.body)).not.toMatch(
      /tokenHash|deviceIdHash|clientIpHash|userAgentHash|authorization|password|secret|otp/i,
    );
  });

  it('disables four current/future registrations, four pending/accepted delegations, and two sessions atomically and idempotently', async () => {
    const adminHeaders = bearer(fixture.actorToken);
    const disabled = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    expect(disabled.status).toBe(201);
    expect(disabled.body).toMatchObject({
      changed: true,
      affected: {
        registrationsCancelled: 4,
        delegationsRevoked: 4,
        sessionsRevoked: 2,
      },
    });

    const registrations = await prisma.registration.findMany({
      where: { id: { in: fixture.targetRegistrationIds } },
    });
    expect(registrations).toHaveLength(4);
    expect(registrations.every(({ status }) => status === 'CANCELLED')).toBe(
      true,
    );
    expect(new Set(registrations.map(({ id }) => id))).toEqual(
      new Set(fixture.targetRegistrationIds),
    );
    for (const registration of registrations) {
      expect(registration).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'ACCOUNT_DISABLED',
        cancelledByUserId: fixture.actorId,
        cancelledAt: expect.any(Date),
      });
    }
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: fixture.historyRegistrationId },
      }),
    ).toMatchObject({ status: 'CANCELLED', cancelReason: 'HISTORICAL_TEST' });
    expect(
      await prisma.penalty.findUniqueOrThrow({
        where: { id: fixture.historyPenaltyId },
      }),
    ).toMatchObject({ status: 'PAID' });
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: fixture.noShowRegistrationId },
      }),
    ).toMatchObject({ status: 'NO_SHOW' });
    expect(
      await prisma.penalty.findUniqueOrThrow({
        where: { id: fixture.noShowPenaltyId },
      }),
    ).toMatchObject({ status: 'PENDING' });
    const targetPenalties = await prisma.penalty.findMany({
      where: { userId: fixture.targetId },
      select: { id: true, status: true },
    });
    expect(targetPenalties).toHaveLength(2);
    expect(new Set(targetPenalties.map(({ id }) => id))).toEqual(
      new Set([fixture.historyPenaltyId, fixture.noShowPenaltyId]),
    );
    for (const incomingRegistrationId of fixture.incomingRegistrationIds) {
      expect(
        await prisma.registration.findUniqueOrThrow({
          where: { id: incomingRegistrationId },
        }),
      ).toMatchObject({ status: 'ACTIVE' });
    }
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: fixture.servedRegistrationId },
        include: { mealServing: true },
      }),
    ).toMatchObject({
      status: 'ACTIVE',
      mealServing: { id: expect.any(String) },
    });
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: fixture.legacyServedRegistrationId },
        include: { mealServing: true },
      }),
    ).toMatchObject({
      status: 'SERVED',
      mealServing: { id: expect.any(String) },
    });
    expect(
      await prisma.pickupDelegation.findUniqueOrThrow({
        where: { id: fixture.acceptedServedDelegationId },
      }),
    ).toMatchObject({ status: 'ACCEPTED' });
    expect(
      await prisma.pickupDelegation.findUniqueOrThrow({
        where: { id: fixture.completedDelegationId },
      }),
    ).toMatchObject({ status: 'COMPLETED' });
    const revokedDelegations = await prisma.pickupDelegation.findMany({
      where: {
        id: {
          in: [
            ...fixture.outgoingDelegationIds,
            ...fixture.incomingDelegationIds,
          ],
        },
      },
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    });
    expect(revokedDelegations).toHaveLength(4);
    expect(new Set(revokedDelegations.map(({ id }) => id))).toEqual(
      new Set([
        ...fixture.outgoingDelegationIds,
        ...fixture.incomingDelegationIds,
      ]),
    );
    expect(revokedDelegations.every(({ status }) => status === 'REVOKED')).toBe(
      true,
    );
    expect(
      await prisma.authSession.count({
        where: { userId: fixture.targetId, revokedReason: 'ACCOUNT_DISABLED' },
      }),
    ).toBe(2);
    expect(
      await prisma.authSession.findMany({
        where: { userId: fixture.targetId, revokedAt: { not: null } },
        select: { revokedReason: true },
      }),
    ).toEqual([
      { revokedReason: 'ACCOUNT_DISABLED' },
      { revokedReason: 'ACCOUNT_DISABLED' },
    ]);

    const invalidated = await request(app.getHttpServer())
      .get('/auth/me')
      .set(bearer(fixture.targetToken));
    expect(invalidated.status).toBe(401);
    expect(invalidated.body.error.code).toBe('SESSION_INVALID');

    const repeated = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    expect(repeated.status).toBe(201);
    expect(repeated.body).toMatchObject({
      changed: false,
      affected: {
        registrationsCancelled: 0,
        delegationsRevoked: 0,
        sessionsRevoked: 0,
      },
    });
  });

  it('blocks disabled OTP, preserves allowlist independence, keeps old sessions revoked, and permits fresh OTP after enable', async () => {
    const adminHeaders = bearer(fixture.actorToken);
    const otpService = app.get(OtpService);
    const allowlist = await prisma.otpAllowlist.findFirstOrThrow({
      where: {
        normalizedEmail: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
      },
    });
    const oldCode = '123456';
    await prisma.otpChallenge.create({
      data: {
        allowlistId: allowlist.id,
        normalizedEmail: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
        verifierHash: hashOtpCode(
          oldCode,
          fixture.targetEmail,
          'SESSION_LOGIN',
          otpService.getConfig().hashSecret,
        ),
        expiresAt: new Date(Date.now() + 60_000),
        resendAfter: new Date(Date.now() - 1_000),
        requestId: 'lifecycle-old-otp-challenge',
      },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    const allowlistService = app.get(AllowlistService);
    expect(
      await allowlistService.findEligible(fixture.targetEmail, 'SESSION_LOGIN'),
    ).toBeNull();
    const disabledVerify = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        email: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
        code: oldCode,
      });
    expect(disabledVerify.status).toBe(401);
    expect(disabledVerify.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
    const disabledOtp = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ email: fixture.targetEmail, purpose: 'SESSION_LOGIN' });
    expect(disabledOtp.status).toBe(201);
    expect(disabledOtp.body).toEqual({ accepted: true });
    expect(
      await prisma.otpChallenge.count({
        where: { normalizedEmail: fixture.targetEmail },
      }),
    ).toBe(1);

    await prisma.otpAllowlist.update({
      where: { id: allowlist.id },
      data: { state: 'DISABLED' },
    });
    const enabled = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/enable`)
      .set(adminHeaders)
      .send({});
    expect(enabled.status).toBe(201);
    expect(enabled.body).toMatchObject({
      userId: fixture.targetId,
      isActive: true,
      changed: true,
      auditCreated: true,
    });
    const repeatedEnable = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/enable`)
      .set(adminHeaders)
      .send({});
    expect(repeatedEnable.status).toBe(201);
    expect(repeatedEnable.body).toMatchObject({
      userId: fixture.targetId,
      isActive: true,
      changed: false,
      auditCreated: false,
    });
    const persistedRegistrations = await prisma.registration.findMany({
      where: { id: { in: fixture.targetRegistrationIds } },
      select: {
        id: true,
        status: true,
        cancelReason: true,
        cancelledByUserId: true,
        cancelledAt: true,
      },
    });
    expect(persistedRegistrations).toHaveLength(4);
    expect(new Set(persistedRegistrations.map(({ id }) => id))).toEqual(
      new Set(fixture.targetRegistrationIds),
    );
    for (const registration of persistedRegistrations) {
      expect(registration).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'ACCOUNT_DISABLED',
        cancelledByUserId: fixture.actorId,
        cancelledAt: expect.any(Date),
      });
    }
    const persistedDelegations = await prisma.pickupDelegation.findMany({
      where: {
        id: {
          in: [
            ...fixture.outgoingDelegationIds,
            ...fixture.incomingDelegationIds,
          ],
        },
      },
      select: { id: true, status: true },
    });
    expect(persistedDelegations).toHaveLength(4);
    expect(new Set(persistedDelegations.map(({ id }) => id))).toEqual(
      new Set([
        ...fixture.outgoingDelegationIds,
        ...fixture.incomingDelegationIds,
      ]),
    );
    expect(
      persistedDelegations.every(({ status }) => status === 'REVOKED'),
    ).toBe(true);
    expect(
      await allowlistService.findEligible(fixture.targetEmail, 'SESSION_LOGIN'),
    ).toBeNull();
    const stillDisabledOtp = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ email: fixture.targetEmail, purpose: 'SESSION_LOGIN' });
    expect(stillDisabledOtp.status).toBe(201);
    expect(stillDisabledOtp.body).toEqual({ accepted: true });
    expect(
      await prisma.otpChallenge.count({
        where: { normalizedEmail: fixture.targetEmail },
      }),
    ).toBe(1);
    const stillDisabledVerify = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        email: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
        code: oldCode,
      });
    expect(stillDisabledVerify.status).toBe(401);
    expect(stillDisabledVerify.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');

    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/me')
          .set(bearer(fixture.targetToken))
      ).status,
    ).toBe(401);
    await prisma.otpAllowlist.update({
      where: { id: allowlist.id },
      data: { state: 'ACTIVE' },
    });
    expect(
      await allowlistService.findEligible(fixture.targetEmail, 'SESSION_LOGIN'),
    ).toMatchObject({ userId: fixture.targetId });
    const freshCode = '654321';
    await prisma.otpChallenge.create({
      data: {
        allowlistId: allowlist.id,
        normalizedEmail: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
        verifierHash: hashOtpCode(
          freshCode,
          fixture.targetEmail,
          'SESSION_LOGIN',
          otpService.getConfig().hashSecret,
        ),
        expiresAt: new Date(Date.now() + 60_000),
        resendAfter: new Date(Date.now() - 1_000),
        requestId: 'lifecycle-fresh-otp-challenge',
        createdAt: new Date(Date.now() + 1_000),
      },
    });
    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        email: fixture.targetEmail,
        purpose: 'SESSION_LOGIN',
        code: freshCode,
      });
    expect(verified.status).toBe(201);
    expect(verified.body).toMatchObject({
      sessionToken: expect.any(String),
      user: { id: fixture.targetId },
    });
    const freshProfile = await request(app.getHttpServer())
      .get('/auth/me')
      .set(bearer(verified.body.sessionToken));
    expect(freshProfile.status).toBe(200);
    expect(freshProfile.body.id).toBe(fixture.targetId);
    await prisma.otpAllowlist.update({
      where: { id: allowlist.id },
      data: { state: 'DISABLED' },
    });
    expect(
      await allowlistService.findEligible(fixture.targetEmail, 'SESSION_LOGIN'),
    ).toBeNull();
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/me')
          .set(bearer(verified.body.sessionToken))
      ).status,
    ).toBe(200);
  });

  it('revokes all sessions idempotently and returns safe lifecycle audit', async () => {
    const adminHeaders = bearer(fixture.actorToken);
    const revoked = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/sessions/revoke-all`)
      .set(adminHeaders)
      .send({});
    expect(revoked.status).toBe(201);
    expect(revoked.body).toMatchObject({ revokedCount: 3, changed: true });
    const repeated = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.targetId}/sessions/revoke-all`)
      .set(adminHeaders)
      .send({});
    expect(repeated.status).toBe(201);
    expect(repeated.body).toMatchObject({ revokedCount: 0, changed: false });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: fixture.targetId } }),
    ).toMatchObject({ isActive: true });
    expect(
      await prisma.authSession.findMany({
        where: { userId: fixture.targetId, revokedAt: { not: null } },
        select: { revokedReason: true },
      }),
    ).toEqual([
      { revokedReason: 'ADMIN_REVOKED' },
      { revokedReason: 'ADMIN_REVOKED' },
      { revokedReason: 'ADMIN_REVOKED' },
    ]);
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/me')
          .set(bearer(fixture.targetSecondToken))
      ).status,
    ).toBe(401);
    const audit = await request(app.getHttpServer())
      .get(
        `/v1/admin/users/${fixture.targetId}/audit?action=USER_SESSIONS_REVOKED`,
      )
      .set(adminHeaders);
    expect(audit.status).toBe(200);
    expect(audit.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'USER_SESSIONS_REVOKED',
          details: expect.objectContaining({ revokedCount: 3 }),
        }),
      ]),
    );
    expect(JSON.stringify(audit.body)).not.toMatch(
      /tokenHash|authorization|secret/i,
    );
  });

  it('protects the last eligible admin while allowing exactly one other eligible admin', async () => {
    const adminHeaders = bearer(fixture.actorToken);
    const selfDisable = await request(app.getHttpServer())
      .post(`/v1/admin/users/${fixture.actorId}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    expect(selfDisable.status).toBe(409);
    expect(selfDisable.body.error.code).toBe('ADMIN_SELF_DISABLE_FORBIDDEN');
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'admin' },
    });
    const sole = await prisma.user.create({
      data: { email: 'lifecycle-sole-admin@example.test', name: 'Sole Admin' },
    });
    await prisma.userRole.create({
      data: { userId: sole.id, roleId: adminRole.id },
    });
    await prisma.otpAllowlist.create({
      data: {
        normalizedEmail: sole.email,
        userId: sole.id,
        state: 'ACTIVE',
        purpose: 'SESSION_LOGIN',
        effectiveFrom: dateOnly(-1),
      },
    });
    const blocked = await request(app.getHttpServer())
      .post(`/v1/admin/users/${sole.id}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ADMIN_LAST_ACTIVE_ADMIN');
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: sole.id } }),
    ).toMatchObject({ isActive: true });

    const other = await prisma.user.create({
      data: {
        email: 'lifecycle-other-admin@example.test',
        name: 'Other Admin',
      },
    });
    await prisma.userRole.create({
      data: { userId: other.id, roleId: adminRole.id },
    });
    await prisma.otpAllowlist.create({
      data: {
        normalizedEmail: other.email,
        userId: other.id,
        state: 'ACTIVE',
        purpose: 'SESSION_LOGIN',
        effectiveFrom: dateOnly(-1),
      },
    });
    const allowed = await request(app.getHttpServer())
      .post(`/v1/admin/users/${sole.id}/disable`)
      .set(adminHeaders)
      .send({ confirm: true });
    expect(allowed.status).toBe(201);
    expect(allowed.body.changed).toBe(true);
  });

  it('keeps roster assignment role independent from managed UserRole in both directions', async () => {
    const location = await prisma.location.create({
      data: {
        shortCode: 'LIFECYCLE-HQ',
        displayName: 'Lifecycle HQ',
        servingPointName: 'Lifecycle Counter',
        address: '1 Lifecycle Street',
        building: 'A',
        floor: '1',
        roomOrCounter: '1',
        localContact: 'lifecycle@example.test',
        isActive: true,
        effectiveFrom: dateOnly(-10),
      },
    });
    const assignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: fixture.targetId,
        normalizedEmail: fixture.targetEmail,
        employeeName: 'Lifecycle Target',
        employeeCode: 'LIFECYCLE-001',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: location.shortCode,
        locationId: location.id,
        effectiveFrom: dateOnly(-10),
      },
    });
    const adminHeaders = bearer(fixture.actorToken);
    const kitchenRoleResponse = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['kitchen'] });
    expect(kitchenRoleResponse.status).toBe(200);
    expect(kitchenRoleResponse.body.managedRoles).toEqual(['kitchen']);
    await expect(
      prisma.employeeLocationAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      }),
    ).resolves.toMatchObject({ role: 'STAFF' });
    const staffRoleResponse = await request(app.getHttpServer())
      .put(`/v1/admin/users/${fixture.targetId}/roles`)
      .set(adminHeaders)
      .send({ roles: ['staff'] });
    expect(staffRoleResponse.status).toBe(200);
    await expect(
      prisma.userRole.findMany({
        where: { userId: fixture.targetId },
        include: { role: true },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ name: 'staff' }),
      }),
    ]);
    await prisma.employeeLocationAssignment.update({
      where: { id: assignment.id },
      data: { role: 'KITCHEN' },
    });
    await expect(
      prisma.employeeLocationAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      }),
    ).resolves.toMatchObject({ role: 'KITCHEN' });
    await expect(
      prisma.userRole.findMany({
        where: { userId: fixture.targetId },
        include: { role: true },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ name: 'staff' }),
      }),
    ]);
  });
});
