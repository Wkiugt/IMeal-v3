import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { CheckInService } from '../src/check-in/check-in.service.js';
import { LocationsService } from '../src/locations/locations.service.js';

function expectCanonicalError(
  response: {
    status: number;
    body: Record<string, unknown>;
    headers: Record<string, unknown>;
  },
  errorCode: string,
): void {
  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    statusCode: 400,
    errorCode,
    message:
      'The provided information is not valid. Please check it and try again.',
    requestId: expect.any(String),
  });
  expect(Object.keys(response.body).sort()).toEqual([
    'errorCode',
    'message',
    'requestId',
    'statusCode',
  ]);
  expect(response.headers['x-request-id']).toBe(response.body.requestId);
}
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

    expectCanonicalError(response, 'GPS_REQUIRED');
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

    expectCanonicalError(response, 'VALIDATION_ERROR');
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

    expectCanonicalError(response, 'VALIDATION_ERROR');
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

const REAL_QR_SECRET = 'real-http-check-in-secret-at-least-32-characters';
const REAL_LOCATION = {
  id: 'location-real-http',
  shortCode: 'HTTP',
  displayName: 'HTTP Kitchen',
  servingPointName: 'HTTP counter',
  address: '1 HTTP Street',
};
const REAL_ASSIGNMENT = {
  id: 'assignment-real-http',
  userId: 'test-user-id',
  employeeName: 'Test User',
  employeeCode: 'HTTP-1',
  locationId: REAL_LOCATION.id,
  serviceLocationCode: REAL_LOCATION.shortCode,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  isActive: true,
  location: REAL_LOCATION,
};

describe('Check-in real-service HTTP boundaries (e2e)', () => {
  let app: INestApplication<Server>;
  let sessionFindUnique: Mock;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T03:00:00.000Z'));
    vi.stubEnv('QR_SIGNING_SECRET', REAL_QR_SECRET);
    sessionFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true }),
      },
      employeeLocationAssignment: {
        findMany: vi.fn().mockResolvedValue([REAL_ASSIGNMENT]),
      },
      checkInSession: {
        findUnique: sessionFindUnique,
        create: vi.fn().mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            location: REAL_LOCATION,
          }),
        ),
      },
    };
    const locations = {
      resolveEffectiveLocation: vi.fn().mockResolvedValue({
        ...REAL_LOCATION,
        locationPolicy: {
          id: 'policy-real-http',
          locationId: REAL_LOCATION.id,
          latitude: 10,
          longitude: 106,
          geofenceRadiusMeters: 100,
          maxFixAgeSeconds: 30,
          maxAccuracyMeters: 50,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
          isActive: true,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(LocationsService)
      .useValue(locations)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('prepares a shared QR before 10:30 through the real HTTP service path', async () => {
    const response = await request(app.getHttpServer()).get('/api/kitchen/check-in/qr');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      date: '2026-09-30',
      activeFrom: '2026-09-30T03:30:00.000Z',
      expiresAt: '2026-09-30T06:30:00.000Z',
    });
    expect(response.body.data.qr).toMatch(/^imeal-checkin-v1\./);
  });

  it('returns the generic safe 500 envelope for a persisted QR hash mismatch', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 'session-real-http',
      mealDate: new Date('2026-09-30T00:00:00.000Z'),
      locationId: REAL_LOCATION.id,
      qrHash: 'unexpected-hash',
      activeFrom: new Date('2026-09-30T03:30:00.000Z'),
      expiresAt: new Date('2026-09-30T06:30:00.000Z'),
      location: REAL_LOCATION,
    });

    const response = await request(app.getHttpServer()).get('/api/kitchen/check-in/qr');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again later.',
      requestId: expect.any(String),
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'errorCode',
      'message',
      'requestId',
      'statusCode',
    ]);
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
    expect(JSON.stringify(response.body)).not.toContain('unexpected-hash');
  });
});
