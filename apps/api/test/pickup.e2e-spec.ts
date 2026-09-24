import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

import { vi } from 'vitest';
import { InternalPickupController } from './../src/pickup/internal-pickup.controller.js';
import type { AuthenticatedUser } from './../src/auth/authenticated-user.js';
import { PickupService } from './../src/pickup/pickup.service.js';
import { SessionGuard } from './../src/auth/session.guard.js';
import { SessionService } from './../src/auth/session.service.js';
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

  it('requires a valid opaque session with the current kitchen permission', async () => {
    const resolvePickup = vi.fn().mockResolvedValue({
      session: { id: 'public-source-session' },
      items: [],
    });
    const kitchenUser: AuthenticatedUser = {
      id: 'kitchen-1',
      userId: 'kitchen-1',
      email: 'kitchen-1@example.com',
      roles: ['kitchen'],
      permissions: ['kitchen.serve'],
      sessionId: 'kitchen-session-id',
      isActive: true,
    };
    const staffUser: AuthenticatedUser = {
      id: 'staff-1',
      userId: 'staff-1',
      email: 'staff-1@example.com',
      roles: ['staff'],
      permissions: [],
      sessionId: 'staff-session-id',
      isActive: true,
    };
    const resolveSession = vi.fn(async (token: string) => {
      if (token === 'kitchen-session') return kitchenUser;
      if (token === 'staff-session') return staffUser;
      return null;
    });

    const testingModule = await Test.createTestingModule({
      controllers: [InternalPickupController],
      providers: [
        {
          provide: PickupService,
          useValue: { resolvePickup },
        },
        {
          provide: SessionService,
          useValue: { resolve: resolveSession },
        },
        SessionGuard,
        PermissionsGuard,
        Reflector,
      ],
    }).compile();
    const testApp = testingModule.createNestApplication();
    await testApp.init();

    try {
      const kitchenResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('Authorization', 'Bearer kitchen-session')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(kitchenResponse.status).toBe(201);
      expect(kitchenResponse.body).toEqual({
        session: { id: 'public-source-session' },
        items: [],
      });

      resolvePickup.mockClear();
      const missingBearerResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(missingBearerResponse.status).toBe(401);
      expect(resolvePickup).not.toHaveBeenCalled();

      resolvePickup.mockClear();
      const missingPermissionResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('Authorization', 'Bearer staff-session')
        .send({ qrPayload: 'PUBLIC_SOURCE_QR' });

      expect(missingPermissionResponse.status).toBe(403);
      expect(resolvePickup).not.toHaveBeenCalled();
      expect(resolveSession).toHaveBeenCalledWith('staff-session');
    } finally {
      await testApp.close();
    }
  });
});
