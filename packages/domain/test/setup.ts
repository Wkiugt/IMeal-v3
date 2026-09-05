import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import { beforeEach, beforeAll, afterAll } from 'vitest';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// resolve properly even when run from apps/api
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.test') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment or .env.test');
}

const schemaName = `test_${randomUUID().replace(/-/g, '_')}`;
const baseDbUrl = process.env.DATABASE_URL;
const dbUrl = new URL(baseDbUrl);
dbUrl.searchParams.set('schema', schemaName);
const dynamicDbUrl = dbUrl.toString();

// Set dynamically before any tests or src/db.ts imports happen
process.env.DATABASE_URL = dynamicDbUrl;

let pgClient: Client;

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
});

afterAll(async () => {
  // We need to disconnect the Prisma client first so it doesn't hold locks
  const { prisma } = await import('../src/db');
  await prisma.$disconnect();

  if (pgClient) {
    await pgClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pgClient.end();
  }
});

beforeEach(async () => {
  // Truncate tables between tests in this file
  const { prisma } = await import('../src/db');

  // Using Prisma Client to truncate tables
  const tableNames = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = '${schemaName}' AND tablename != '_prisma_migrations';`,
  );

  for (const { tablename } of tableNames) {
    if (tablename !== '_prisma_migrations') {
      try {
        await prisma.$executeRawUnsafe(
          `TRUNCATE TABLE "${schemaName}"."${tablename}" CASCADE;`,
        );
      } catch (error) {
        console.error(`Failed to truncate ${tablename}:`, error);
      }
    }
  }
});
