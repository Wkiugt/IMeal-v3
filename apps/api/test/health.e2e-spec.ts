import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
