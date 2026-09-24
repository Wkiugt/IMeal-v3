import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RegistrationService } from '../src/RegistrationService';
import { prisma } from '../src/db';
import { randomUUID } from 'node:crypto';


describe('Domain Tests: Concurrency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('register same user/date: should only create one registration and gracefully upsert', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc1@test.com' },
    });
    const menuDate = new Date('2026-09-05T12:00:00.000Z');
    const currentTime = new Date('2026-09-02T12:00:00.000Z');

    await prisma.dailyMenu.create({
      data: {
        date: menuDate,
        isEnabled: true,
        isHoliday: false,
        weeklyMenu: {
          create: {
            startDate: new Date('2026-09-01T00:00:00.000Z'),
            endDate: new Date('2026-09-07T23:59:59.000Z'),
          },
        },
      },
    });

    // Run concurrently
    const results = await Promise.allSettled([
      RegistrationService.registerMeal(user.id, menuDate, currentTime),
      RegistrationService.registerMeal(user.id, menuDate, currentTime),
      RegistrationService.registerMeal(user.id, menuDate, currentTime),
    ]);

    // All should technically succeed because of `upsert`!
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBe(3);

    const count = await prisma.registration.count({
      where: { userId: user.id, mealDate: menuDate },
    });
    expect(count).toBe(1); // Only 1 created due to unique constraint + upsert
  });

  it('two scanners same registration: only one succeeds, the other throws', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc2@test.com' },
    });
    const menuDate = new Date('2026-09-06T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    // Simulate two scanners sending serveMeal at the exact same time
    const results = await Promise.allSettled([
      RegistrationService.serveMeal(reg.id, user.id),
      RegistrationService.serveMeal(reg.id, user.id),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toContain(
      'Already served',
    );

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);

    const dbReg = await prisma.registration.findUnique({
      where: { id: reg.id },
    });
    expect(dbReg?.status).toBe('SERVED');
  });

  it('owner vs delegate simultaneous serving: only one succeeds', async () => {
    const owner = await prisma.user.create({
      data: { email: 'owner_conc3@test.com' },
    });
    const delegate = await prisma.user.create({
      data: { email: 'delegate_conc3@test.com' },
    });
    const menuDate = new Date('2026-09-07T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    await prisma.pickupDelegation.create({
      data: {
        registrationId: reg.id,
        delegateUserId: delegate.id,
        status: 'PENDING',
      },
    });

    const results = await Promise.allSettled([
      RegistrationService.serveMeal(reg.id, owner.id),
      RegistrationService.serveMeal(reg.id, delegate.id),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);
  });

  it('revoke vs serve race: if canceled, serve fails; if served, cancel fails', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc4@test.com' },
    });
    const menuDate = new Date('2026-09-08T12:00:00.000Z');
    const currentTime = new Date('2026-09-07T10:00:00.000Z'); // before cutoff 14:00

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    const results = await Promise.allSettled([
      RegistrationService.serveMeal(reg.id, user.id),
      RegistrationService.cancelRegistration(reg.id, currentTime),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Due to transaction isolation, exactly one should succeed and one should fail
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const dbReg = await prisma.registration.findUnique({
      where: { id: reg.id },
    });
    // It should be either SERVED or CANCELED, not both.
    expect(['SERVED', 'CANCELLED']).toContain(dbReg?.status);
  });

  it('retry idempotency key: same caller and key should be idempotent', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc5@test.com' },
    });
    const menuDate = new Date('2026-09-09T12:00:00.000Z');

    const reg = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: menuDate,
        status: 'ACTIVE',
      },
    });

    const idempotencyKey = 'serve_req_123';

    // Calling serveMeal multiple times with the same idempotencyKey
    const results = await Promise.allSettled([
      RegistrationService.serveMeal(reg.id, user.id, idempotencyKey),
      RegistrationService.serveMeal(reg.id, user.id, idempotencyKey),
      RegistrationService.serveMeal(reg.id, user.id, idempotencyKey),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Only one should succeed because they race to create `ServingConfirmRequest`.
    // The others will throw Prisma unique constraint error on `ServingConfirmRequest`
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(failures.length).toBeLessThanOrEqual(2);

    // Call sequentially again with the same idempotency key - it should return the existing serving without error
    const retryResult = await RegistrationService.serveMeal(
      reg.id,
      user.id,
      idempotencyKey,
    );
    expect(retryResult).toBeDefined();

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: reg.id },
    });
    expect(servingCount).toBe(1);
  });

  it('multi-item batch with stale item: all-or-nothing', async () => {
    const user = await prisma.user.create({
      data: { email: 'user_conc6@test.com' },
    });
    const menuDate1 = new Date('2026-09-10T12:00:00.000Z');
    const menuDate2 = new Date('2026-09-11T12:00:00.000Z');
    const menuDate3 = new Date('2026-09-12T12:00:00.000Z');

    const reg1 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate1, status: 'ACTIVE' },
    });
    const reg2 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate2, status: 'ACTIVE' },
    });
    const reg3 = await prisma.registration.create({
      data: { userId: user.id, mealDate: menuDate3, status: 'ACTIVE' },
    });

    // Make reg2 stale by serving it beforehand
    await RegistrationService.serveMeal(reg2.id, user.id);

    // Now attempt a batch serve for all 3
    const batchPromise = RegistrationService.batchServeMeals(
      [reg1.id, reg2.id, reg3.id],
      user.id,
      'batch_123',
    );

    await expect(batchPromise).rejects.toThrow(`Already served ${reg2.id}`);

    // reg1 and reg3 should REMAIN REGISTERED (transaction rolled back)
    const dbReg1 = await prisma.registration.findUnique({
      where: { id: reg1.id },
    });
    const dbReg3 = await prisma.registration.findUnique({
      where: { id: reg3.id },
    });

    expect(dbReg1?.status).toBe('ACTIVE');
    expect(dbReg3?.status).toBe('ACTIVE');

    const servingCount = await prisma.mealServing.count({
      where: { registrationId: { in: [reg1.id, reg2.id, reg3.id] } },
    });
    expect(servingCount).toBe(1); // Only the manual serve of reg2
  });
  it('serializes accepted delegation revoke/serve and commits one winner', async () => {
    const owner = await prisma.user.create({
      data: { email: `owner-${randomUUID()}@example.test`, name: 'Owner' },
    });
    const delegate = await prisma.user.create({
      data: {
        email: `delegate-${randomUUID()}@example.test`,
        name: 'Delegate',
      },
    });
    const registration = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
    const delegation = await prisma.pickupDelegation.create({
      data: {
        registrationId: registration.id,
        delegateUserId: delegate.id,
        status: 'ACCEPTED',
      },
    });

    const serve = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
      const current = await tx.pickupDelegation.findUnique({
        where: { id: delegation.id },
      });
      if (current?.status !== 'ACCEPTED') return 'LOST';
      await tx.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'COMPLETED' },
      });
      await tx.mealServing.create({
        data: {
          registrationId: registration.id,
          ownerUserId: owner.id,
          receiverType: 'PROXY',
          delegationId: delegation.id,
        },
      });
      await tx.registration.update({
        where: { id: registration.id },
        data: { status: 'SERVED' },
      });
      return 'SERVED';
    });

    const revoke = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
      const current = await tx.pickupDelegation.findUnique({
        where: { id: delegation.id },
      });
      if (current?.status !== 'ACCEPTED') return 'LOST';
      await tx.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'REVOKED' },
      });
      return 'REVOKED';
    });

    const results = await Promise.all([serve, revoke]);
    expect(results.filter((result) => result !== 'LOST')).toHaveLength(1);

    const finalDelegation = await prisma.pickupDelegation.findUniqueOrThrow({
      where: { id: delegation.id },
    });
    const finalRegistration = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    const serving = await prisma.mealServing.findUnique({
      where: { registrationId: registration.id },
    });

    if (finalDelegation.status === 'COMPLETED') {
      expect(finalRegistration.status).toBe('SERVED');
      expect(serving).toMatchObject({ delegationId: delegation.id });
    } else {
      expect(finalDelegation.status).toBe('REVOKED');
      expect(finalRegistration.status).toBe('ACTIVE');
      expect(serving).toBeNull();
    }
  });

  it('rolls back every serving when a later locked registration is stale', async () => {
    const owner = await prisma.user.create({
      data: { email: `batch-${randomUUID()}@example.test` },
    });
    const first = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
    const stale = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'CANCELLED',
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const registrations = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`
          SELECT id, status
          FROM registrations
          WHERE id IN (${first.id}, ${stale.id})
          ORDER BY id
          FOR UPDATE
        `;
        for (const registration of registrations) {
          if (registration.status !== 'ACTIVE') {
            throw new Error('stale registration');
          }
        }
        await tx.mealServing.create({
          data: { registrationId: first.id, ownerUserId: owner.id },
        });
        await tx.registration.update({
          where: { id: first.id },
          data: { status: 'SERVED' },
        });
      }),
    ).rejects.toThrow('stale registration');

    expect(
      await prisma.mealServing.count({
        where: { registrationId: { in: [first.id, stale.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: first.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
  });
});
