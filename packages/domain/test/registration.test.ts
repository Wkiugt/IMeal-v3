import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RegistrationService } from '../src/RegistrationService';
import { LegacyRegistrationFixtureService } from './legacyRegistrationFixture';
import { prisma } from '../src/db';
import { toZonedTime } from 'date-fns-tz';

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

describe('Domain Tests: Registration Rules', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Cutoff boundaries', () => {
    it('allows registration before 14:00 VN', () => {
      // Current time is 13:59:59 VN on 2026-08-28
      const current = new Date('2026-08-28T06:59:59.000Z'); // UTC time for 13:59:59 VN
      const targetDate = new Date('2026-08-29T17:00:00.000Z'); // Next day in UTC (Midnight VN)

      expect(RegistrationService.isAllowed(targetDate, current)).toBe(true);
    });

    it('denies registration at exactly 14:00 VN', () => {
      // Current time is 14:00:00 VN on 2026-08-28
      const current = new Date('2026-08-28T07:00:00.000Z'); // UTC time for 14:00:00 VN
      const targetDate = new Date('2026-08-28T17:00:00.000Z'); // 2026-08-29 VN

      expect(RegistrationService.isAllowed(targetDate, current)).toBe(false);
    });

    it('denies registration after 14:00 VN for tomorrow', () => {
      // Current time is 14:01:00 VN
      const current = new Date('2026-08-28T07:01:00.000Z');
      const targetDate = new Date('2026-08-28T17:00:00.000Z'); // 2026-08-29 VN

      expect(RegistrationService.isAllowed(targetDate, current)).toBe(false);
    });

    it('allows registration after 14:00 VN for day after tomorrow', () => {
      // Current time is 14:01:00 VN
      const current = new Date('2026-08-28T07:01:00.000Z');
      const targetDate = new Date('2026-08-29T17:00:00.000Z'); // 2026-08-30 VN

      expect(RegistrationService.isAllowed(targetDate, current)).toBe(true);
    });

    // Exact 10:30, 13:30, 13:45 boundaries.
    it('exact 10:30, 13:30, 13:45 are allowed for tomorrow', () => {
      const targetDate = new Date('2026-08-28T17:00:00.000Z'); // 2026-08-29 VN

      const t1030 = new Date('2026-08-28T03:30:00.000Z');
      expect(RegistrationService.isAllowed(targetDate, t1030)).toBe(true);

      const t1330 = new Date('2026-08-28T06:30:00.000Z');
      expect(RegistrationService.isAllowed(targetDate, t1330)).toBe(true);

      const t1345 = new Date('2026-08-28T06:45:00.000Z');
      expect(RegistrationService.isAllowed(targetDate, t1345)).toBe(true);
    });
  });

  describe('Service-location snapshots', () => {
    it('copies the effective assignment and location values without exposing mutable references', () => {
      const snapshotAt = new Date('2026-09-24T03:00:00.000Z');
      const assignment = {
        id: 'assignment-1',
        serviceLocationCode: 'LOC-A',
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        location: {
          id: 'location-1',
          displayName: 'Approved location',
          address: 'Approved address',
        },
      };

      expect(
        RegistrationService.buildLocationSnapshot(assignment, snapshotAt),
      ).toEqual({
        serviceLocationId: 'location-1',
        serviceLocationAssignmentId: 'assignment-1',
        serviceLocationCode: 'LOC-A',
        serviceLocationName: 'Approved location',
        serviceLocationAddress: 'Approved address',
        serviceLocationEffectiveFrom: assignment.effectiveFrom,
        serviceLocationSnapshotAt: snapshotAt,
      });
    });

    it('filters assignments to locations effective on the meal date', () => {
      const mealDate = new Date('2026-09-24T00:00:00.000Z');
      const where = RegistrationService.buildEffectiveAssignmentWhere(
        'user-1',
        'employee@example.test',
        mealDate,
      );

      expect(where.location).toEqual({
        is: {
          isActive: true,
          effectiveFrom: { lte: mealDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: mealDate } }],
        },
      });
    });
  });

  describe('Integration with DB', () => {
    it('Cancel registration atomically revokes active delegation', async () => {
      const user1 = await prisma.user.create({ data: { email: 'u1@ex.com' } });
      const user2 = await prisma.user.create({ data: { email: 'u2@ex.com' } });

      const targetDate = new Date('2026-08-30T00:00:00.000Z'); // Dummy date

      // Create weekly & daily menu
      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate, endDate: targetDate },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });

      const current = new Date('2026-08-28T00:00:00.000Z');

      // Register
      const reg = await LegacyRegistrationFixtureService.registerMeal(
        user1.id,
        targetDate,
        current,
      );

      // Delegate
      await LegacyRegistrationFixtureService.delegatePickup(reg.id, user2.id, current);

      // Assert delegation exists
      let dels = await prisma.pickupDelegation.findMany({
        where: {
          registrationId: reg.id,
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
      });
      expect(dels.length).toBe(1);

      // Cancel
      await RegistrationService.cancelRegistration(reg.id, current);

      // Assert registration is canceled and delegation revoked
      const updatedReg = await prisma.registration.findUnique({
        where: { id: reg.id },
      });
      expect(updatedReg?.status).toBe('CANCELLED');

      dels = await prisma.pickupDelegation.findMany({
        where: {
          registrationId: reg.id,
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
      });
      expect(dels.length).toBe(0);
    });

    it('Account-disable atomically cancels snapshot-complete future registrations', async () => {
      const user = await prisma.user.create({
        data: { email: 'disable@ex.com', name: 'Disabled Owner' },
      });
      const admin = await prisma.user.create({
        data: { email: 'disable-admin@ex.com', name: 'Disable Admin' },
      });
      const delegate = await prisma.user.create({
        data: { email: 'disable-delegate@ex.com', name: 'Delegate' },
      });
      const targetDate1 = new Date('2026-08-30T00:00:00.000Z');
      const targetDate2 = new Date('2026-08-31T00:00:00.000Z');
      const location = await prisma.location.create({
        data: {
          shortCode: 'DISABLE',
          displayName: 'Disable Kitchen',
          servingPointName: 'Disable counter',
          address: '1 Disable Street',
          building: 'A',
          floor: '1',
          roomOrCounter: '1',
          localContact: 'disable@example.com',
          isActive: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      const assignment = await prisma.employeeLocationAssignment.create({
        data: {
          userId: user.id,
          normalizedEmail: user.email,
          employeeName: 'Disabled Owner',
          employeeCode: 'DISABLE-001',
          isActive: true,
          role: 'STAFF',
          serviceLocationCode: location.shortCode,
          locationId: location.id,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate1, endDate: targetDate2 },
      });
      const dailyMenu1 = await prisma.dailyMenu.create({
        data: {
          date: targetDate1,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });
      const dailyMenu2 = await prisma.dailyMenu.create({
        data: {
          date: targetDate2,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });
      const revision1 = await prisma.dailyMenuRevision.create({
        data: {
          dailyMenuId: dailyMenu1.id,
          revision: 1,
          mealName: 'Disable lunch 1',
          content: 'Disable lunch 1',
        },
      });
      const revision2 = await prisma.dailyMenuRevision.create({
        data: {
          dailyMenuId: dailyMenu2.id,
          revision: 1,
          mealName: 'Disable lunch 2',
          content: 'Disable lunch 2',
        },
      });
      const current = new Date('2026-08-28T00:00:00.000Z');
      const snapshot = (
        revision: { id: string; mealName: string },
        mealDate: Date,
      ) => ({
        userId: user.id,
        mealDate,
        status: 'ACTIVE' as const,
        menuRevisionId: revision.id,
        ownerNameSnapshot: 'Disabled Owner',
        employeeCodeSnapshot: 'DISABLE-001',
        menuNameSnapshot: revision.mealName,
        registeredAt: current,
        serviceLocationId: location.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: location.shortCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: assignment.effectiveFrom,
        serviceLocationSnapshotAt: current,
      });
      const registration1 = await prisma.registration.create({
        data: snapshot(
          { id: revision1.id, mealName: revision1.mealName! },
          targetDate1,
        ),
      });
      const registration2 = await prisma.registration.create({
        data: snapshot(
          { id: revision2.id, mealName: revision2.mealName! },
          targetDate2,
        ),
      });
      await prisma.pickupDelegation.create({
        data: {
          registrationId: registration1.id,
          delegateUserId: delegate.id,
          status: 'ACCEPTED',
        },
      });

      const cancelled = await RegistrationService.disableUserAccount(
        user.id,
        current,
        admin.id,
      );

      expect(cancelled).toEqual(
        expect.arrayContaining([registration1.id, registration2.id]),
      );
      const regs = await prisma.registration.findMany({
        where: { userId: user.id },
        orderBy: { mealDate: 'asc' },
      });
      expect(regs).toHaveLength(2);
      expect(regs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'CANCELLED',
            cancelReason: 'ACCOUNT_DISABLED',
            cancelledByUserId: admin.id,
            cancelledAt: current,
          }),
        ]),
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .isActive,
      ).toBe(false);
      expect(
        await prisma.pickupDelegation.findFirstOrThrow({
          where: { registrationId: registration1.id },
        }),
      ).toMatchObject({ status: 'REVOKED' });
      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          userId: delegate.id,
          kind: 'DELEGATION_REVOKED',
        },
      });
      expect(notification).toMatchObject({
        payload: expect.objectContaining({ reason: 'ACCOUNT_DISABLED' }),
      });
      expect(
        await prisma.outboxEvent.findFirstOrThrow({
          where: {
            aggregateType: 'NOTIFICATION',
            aggregateId: notification.id,
            eventType: 'NOTIFICATION_CREATED',
          },
        }),
      ).toMatchObject({
        payload: JSON.stringify({ notificationId: notification.id }),
      });
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'registration_account_disabled',
            userId: admin.id,
          },
        }),
      ).toBe(2);
      expect(await prisma.penalty.count({ where: { userId: user.id } })).toBe(0);
    });

    it('No-show/penalty idempotency', async () => {
      const user = await prisma.user.create({
        data: { email: 'noshow@ex.com' },
      });
      const current = new Date('2026-08-28T00:00:00.000Z');

      await LegacyRegistrationFixtureService.applyNoShowPenalty(
        user.id,
        'noshow_key_1',
        current,
      );
      await LegacyRegistrationFixtureService.applyNoShowPenalty(
        user.id,
        'noshow_key_1',
        current,
      ); // idempotent

      const penalties = await prisma.penalty.findMany({
        where: { userId: user.id },
      });
      expect(penalties.length).toBe(1);
      expect(penalties[0].amount).toBe(50000);
    });

    it('Serving eligibility self/proxy', async () => {
      const selfUser = await prisma.user.create({
        data: { email: 'self@ex.com' },
      });
      const proxyUser = await prisma.user.create({
        data: { email: 'proxy@ex.com' },
      });
      const randomUser = await prisma.user.create({
        data: { email: 'random@ex.com' },
      });

      const targetDate = new Date('2026-08-30T00:00:00.000Z');
      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate, endDate: targetDate },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });

      const current = new Date('2026-08-28T00:00:00.000Z');
      const reg = await LegacyRegistrationFixtureService.registerMeal(
        selfUser.id,
        targetDate,
        current,
      );

      // Self can serve
      expect(await RegistrationService.canServe(reg.id, selfUser.id)).toBe(
        true,
      );

      // Random cannot serve
      expect(await RegistrationService.canServe(reg.id, randomUser.id)).toBe(
        false,
      );

      const delegation = await LegacyRegistrationFixtureService.delegatePickup(
        reg.id,
        proxyUser.id,
        current,
      );
      expect(await RegistrationService.canServe(reg.id, proxyUser.id)).toBe(
        false,
      );

      await prisma.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'ACCEPTED' },
      });
      expect(await RegistrationService.canServe(reg.id, proxyUser.id)).toBe(
        true,
      );
    });

    it('Final serving and all-or-nothing multi-item serving', async () => {
      // Create serving record idempotently
      const selfUser = await prisma.user.create({
        data: { email: 'self2@ex.com' },
      });
      const targetDate = new Date('2026-08-30T00:00:00.000Z');
      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate, endDate: targetDate },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });

      const current = new Date('2026-08-28T00:00:00.000Z');
      const reg = await LegacyRegistrationFixtureService.registerMeal(
        selfUser.id,
        targetDate,
        current,
      );

      const serving = await LegacyRegistrationFixtureService.serveMeal(reg.id, selfUser.id);
      expect(serving).toBeDefined();

      // Cannot serve again (all-or-nothing)
      await expect(
        LegacyRegistrationFixtureService.serveMeal(reg.id, selfUser.id),
      ).rejects.toThrow('Already served');
    });

    it('Menu week/date rules. Canceled registration keeps immutable menu revision; active registration follows approved pre-cutoff revision', async () => {
      const user = await prisma.user.create({ data: { email: 'menu@ex.com' } });
      const targetDate = new Date('2026-08-30T00:00:00.000Z');
      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate, endDate: targetDate },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });

      const current = new Date('2026-08-28T00:00:00.000Z');
      const reg = await LegacyRegistrationFixtureService.registerMeal(
        user.id,
        targetDate,
        current,
      );

      const activeRevision = await RegistrationService.getMenuRevision(reg.id);
      expect(activeRevision).toBe('APPROVED_PRE_CUTOFF_REVISION_MOCK');

      await RegistrationService.cancelRegistration(reg.id, current);

      const canceledRevision = await RegistrationService.getMenuRevision(
        reg.id,
      );
      expect(canceledRevision).toBe('IMMUTABLE_REVISION_MOCK');
    });
  });
});
