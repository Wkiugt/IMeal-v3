import { describe, expect, it } from 'vitest';
import type { LocalSeedConfig } from '../src/local-seed/types.js';
import {
  LocalSeedPlanError,
  assertLocalSeedPlan,
  buildLocalSeedPlan,
} from '../src/local-seed/plan.js';

const CONFIG: LocalSeedConfig = {
  baseEmail: 'seed@example.test',
  weekStart: '2026-09-28',
  serveDate: '2026-09-28',
  dryRun: true,
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/imeal?schema=test_seed',
  target: {
    nodeEnv: 'test',
    host: 'localhost',
    database: 'imeal',
    schema: 'test_seed',
  },
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

describe('local seed plan', () => {
  it('builds the complete deterministic row graph with exact counts', () => {
    const plan = buildLocalSeedPlan(CONFIG);

    expect(plan.users).toHaveLength(50);
    expect(plan.locations.map(({ shortCode }) => shortCode)).toEqual([
      'LOCAL-A',
      'LOCAL-B',
      'LOCAL-C',
      'LOCAL-D',
    ]);
    expect(plan.assignments).toHaveLength(50);
    expect(plan.allowlists).toHaveLength(50);
    expect(plan.userRoles).toHaveLength(56);
    expect(plan.registrations).toHaveLength(126);
    expect(plan.registrations.filter((row) => row.status === 'ACTIVE')).toHaveLength(60);
    expect(plan.registrations.filter((row) => row.status === 'SERVED')).toHaveLength(40);
    expect(plan.registrations.filter((row) => row.status === 'CANCELLED')).toHaveLength(16);
    expect(plan.registrations.filter((row) => row.status === 'NO_SHOW')).toHaveLength(10);
    expect(plan.servingVerifications).toHaveLength(40);
    expect(plan.pickupSessions).toHaveLength(40);
    expect(plan.servingConfirmRequests).toHaveLength(40);
    expect(plan.mealServings).toHaveLength(40);
    expect(plan.mealEvents).toHaveLength(40);
    expect(plan.penalties).toHaveLength(10);
    expect(plan.dailyMenus).toHaveLength(7);
    expect(plan.mealDays).toHaveLength(7);
    expect(plan.menuRevisions).toHaveLength(7);
    expect(plan.delegations.filter((row) => row.status === 'PENDING')).toHaveLength(4);
    expect(plan.delegations.filter((row) => row.status === 'ACCEPTED')).toHaveLength(4);
    expect(plan.delegations.filter((row) => row.status === 'COMPLETED')).toHaveLength(8);
    expect(plan.appSettings).toEqual([
      { key: 'isServingReady:2026-09-28', value: 'true', version: 1 },
    ]);
    expect(plan.counts).toEqual({
      users: 50,
      userRoles: 56,
      locations: 4,
      locationPolicies: 4,
      assignments: 50,
      allowlists: 50,
      weeklyMenus: 1,
      dailyMenus: 7,
      mealDays: 7,
      menuRevisions: 7,
      registrations: 126,
      pendingDelegations: 4,
      acceptedDelegations: 4,
      completedDelegations: 8,
      penalties: 10,
      servingVerifications: 40,
      pickupSessions: 40,
      servingConfirmRequests: 40,
      mealServings: 40,
      mealEvents: 40,
      appSettings: 1,
    });
  });

  it('keeps the role matrix explicit and limits registration owners to staff-capable users', () => {
    const plan = buildLocalSeedPlan(CONFIG);
    const rolesByUser = new Map<string, string[]>();
    for (const row of plan.userRoles) {
      const roles = rolesByUser.get(row.userId) ?? [];
      roles.push(row.roleName);
      rolesByUser.set(row.userId, roles);
    }

    const cohorts = { staff: 0, kitchen: 0, staffKitchen: 0, admin: 0, adminStaff: 0 };
    for (const roles of rolesByUser.values()) {
      const sorted = [...roles].sort().join(',');
      if (sorted === 'staff') cohorts.staff += 1;
      else if (sorted === 'kitchen') cohorts.kitchen += 1;
      else if (sorted === 'kitchen,staff') cohorts.staffKitchen += 1;
      else if (sorted === 'admin') cohorts.admin += 1;
      else if (sorted === 'admin,staff') cohorts.adminStaff += 1;
      else throw new Error(`Unexpected role cohort: ${sorted}`);
    }
    expect(cohorts).toEqual({ staff: 36, kitchen: 6, staffKitchen: 5, admin: 2, adminStaff: 1 });

    const kitchenOnlyIds = new Set(
      [...rolesByUser.entries()]
        .filter(([, roles]) => roles.length === 1 && roles[0] === 'kitchen')
        .map(([userId]) => userId),
    );
    expect(plan.registrations.some((row) => kitchenOnlyIds.has(row.userId))).toBe(false);
    expect(new Set(plan.assignments.map((row) => row.employeeCode)).size).toBe(50);
    expect(plan.users.map((row) => row.email)).toEqual([
      'seed@example.test',
      ...Array.from({ length: 49 }, (_, index) => `seed-${index + 1}@example.test`),
    ]);
  });

  it('uses deterministic menu, choice, snapshots, status relationships, and pickup arrays', () => {
    const first = buildLocalSeedPlan(CONFIG);
    const second = buildLocalSeedPlan(CONFIG);
    expect(second).toEqual(first);

    expect(first.dailyMenus.map((row) => dateKey(row.date))).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(first.mealDays.filter((row) => row.isServingReady)).toHaveLength(1);
    const readyMealDay = first.mealDays.find((row) => row.isServingReady)!;
    const readyDailyMenu = first.dailyMenus.find((row) => row.id === readyMealDay.dailyMenuId)!;
    expect(dateKey(readyDailyMenu.date)).toBe('2026-09-28');

    for (const [ordinal, row] of first.registrations.entries()) {
      expect(row.mealChoice).toBe(ordinal % 4 === 0 ? 'VEGETARIAN' : 'REGULAR');
      expect(row.serviceLocationId).toBeTruthy();
      expect(row.serviceLocationAssignmentId).toBeTruthy();
      expect(row.serviceLocationCode).toBeTruthy();
      expect(row.serviceLocationName).toBeTruthy();
      expect(row.serviceLocationAddress).toBeTruthy();
      expect(row.serviceLocationEffectiveFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(row.serviceLocationSnapshotAt).toEqual(new Date('2026-09-28T00:00:00.000Z'));
    }

    const servingByRegistration = new Map(
      first.mealServings.map((row) => [row.registrationId, row]),
    );
    const penaltyByUserReason = new Map(
      first.penalties.map((row) => [`${row.userId}:${row.reason}`, row]),
    );
    for (const registration of first.registrations) {
      const serving = servingByRegistration.get(registration.id);
      if (registration.status === 'SERVED') expect(serving).toBeTruthy();
      else expect(serving).toBeUndefined();
      if (registration.status === 'NO_SHOW') {
        const penalty = [...penaltyByUserReason.values()].find((row) =>
          row.reason.endsWith(`_${registration.id}`),
        );
        expect(penalty).toMatchObject({ userId: registration.userId, amount: 50000, status: 'PENDING' });
      }
    }

    for (const session of first.pickupSessions) {
      expect(session.registrationIds).toEqual([...session.registrationIds].sort());
      expect(new Set(session.registrationIds).size).toBe(session.registrationIds.length);
      expect(session.intentRegistrationIds).toEqual([...session.intentRegistrationIds].sort());
      expect(new Set(session.intentRegistrationIds).size).toBe(session.intentRegistrationIds.length);
    }
  });

  it('creates complete self and proxy serving histories', () => {
    const plan = buildLocalSeedPlan(CONFIG);
    expect(plan.mealServings.filter((row) => row.receiverType === 'SELF')).toHaveLength(32);
    expect(plan.mealServings.filter((row) => row.receiverType === 'PROXY')).toHaveLength(8);

    const delegationsById = new Map(plan.delegations.map((row) => [row.id, row]));
    const servingIds = new Set(plan.mealServings.map((row) => row.id));
    for (const serving of plan.mealServings) {
      expect(serving.kitchenPermissionContext).toBe('kitchen.serve');
      expect(serving.kitchenUserId).toBeTruthy();
      expect(serving.servingVerificationId).toBeTruthy();
      expect(serving.pickupSessionId).toBeTruthy();
      expect(serving.requestId).toBeTruthy();
      expect(serving.intentHash).toBeTruthy();
      expect(plan.mealEvents.filter((row) => row.mealServingId === serving.id)).toHaveLength(1);
      if (serving.receiverType === 'SELF') {
        expect(serving.ownerUserId).toBe(serving.presenterUserId);
        expect(serving.delegationId).toBeNull();
      } else {
        expect(serving.ownerUserId).not.toBe(serving.presenterUserId);
        expect(serving.delegationId).toBeTruthy();
        expect(delegationsById.get(serving.delegationId!)?.status).toBe('COMPLETED');
      }
    }
    expect(plan.servingConfirmRequests.every((row) => row.status === 'SUCCESS')).toBe(true);
    expect(plan.servingConfirmRequests.every((row) => row.resultServingIds.every((id) => servingIds.has(id)))).toBe(true);
  });

  it('validates the plan and rejects bad graph invariants with stable context', () => {
    const plan = buildLocalSeedPlan(CONFIG);
    expect(() => assertLocalSeedPlan(plan)).not.toThrow();

    const duplicate = {
      ...plan,
      users: [...plan.users, plan.users[0]],
    };
    expect(() => assertLocalSeedPlan(duplicate)).toThrow(LocalSeedPlanError);
    expect(() => assertLocalSeedPlan(duplicate)).toThrow(/users/i);

    const badReference = {
      ...plan,
      registrations: plan.registrations.map((row, index) =>
        index === 0 ? { ...row, userId: 'missing-user' } : row,
      ),
    };
    expect(() => assertLocalSeedPlan(badReference)).toThrow(/registrations/i);

    const unsortedRegistrationIds = [
      plan.registrations[0].id,
      plan.registrations[1].id,
    ].sort().reverse();
    const badPickupOrder = {
      ...plan,
      pickupSessions: plan.pickupSessions.map((row, index) =>
        index === 0 ? { ...row, registrationIds: unsortedRegistrationIds } : row,
      ),
    };
    expect(() => assertLocalSeedPlan(badPickupOrder)).toThrow(/pickupSessions/i);
  });
});
