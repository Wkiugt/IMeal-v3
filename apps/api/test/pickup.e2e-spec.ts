import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

import { vi } from 'vitest';
import { InternalPickupController } from './../src/pickup/internal-pickup.controller.js';
import { AuthService } from './../src/auth/auth.service.js';
import type { AuthenticatedUser } from './../src/auth/authenticated-user.js';
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

  it('allows a public source IP only with a bearer token granting kitchen.serve', async () => {
    const originalAuthMode = process.env.AUTH_MODE;
    const originalRequireAuth = process.env.REQUIRE_AUTH;
    const originalLocalAuthJwtSecret = process.env.LOCAL_AUTH_JWT_SECRET;
    process.env.AUTH_MODE = 'local';
    process.env.REQUIRE_AUTH = 'true';
    process.env.LOCAL_AUTH_JWT_SECRET =
      'test-local-jwt-secret-with-at-least-32-characters';

    const resolvePickup = vi.fn().mockResolvedValue({
      session: { id: 'public-source-session' },
      items: [],
    });
    let testApp: INestApplication<Server> | undefined;

    try {
      const testingModule = await Test.createTestingModule({
        controllers: [InternalPickupController],
        providers: [
          {
            provide: PickupService,
            useValue: { resolvePickup },
          },
          {
            provide: AuthService,
            useValue: {
              getPrincipal: vi.fn(
                async (sub: string): Promise<AuthenticatedUser> => ({
                  id: sub,
                  userId: sub,
                  email: `${sub}@example.com`,
                  roles: sub === 'kitchen-1' ? ['kitchen'] : ['staff'],
                  permissions:
                    sub === 'kitchen-1' ? ['kitchen.serve'] : [],
                }),
              ),
            },
          },
          JwtAuthGuard,
          PermissionsGuard,
          Reflector,
        ],
      }).compile();

      const jwtService = new JwtService();
      const kitchenToken = jwtService.sign(
        { sub: 'kitchen-1', authType: 'local' },
        { secret: process.env.LOCAL_AUTH_JWT_SECRET },
      );
      const staffToken = jwtService.sign(
        { sub: 'staff-1', authType: 'local' },
        { secret: process.env.LOCAL_AUTH_JWT_SECRET },
      );

      testApp = testingModule.createNestApplication();
      testApp
        .getHttpAdapter()
        .getInstance()
        .set('trust proxy', true);
      await testApp.init();

      const kitchenResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(kitchenResponse.status).toBe(201);
      expect(kitchenResponse.body).toEqual({
        session: { id: 'public-source-session' },
        items: [],
      });

      resolvePickup.mockClear();
      const missingBearerResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(missingBearerResponse.status).toBe(401);
      expect(resolvePickup).not.toHaveBeenCalled();

      resolvePickup.mockClear();
      const missingPermissionResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(missingPermissionResponse.status).toBe(403);
      expect(resolvePickup).not.toHaveBeenCalled();
    } finally {
      await testApp?.close();

      if (originalAuthMode === undefined) {
        delete process.env.AUTH_MODE;
      } else {
        process.env.AUTH_MODE = originalAuthMode;
      }

      if (originalRequireAuth === undefined) {
        delete process.env.REQUIRE_AUTH;
      } else {
        process.env.REQUIRE_AUTH = originalRequireAuth;
      }

      if (originalLocalAuthJwtSecret === undefined) {
        delete process.env.LOCAL_AUTH_JWT_SECRET;
      } else {
        process.env.LOCAL_AUTH_JWT_SECRET = originalLocalAuthJwtSecret;
      }
    }
  });
});
