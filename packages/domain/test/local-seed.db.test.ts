import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../src/db.js';
import { assertLocalSeedPlan, buildLocalSeedPlan } from '../src/local-seed/plan.js';
import type { LocalSeedConfig, LocalSeedPlan } from '../src/local-seed/types.js';
import { writeLocalSeed } from '../src/local-seed/writer.js';

const CONFIG: LocalSeedConfig = {
  baseEmail: 'seed@example.test',
  weekStart: '2026-09-28',
  serveDate: '2026-09-28',
  dryRun: false,
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/imeal?schema=test_seed',
  target: {
    nodeEnv: 'test',
    host: 'localhost',
    database: 'imeal',
    schema: 'test_seed',
  },
};

const CANONICAL_ROLES = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'staff' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'kitchen' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'admin' },
] as const;

beforeEach(async () => {
  // The shared disposable-schema setup truncates canonical migration rows too.
  // Restore only those lookup rows; the writer must never create role definitions.
  await prisma.role.createMany({ data: [...CANONICAL_ROLES] });
});

function buildPlan(): LocalSeedPlan {
  const plan = buildLocalSeedPlan(CONFIG);
  assertLocalSeedPlan(plan);
  return plan;
}

async function seedIds() {
  const [users, locations, registrations, servings] = await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.location.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.registration.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.mealServing.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
  ]);
  return {
    users: users.map(({ id }) => id),
    locations: locations.map(({ id }) => id),
    registrations: registrations.map(({ id }) => id),
    servings: servings.map(({ id }) => id),
  };
}

describe('local seed transactional writer', () => {
  it('persists the complete deterministic graph with required statuses and relations', async () => {
    const plan = buildPlan();

    const result = await writeLocalSeed(prisma, plan);

    expect(result.created).toBeGreaterThan(0);
    expect(await prisma.user.count({ where: { email: { endsWith: '@example.test' } } })).toBe(50);
    expect(await prisma.location.count()).toBe(4);
    expect(await prisma.employeeLocationAssignment.count()).toBe(50);
    expect(await prisma.registration.count()).toBe(126);
    expect(await prisma.mealServing.count()).toBe(40);
    expect(await prisma.penalty.count()).toBe(10);
    expect(
      await prisma.registration.count({
        where: { status: 'SERVED', mealServing: { isNot: null } },
      }),
    ).toBe(40);
    expect(await prisma.registration.count({ where: { status: 'NO_SHOW' } })).toBe(10);
    expect(
      await prisma.penalty.count({
        where: {
          amount: 50000,
          status: 'PENDING',
          reason: { startsWith: 'NO_SHOW_PENALTY_' },
        },
      }),
    ).toBe(10);
  });

  it('reruns without creating rows and keeps deterministic IDs stable', async () => {
    const plan = buildPlan();

    await writeLocalSeed(prisma, plan);
    const firstIds = await seedIds();
    const firstCounts = {
      users: await prisma.user.count(),
      locations: await prisma.location.count(),
      registrations: await prisma.registration.count(),
      servings: await prisma.mealServing.count(),
    };

    const secondResult = await writeLocalSeed(prisma, plan);
    const secondIds = await seedIds();

    expect(secondResult.created).toBe(0);
    expect(secondIds).toEqual(firstIds);
    expect({
      users: await prisma.user.count(),
      locations: await prisma.location.count(),
      registrations: await prisma.registration.count(),
      servings: await prisma.mealServing.count(),
    }).toEqual(firstCounts);
  });

  it('preserves unrelated rows across a seed rerun', async () => {
    const plan = buildPlan();
    await writeLocalSeed(prisma, plan);

    const unrelatedUser = await prisma.user.create({
      data: {
        id: 'unrelated-user-id',
        email: 'unrelated@example.net',
        name: 'Unrelated User',
        isActive: false,
        notificationLocale: 'EN',
        remindersEnabled: false,
      },
    });
    const unrelatedLocation = await prisma.location.create({
      data: {
        id: 'unrelated-location-id',
        shortCode: 'EXT-KEEP',
        displayName: 'External Location',
        servingPointName: 'External Counter',
        address: 'External address',
        building: 'External building',
        floor: '1',
        roomOrCounter: 'External counter',
        localContact: 'external@example.test',
        timeZone: 'Asia/Ho_Chi_Minh',
        isActive: false,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        approvedScannerDeviceIds: [],
      },
    });

    await writeLocalSeed(prisma, plan);

    expect(await prisma.user.findUnique({ where: { id: unrelatedUser.id } })).toEqual(unrelatedUser);
    expect(await prisma.location.findUnique({ where: { id: unrelatedLocation.id } })).toEqual(unrelatedLocation);
  });

  it('rolls back all seed writes when a later serving foreign key fails', async () => {
    const plan = buildPlan();
    const invalidPlan: LocalSeedPlan = {
      ...plan,
      mealServings: plan.mealServings.map((serving, index) =>
        index === 0 ? { ...serving, registrationId: 'missing-registration-id' } : serving,
      ),
    };

    const before = {
      users: await prisma.user.count(),
      locations: await prisma.location.count(),
      registrations: await prisma.registration.count(),
    };

    await expect(writeLocalSeed(prisma, invalidPlan)).rejects.toMatchObject({ code: 'P2003' });

    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.location.count()).toBe(before.locations);
    expect(await prisma.registration.count()).toBe(before.registrations);
  });
});
