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

const presenterEvidence = {
  capturedAt: '2026-09-04T04:00:00.000Z',
  latitude: 10.77,
  longitude: 106.69,
  accuracyMeters: 12,
};

describe('PickupController (e2e)', () => {
  let app: INestApplication<Server>;
  let generateQr: ReturnType<typeof vi.fn>;
  let resolvePickup: ReturnType<typeof vi.fn>;
  let confirmPickup: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    generateQr = vi.fn().mockResolvedValue({
      qr: 'imeal:v2:mock-user:2026-09-04:abc:1788420000:nonce:sig',
      exp: 1788420000,
      ttl: 5,
      registrationIds: ['reg-1'],
      mealDate: '2026-09-04',
    });
    resolvePickup = vi.fn().mockResolvedValue({
      session: {
        id: 'mock-session',
        userId: 'mock-user',
        registrationIds: ['reg-1'],
        expiresAt: '2026-09-04T04:00:30.000Z',
        createdAt: '2026-09-04T04:00:00.000Z',
      },
      items: [],
      pickupSessionToken: 'mock-session',
      intent: {
        userId: 'mock-user',
        items: [],
        totalCount: 0,
        isProxy: false,
      },
    });
    confirmPickup = vi.fn().mockResolvedValue({
      success: true,
      servedCount: 1,
      servings: [],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PickupService)
      .useValue({
        getPickupOptions: vi.fn().mockResolvedValue({ options: [] }),
        generateQr,
        resolvePickup,
        confirmPickup,
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

  it('/api/me/qr (POST) requires exact intent and presenter evidence', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/qr')
      .send({ registrationIds: ['reg-1'], presenterEvidence });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      qr: expect.stringContaining('imeal:v2:'),
      ttl: 5,
      registrationIds: ['reg-1'],
    });
    expect(generateQr).toHaveBeenCalledWith(
      'test-user-id',
      { registrationIds: ['reg-1'], presenterEvidence },
    );
  });

  it('/api/me/qr (POST) rejects missing presenter evidence', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/qr')
      .send({ registrationIds: ['reg-1'] });

    expect(res.status).toBe(400);
    expect(generateQr).not.toHaveBeenCalled();
  });

  it('/internal/api/v1/pickup/resolve (POST) sends only QR and authenticated actor', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/api/v1/pickup/resolve')
      .send({ qr: 'SIGNED_QR' });

    expect(res.status).toBe(201);
    expect(resolvePickup).toHaveBeenCalledWith(
      { qr: 'SIGNED_QR' },
      expect.objectContaining({ id: 'test-user-id' }),
    );
  });

  it('/internal/api/v1/pickup/resolve (POST) rejects client GPS and aliases', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/api/v1/pickup/resolve')
      .send({ qr: 'SIGNED_QR', presenterEvidence });

    expect(res.status).toBe(400);
    expect(resolvePickup).not.toHaveBeenCalled();
  });

  it('/internal/api/v1/pickup/confirm (POST) accepts session-only exact intent', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/api/v1/pickup/confirm')
      .send({
        pickupSessionId: 'sess-123',
        idempotencyKey: 'idem-1',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, servedCount: 1, servings: [] });
    expect(confirmPickup).toHaveBeenCalledWith(
      { pickupSessionId: 'sess-123', idempotencyKey: 'idem-1' },
      expect.objectContaining({ id: 'test-user-id' }),
    );
  });

  it('requires a valid opaque session with the current kitchen permission', async () => {
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
    const restrictedResolve = vi.fn().mockResolvedValue({
      session: { id: 'public-source-session' },
      items: [],
    });

    const testingModule = await Test.createTestingModule({
      controllers: [InternalPickupController],
      providers: [
        {
          provide: PickupService,
          useValue: { resolvePickup: restrictedResolve },
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
        .send({ qr: 'PUBLIC_SOURCE_QR' });

      expect(kitchenResponse.status).toBe(201);
      expect(restrictedResolve).toHaveBeenCalledWith(
        { qr: 'PUBLIC_SOURCE_QR' },
        kitchenUser,
      );

      restrictedResolve.mockClear();
      const missingBearerResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .send({ qr: 'PUBLIC_SOURCE_QR' });

      expect(missingBearerResponse.status).toBe(401);
      expect(restrictedResolve).not.toHaveBeenCalled();

      restrictedResolve.mockClear();
      const missingPermissionResponse = await request(testApp.getHttpServer())
        .post('/api/serving/resolve')
        .set('Authorization', 'Bearer staff-session')
        .send({ qr: 'PUBLIC_SOURCE_QR' });

      expect(missingPermissionResponse.status).toBe(403);
      expect(restrictedResolve).not.toHaveBeenCalled();
      expect(resolveSession).toHaveBeenCalledWith('staff-session');
    } finally {
      await testApp.close();
    }
  });
});
