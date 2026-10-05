import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from './../src/app.module.js';
describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let evidenceDirectory: string;
  const previousEnvironment = {
    RELEASE_VERSION: process.env.RELEASE_VERSION,
    MIGRATION_EVIDENCE_PATH: process.env.MIGRATION_EVIDENCE_PATH,
    MIGRATION_TARGET_IDENTITY: process.env.MIGRATION_TARGET_IDENTITY,
  };

  beforeAll(async () => {
    const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get(
      'schema',
    );
    if (!schema) {
      throw new Error('health e2e requires the disposable migration schema');
    }
    evidenceDirectory = mkdtempSync(join(tmpdir(), 'imeal-health-e2e-'));
    const evidencePath = join(evidenceDirectory, 'migration.json');
    writeFileSync(
      evidencePath,
      JSON.stringify({
        release: 'health-e2e',
        migration: 'prisma7-health-e2e',
        targetSchema: schema,
        approvalId: 'health-e2e-disposable',
        completedAt: '2026-10-04T00:00:00.000Z',
      }),
    );
    process.env.RELEASE_VERSION = 'health-e2e';
    process.env.MIGRATION_EVIDENCE_PATH = evidencePath;
    process.env.MIGRATION_TARGET_IDENTITY = schema;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (evidenceDirectory) {
      rmSync(evidenceDirectory, { recursive: true, force: true });
    }
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('/health (GET) should return db connected status', async () => {
    const response = await request(app.getHttpServer() as any)
      .get('/health')
      .expect(200);

    if (response.body.status !== 'ok') {
      console.log('Health check failed with error:', response.body.error);
    }

    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('db', 'connected');
    expect(response.body).toHaveProperty('timestamp');
  });
});
