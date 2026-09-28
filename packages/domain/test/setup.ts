import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import { beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// resolve properly even when run from apps/api
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.test') });

const baseDbUrl = process.env.DATABASE_URL;
const registeredClients = new Set<PrismaClient>();

export function registerTestPrismaClient(client: PrismaClient): void {
  registeredClients.add(client);
}

(
  globalThis as typeof globalThis & {
    __imealRegisterTestPrismaClient?: (client: PrismaClient) => void;
  }
).__imealRegisterTestPrismaClient = registerTestPrismaClient;

if (!baseDbUrl) {
  beforeEach(({ skip }) => {
    skip('DATABASE_URL is not configured; PostgreSQL tests are skipped');
  });
} else {
  const schemaName = `test_${randomUUID().replace(/-/g, '_')}`;
  const dbUrl = new URL(baseDbUrl);
  dbUrl.searchParams.set('schema', schemaName);
  const dynamicDbUrl = dbUrl.toString();

  // Set dynamically before any tests or src/db.ts imports happen
  process.env.DATABASE_URL = dynamicDbUrl;

  let pgClient: Client;

  const disconnectRegisteredClients = async () => {
    const clients = [...registeredClients];
    registeredClients.clear();
    const results = await Promise.allSettled(
      clients.map((client) => client.$disconnect()),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Failed to disconnect disposable PostgreSQL clients',
      );
    }
  };

  afterEach(async () => {
    await disconnectRegisteredClients();
  });

  beforeAll(async () => {
    pgClient = new Client({ connectionString: baseDbUrl });
    await pgClient.connect();
    await pgClient.query(`CREATE SCHEMA "${schemaName}"`);

    // Apply the production migrations to a disposable schema.
    execSync('npm exec -- prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: dynamicDbUrl },
      cwd: join(__dirname, '..'),
      stdio: 'ignore',
    });
  }, 120_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      await disconnectRegisteredClients();
    } catch (error) {
      failures.push(error);
    }
    try {
      // We need to disconnect the domain client before dropping its schema.
      const { prisma } = await import('../src/db');
      await prisma.$disconnect();
    } catch (error) {
      failures.push(error);
    }

    if (pgClient) {
      try {
        await pgClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (error) {
        failures.push(error);
      }
      try {
        await pgClient.end();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to clean up disposable PostgreSQL schema',
      );
    }
  }, 120_000);

  beforeEach(async () => {
    // Truncate tables between tests in this file
    const { prisma } = await import('../src/db');

    // Using Prisma Client to truncate tables
    const tableNames = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = '${schemaName}' AND tablename != '_prisma_migrations';`,
    );

    for (const { tablename } of tableNames) {
      if (tablename !== '_prisma_migrations') {
        await prisma.$executeRawUnsafe(
          `TRUNCATE TABLE "${schemaName}"."${tablename}" CASCADE;`,
        );
      }
    }
  }, 120_000);
}
