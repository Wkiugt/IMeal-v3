import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client as PgClient } from 'pg';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { WorkerPublishInput } from '../src/worker-notification-publisher.js';

type WorkerResult = {
  processedCount: number;
};

type WorkerService = {
  processNoShows(
    targetDate: string,
    options: { currentTime: Date },
  ): Promise<WorkerResult>;
};

type WorkerServiceConstructor = new (
  notificationPublisher?: unknown,
) => WorkerService;

type TestPublisher = {
  publish: (
    tx: Prisma.TransactionClient,
    input: WorkerPublishInput,
  ) => Promise<unknown>;
};

const TARGET_DATE = new Date('2026-09-03T00:00:00.000Z');
const PROCESSING_TIME = new Date('2026-09-03T06:45:00.000Z');
const TARGET_DATE_TEXT = '2026-09-03';
const databaseUrl = process.env.DATABASE_URL;
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(testDirectory, '../../..');
const schemaName = `test_worker_${randomUUID().replace(/-/g, '_')}`;

const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe('PostgreSQL no-show worker', () => {
  let prisma: PrismaClient;
  let WorkerService: WorkerServiceConstructor;
  let WorkerNotificationPublisher: new () => TestPublisher;
  let pgClient: PgClient;
  const workerPrismaClients: PrismaClient[] = [];

  beforeAll(async () => {
    const parsedDatabaseUrl = new URL(databaseUrl as string);
    parsedDatabaseUrl.searchParams.set('schema', schemaName);
    process.env.DATABASE_URL = parsedDatabaseUrl.toString();

    const [{ Client }, prismaModule, workerModule, publisherModule] =
      await Promise.all([
        import('pg'),
        import('@prisma/client'),
        import('../src/no-show-worker.service.js'),
        import('../src/worker-notification-publisher.js'),
      ]);
    const workerServiceConstructor =
      workerModule.NoShowWorkerService as unknown as WorkerServiceConstructor;
    WorkerService = workerServiceConstructor;
    WorkerNotificationPublisher = publisherModule.WorkerNotificationPublisher;

    pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();
    await pgClient.query(`CREATE SCHEMA "${schemaName}"`);
    execSync('yarn workspace @imeal/core exec prisma migrate deploy', {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: parsedDatabaseUrl.toString() },
      stdio: 'ignore',
    });

    prisma = new prismaModule.PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await Promise.all([
      ...workerPrismaClients.map((client) => client.$disconnect()),
      prisma?.$disconnect(),
    ]);
    if (pgClient) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await pgClient.end();
    }
  });

  function makeWorker(notificationPublisher?: unknown): WorkerService {
    const worker = new WorkerService(notificationPublisher);
    const workerWithPrisma = worker as unknown as { prisma: PrismaClient };
    workerPrismaClients.push(workerWithPrisma.prisma);
    return worker;
  }

  async function createRegistration(id: string, email: string) {
    const user = await prisma.user.create({
      data: { id: randomUUID(), email, isActive: true },
    });
    const registration = await prisma.registration.create({
      data: {
        id,
        userId: user.id,
        mealDate: TARGET_DATE,
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
      },
    });
    return { user, registration };
  }

  it('enforces one registration penalty and idempotent committed retry', async () => {
    const { user, registration } = await createRegistration(
      randomUUID(),
      `no_show_unique_${randomUUID()}@example.com`,
    );
    const worker = makeWorker(new WorkerNotificationPublisher());

    const first = await worker.processNoShows(TARGET_DATE_TEXT, {
      currentTime: PROCESSING_TIME,
    });
    const retry = await worker.processNoShows(TARGET_DATE_TEXT, {
      currentTime: PROCESSING_TIME,
    });

    expect(first.processedCount).toBe(1);
    expect(retry.processedCount).toBe(0);
    expect(
      await prisma.penalty.count({ where: { registrationId: registration.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'NO_SHOW_PROCESSED',
          details: { contains: registration.id },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `no-show-penalty:${user.id}:${registration.id}` },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { dedupeKey: `kitchen:no-show:${registration.id}` },
      }),
    ).toBe(1);

    await expect(
      prisma.penalty.create({
        data: {
          id: randomUUID(),
          registrationId: registration.id,
          userId: user.id,
          mealDate: TARGET_DATE,
          amount: 50000,
          reason: 'NO_SHOW',
          status: 'PENDING',
        },
      }),
    ).rejects.toThrow();
  });

  it('serializes concurrent worker runs to one committed no-show', async () => {
    const { registration } = await createRegistration(
      randomUUID(),
      `no_show_race_${randomUUID()}@example.com`,
    );
    const firstWorker = makeWorker(new WorkerNotificationPublisher());
    const secondWorker = makeWorker(new WorkerNotificationPublisher());

    const results = await Promise.all([
      firstWorker.processNoShows(TARGET_DATE_TEXT, {
        currentTime: PROCESSING_TIME,
      }),
      secondWorker.processNoShows(TARGET_DATE_TEXT, {
        currentTime: PROCESSING_TIME,
      }),
    ]);

    expect(results.map((result) => result.processedCount).sort()).toEqual([
      0,
      1,
    ]);
    expect(
      await prisma.registration.findUnique({ where: { id: registration.id } }),
    ).toMatchObject({ status: 'NO_SHOW' });
    expect(
      await prisma.penalty.count({ where: { registrationId: registration.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'NO_SHOW_PROCESSED',
          details: { contains: registration.id },
        },
      }),
    ).toBe(1);
  });

  it('rolls back one registration while another registration commits independently', async () => {
    const failing = await createRegistration(
      '00000000-0000-0000-0000-000000000001',
      `no_show_rollback_fail_${randomUUID()}@example.com`,
    );
    const succeeding = await createRegistration(
      '00000000-0000-0000-0000-000000000002',
      `no_show_rollback_success_${randomUUID()}@example.com`,
    );
    const realPublisher = new WorkerNotificationPublisher();
    const failingPublisher: TestPublisher = {
      publish: async (tx, input) => {
        if (input.userId === failing.user.id) {
          throw new Error('injected notification failure');
        }
        return realPublisher.publish(tx, input);
      },
    };
    const worker = makeWorker(failingPublisher);

    await expect(
      worker.processNoShows(TARGET_DATE_TEXT, {
        currentTime: PROCESSING_TIME,
      }),
    ).rejects.toThrow('injected notification failure');

    expect(
      await prisma.registration.findUnique({
        where: { id: failing.registration.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(
      await prisma.registration.findUnique({
        where: { id: succeeding.registration.id },
      }),
    ).toMatchObject({ status: 'NO_SHOW' });
    expect(
      await prisma.penalty.count({
        where: {
          registrationId: {
            in: [failing.registration.id, succeeding.registration.id],
          },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'NO_SHOW_PROCESSED',
          details: { contains: failing.registration.id },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: failing.user.id } }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: {
          aggregateId: failing.registration.id,
          eventType: 'NO_SHOW_RECONCILED',
        },
      }),
    ).toBe(0);
  });
});
