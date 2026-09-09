import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

import { vi } from 'vitest';
import { InternalPickupController } from './../src/pickup/internal-pickup.controller.js';
import { PickupService } from './../src/pickup/pickup.service.js';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard.js';
import { PermissionsGuard } from './../src/auth/permissions.guard.js';

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

  it('allows a Kitchen caller to resolve pickup from a public source IP', async () => {
    const originalRequireAuth = process.env.REQUIRE_AUTH;
    process.env.REQUIRE_AUTH = 'true';
    let testApp: INestApplication<Server> | undefined;

    try {
      const testingModule = await Test.createTestingModule({
        controllers: [InternalPickupController],
        providers: [
          {
            provide: PickupService,
            useValue: {
              resolvePickup: vi.fn().mockResolvedValue({
                session: { id: 'public-source-session' },
                items: [],
              }),
            },
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(context: ExecutionContext) {
            const request = context.switchToHttp().getRequest();
            request.user = {
              id: 'kitchen-1',
              userId: 'kitchen-1',
              email: 'kitchen@example.com',
              roles: ['kitchen'],
              permissions: ['kitchen.serve'],
            };
            return true;
          },
        })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      testApp = testingModule.createNestApplication();
      testApp
        .getHttpAdapter()
        .getInstance()
        .set('trust proxy', true);
      await testApp.init();

      const res = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        session: { id: 'public-source-session' },
        items: [],
      });
    } finally {
      await testApp?.close();
      if (originalRequireAuth === undefined) {
        delete process.env.REQUIRE_AUTH;
      } else {
        process.env.REQUIRE_AUTH = originalRequireAuth;
      }
    }
  });
});
