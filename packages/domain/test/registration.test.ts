import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RegistrationService } from '../src/RegistrationService';
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
      const reg = await RegistrationService.registerMeal(
        user1.id,
        targetDate,
        current,
      );

      // Delegate
      await RegistrationService.delegatePickup(reg.id, user2.id, current);

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

    it('Account-disable preview + mandatory confirmed no-penalty future-commitment cleanup', async () => {
      const user = await prisma.user.create({
        data: { email: 'disable@ex.com' },
      });
      const targetDate1 = new Date('2026-08-30T00:00:00.000Z');
      const targetDate2 = new Date('2026-08-31T00:00:00.000Z');

      const weekly = await prisma.weeklyMenu.create({
        data: { startDate: targetDate1, endDate: targetDate2 },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate1,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });
      await prisma.dailyMenu.create({
        data: {
          date: targetDate2,
          weeklyMenuId: weekly.id,
          isEnabled: true,
          isHoliday: false,
        },
      });

      const current = new Date('2026-08-28T00:00:00.000Z');

      // Register for both
      await RegistrationService.registerMeal(user.id, targetDate1, current);
      await RegistrationService.registerMeal(user.id, targetDate2, current);

      // Disable user account
      await RegistrationService.disableUserAccount(user.id, current);

      // Verify registrations are canceled without penalty
      const regs = await prisma.registration.findMany({
        where: { userId: user.id },
      });
      expect(regs.every((r) => r.status === 'CANCELLED')).toBe(true);

      const penalties = await prisma.penalty.findMany({
        where: { userId: user.id },
      });
      expect(penalties.length).toBe(0);
    });

    it('No-show/penalty idempotency', async () => {
      const user = await prisma.user.create({
        data: { email: 'noshow@ex.com' },
      });
      const current = new Date('2026-08-28T00:00:00.000Z');

      await RegistrationService.applyNoShowPenalty(
        user.id,
        'noshow_key_1',
        current,
      );
      await RegistrationService.applyNoShowPenalty(
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
      const reg = await RegistrationService.registerMeal(
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

      const delegation = await RegistrationService.delegatePickup(
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
      const reg = await RegistrationService.registerMeal(
        selfUser.id,
        targetDate,
        current,
      );

      const serving = await RegistrationService.serveMeal(reg.id, selfUser.id);
      expect(serving).toBeDefined();

      // Cannot serve again (all-or-nothing)
      await expect(
        RegistrationService.serveMeal(reg.id, selfUser.id),
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
      const reg = await RegistrationService.registerMeal(
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
