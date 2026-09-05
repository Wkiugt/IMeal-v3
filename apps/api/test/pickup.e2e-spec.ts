import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

import { vi } from 'vitest';
import { PickupService } from './../src/pickup/pickup.service.js';

describe('PickupController (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false'; // Bypass auth
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PickupService)
      .useValue({
        getPickupOptions: vi.fn().mockResolvedValue({ options: [] }),
        getTotpSecret: vi.fn().mockReturnValue({ secret: 'mock-secret' }),
        generateQr: vi
          .fn()
          .mockImplementation((_userId, registrationIds, options) => {
            return {
              qr:
                options?.format === 'totp'
                  ? 'imeal:totp:mock-user:123456'
                  : 'imeal:v2:mock-user:2026-09-03:all:1788420000:abcd1234:sig123',
              registrationIds,
              format: options?.format || 'v2',
              ttl: options?.ttl || 5,
            };
          }),
        verifyQr: vi.fn().mockResolvedValue({
          valid: true,
          userId: 'mock-user',
          pickupOptions: [],
        }),
        resolvePickup: vi
          .fn()
          .mockResolvedValue({ session: { id: 'mock-session' }, items: [] }),
        confirmPickup: vi
          .fn()
          .mockResolvedValue({ success: true, servedCount: 1, servings: [] }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/me/pickup-options (GET)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/me/pickup-options',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ options: [] });
  });

  it('/api/me/qr (POST) - defaults to v2 signed QR with 5s TTL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/qr')
      .send({ registrationIds: ['abc'] });

    expect(res.status).toBe(201);
    expect(res.body.qr).toContain('imeal:v2:');
    expect(res.body.format).toBe('v2');
    expect(res.body.ttl).toBe(5);
  });

  it('/api/me/qr (POST) - accepts custom format and ttl', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/qr')
      .send({ registrationIds: ['abc'], format: 'totp', ttl: 30 });

    expect(res.status).toBe(201);
    expect(res.body.qr).toContain('imeal:totp:');
    expect(res.body.format).toBe('totp');
    expect(res.body.ttl).toBe(30);
  });

  it('/api/me/verify-qr (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/verify-qr')
      .send({ qr: 'MOCK_QR_STRING' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      valid: true,
      userId: 'mock-user',
      pickupOptions: [],
    });
  });

  it('/api/me/totp-secret (GET) - success', async () => {
    const res = await request(app.getHttpServer()).get('/api/me/totp-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ secret: 'mock-secret' });
  });

  it('/internal/api/v1/pickup/resolve (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/api/v1/pickup/resolve')
      .send({ qr: 'MOCK_QR_STRING' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ session: { id: 'mock-session' }, items: [] });
  });

  it('/internal/api/v1/pickup/confirm (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/api/v1/pickup/confirm')
      .send({
        pickupSessionId: 'sess-123',
        registrationIds: ['reg-1'],
        idempotencyKey: 'idem-1',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, servedCount: 1, servings: [] });
  });
});
