import { describe, it, expect } from 'vitest';
import { createPrismaClient } from '../src/prisma.js';
import { prisma } from '../src/db.js';
import { registerTestPrismaClient } from './setup.js';
import { randomUUID } from 'crypto';
describe('Database Connection', () => {
  it('should be able to write and read from the database', async () => {
    const testEmail = `test_${randomUUID()}@example.com`;

    // Write
    const createdUser = await prisma.user.create({
      data: {
        email: testEmail,
        name: 'Health Check User',
      },
    });

    expect(createdUser).toHaveProperty('id');
    expect(createdUser.email).toBe(testEmail);

    // Read
    const retrievedUser = await prisma.user.findUnique({
      where: { id: createdUser.id },
    });

    expect(retrievedUser).toBeDefined();
    expect(retrievedUser?.email).toBe(testEmail);
  });

  it('keeps savepoint and outer rollback writes scoped to the transaction', async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    databaseUrl.searchParams.set('pgbouncer', 'true');
    const hookClient = createPrismaClient(databaseUrl.toString());
    registerTestPrismaClient(hookClient);
    const savepointEmail = `savepoint_${randomUUID()}@example.com`;
    const rolledBackEmail = `rolled_back_${randomUUID()}@example.com`;
    const outerRollbackEmail = `outer_rollback_${randomUUID()}@example.com`;

    await expect(
      hookClient.$transaction(async (tx) => {
        await tx.user.create({ data: { email: savepointEmail } });
        await tx.$executeRawUnsafe('SAVEPOINT hook_regression_savepoint');
        await tx.user.create({ data: { email: rolledBackEmail } });
        await tx.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT hook_regression_savepoint',
        );

        expect(
          await tx.user.count({
            where: { email: rolledBackEmail },
          }),
        ).toBe(0);
        expect(
          await tx.user.count({
            where: { email: savepointEmail },
          }),
        ).toBe(1);

        await tx.user.create({ data: { email: outerRollbackEmail } });
        throw new Error('expected outer rollback');
      }),
    ).rejects.toThrow('expected outer rollback');

    await expect(
      hookClient.user.count({
        where: {
          email: {
            in: [savepointEmail, rolledBackEmail, outerRollbackEmail],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('recovers after a serializable write-skew commit conflict', async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    databaseUrl.searchParams.set('pgbouncer', 'true');
    const schemaName = databaseUrl.searchParams.get('schema') ?? 'public';
    const firstClient = createPrismaClient(databaseUrl.toString());
    const secondClient = createPrismaClient(databaseUrl.toString());
    registerTestPrismaClient(firstClient);
    registerTestPrismaClient(secondClient);
    const firstEmail = `serializable_first_${randomUUID()}@example.com`;
    const secondEmail = `serializable_second_${randomUUID()}@example.com`;
    const firstUser = await firstClient.user.create({
      data: { email: firstEmail, name: 'initial-first' },
    });
    const secondUser = await firstClient.user.create({
      data: { email: secondEmail, name: 'initial-second' },
    });
    const userIds = [firstUser.id, secondUser.id];

    let releaseFirstRead!: () => void;
    let releaseSecondRead!: () => void;
    let releaseFirstUpdated!: () => void;
    let releaseSecondUpdated!: () => void;
    let releaseFirstCommitted!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const secondRead = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    const firstUpdated = new Promise<void>((resolve) => {
      releaseFirstUpdated = resolve;
    });
    const secondUpdated = new Promise<void>((resolve) => {
      releaseSecondUpdated = resolve;
    });
    const firstCommitted = new Promise<void>((resolve) => {
      releaseFirstCommitted = resolve;
    });
    let firstCallbackError: unknown;
    let secondCallbackError: unknown;
    let secondCallbackFinished = false;

    const first = firstClient
      .$transaction(
        async (tx) => {
          try {
            const rows = await tx.user.findMany({
              where: { id: { in: userIds } },
            });
            expect(rows).toHaveLength(2);
            releaseFirstRead();
            await secondRead;
            await tx.user.update({
              where: { id: firstUser.id },
              data: { name: 'first-committed' },
            });
            releaseFirstUpdated();
            await secondUpdated;
          } catch (error) {
            firstCallbackError = error;
            releaseFirstRead();
            releaseFirstUpdated();
            throw error;
          }
        },
        { isolationLevel: 'Serializable' },
      )
      .then(
        () => {
          releaseFirstCommitted();
          return { ok: true as const };
        },
        (error: unknown) => {
          releaseFirstCommitted();
          releaseSecondRead();
          releaseSecondUpdated();
          return { ok: false as const, error };
        },
      );

    await firstRead;
    const second = secondClient
      .$transaction(
        async (tx) => {
          try {
            const rows = await tx.user.findMany({
              where: { id: { in: userIds } },
            });
            expect(rows).toHaveLength(2);
            releaseSecondRead();
            await firstUpdated;
            await tx.user.update({
              where: { id: secondUser.id },
              data: { name: 'second-rolled-back' },
            });
            releaseSecondUpdated();
            await firstCommitted;
            secondCallbackFinished = true;
          } catch (error) {
            secondCallbackError = error;
            releaseSecondRead();
            releaseSecondUpdated();
            throw error;
          }
        },
        { isolationLevel: 'Serializable' },
      )
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    const [firstResult, secondResult] = await Promise.all([first, second]);
    try {
      expect(firstResult.ok).toBe(true);
      expect(firstCallbackError).toBeUndefined();
      expect(secondResult.ok).toBe(false);
      expect(secondCallbackError).toBeUndefined();
      expect(secondCallbackFinished).toBe(true);
      if (!secondResult.ok) {
        const cause =
          typeof secondResult.error === 'object' &&
          secondResult.error !== null &&
          'cause' in secondResult.error
            ? secondResult.error.cause
            : undefined;
        expect(cause).toMatchObject({
          originalCode: '40001',
          kind: 'TransactionWriteConflict',
        });
      }

      await expect(
        firstClient.user.findMany({
          where: { id: { in: userIds } },
          orderBy: { email: 'asc' },
        }),
      ).resolves.toEqual([
        expect.objectContaining({ id: firstUser.id, name: 'first-committed' }),
        expect.objectContaining({ id: secondUser.id, name: 'initial-second' }),
      ]);

      await expect(
        secondClient.$queryRaw<
          Array<{
            current_schema: string;
            first_name: string;
            second_name: string;
          }>
        >`
          SELECT
            current_schema() AS current_schema,
            (SELECT name FROM "users" WHERE id = ${firstUser.id}) AS first_name,
            (SELECT name FROM "users" WHERE id = ${secondUser.id}) AS second_name
        `,
      ).resolves.toEqual([
        {
          current_schema: schemaName,
          first_name: 'first-committed',
          second_name: 'initial-second',
        },
      ]);
    } finally {
      await firstClient.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
