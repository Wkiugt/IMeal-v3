import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { CheckInService } from '../src/check-in/check-in.service.js';

describe('Check-in controller (e2e)', () => {
  let app: INestApplication<Server>;
  let checkInService: {
    getStatus: Mock;
    resolve: Mock;
    confirm: Mock;
  };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    checkInService = {
      getStatus: vi.fn().mockResolvedValue({
        data: { state: 'ACTIVE', canResolve: true, canConfirm: false },
      }),
      resolve: vi.fn().mockResolvedValue({
        data: { sessionId: 'session-1', intentNonce: 'intent-1' },
      }),
      confirm: vi.fn().mockResolvedValue({
        data: {
          status: 'CHECKED_IN',
          registrationId: 'registration-1',
          servingId: 'serving-1',
          servedAt: '2026-09-24T04:00:00.000Z',
        },
      }),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(CheckInService)
      .useValue(checkInService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the authenticated employee check-in status', async () => {
    const response = await request(app.getHttpServer()).get('/api/me/check-in');

    expect(response.status).toBe(200);
    expect(response.body.data.state).toBe('ACTIVE');
  });

  it('resolves a QR and foreground GPS fix for the authenticated employee', async () => {
    const body = {
      qr: 'imeal-checkin-v1.signed',
      gps: {
        capturedAt: '2026-09-24T04:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      },
    };

    const response = await request(app.getHttpServer())
      .post('/api/me/check-in/resolve')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body.data.intentNonce).toBe('intent-1');
  });

  it('reports a distinct error when foreground GPS is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/me/check-in/resolve')
      .send({ qr: 'imeal-checkin-v1.signed' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('GPS_REQUIRED');
  });

  it('rejects a target-user field instead of allowing delegated check-in', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/me/check-in/resolve')
      .send({
        qr: 'imeal-checkin-v1.signed',
        targetUserId: 'other-user',
        gps: {
          capturedAt: '2026-09-24T04:00:00.000Z',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: 12,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects confirmation without its resolved intent nonce', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/me/check-in/confirm')
      .send({
        sessionId: 'session-1',
        idempotencyKey: 'request-1',
        gps: {
          capturedAt: '2026-09-24T04:00:00.000Z',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: 12,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the confirmed check-in response', async () => {
    const body = {
      sessionId: 'session-1',
      intentNonce: 'intent-1',
      idempotencyKey: 'request-1',
      gps: {
        capturedAt: '2026-09-24T04:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      },
    };

    const response = await request(app.getHttpServer())
      .post('/api/me/check-in/confirm')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('CHECKED_IN');
  });
});
