import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getBusinessDate, parseMealDate } from '../src/common/business-time.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { SessionService } from '../src/auth/session.service.js';
import { AppModule } from '../src/app.module.js';

describe('Employee activity HTTP (disposable PostgreSQL)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let ownerToken: string;
  let foreignToken: string;
  let ownerId: string;
  let foreignId: string;
  let foreignPenaltyId: string;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'true';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    // The shared e2e setup truncates the disposable schema before each test.
    const owner = await prisma.user.create({
      data: {
        email: `activity-owner-${Date.now()}@example.test`,
        name: 'Activity Owner',
      },
    });
    ownerId = owner.id;
    const foreign = await prisma.user.create({
      data: {
        email: `activity-foreign-${Date.now()}@example.test`,
        name: 'Activity Foreign',
      },
    });
    foreignId = foreign.id;
    const sessionService = app.get(SessionService);
    const ownerSession = await sessionService.create({
      userId: owner.id,
      purpose: 'SESSION_LOGIN',
      requestId: 'activity-owner-request',
      metadata: {},
    });
    const foreignSession = await sessionService.create({
      userId: foreign.id,
      purpose: 'SESSION_LOGIN',
      requestId: 'activity-foreign-request',
      metadata: {},
    });
    ownerToken = ownerSession.token;
    foreignToken = foreignSession.token;

    const ownerRegistration = await prisma.registration.create({
      data: {
        userId: owner.id,
        mealDate: new Date('2026-09-30T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        menuRevisionId: null,
        menuNameSnapshot: 'Owner lunch',
        registeredAt: null,
      },
    });
    const foreignRegistration = await prisma.registration.create({
      data: {
        userId: foreign.id,
        mealDate: new Date('2026-09-29T00:00:00.000Z'),
        status: 'NO_SHOW',
        mealChoice: 'REGULAR',
        menuRevisionId: null,
        menuNameSnapshot: 'Foreign lunch',
        registeredAt: null,
      },
    });
    await prisma.penalty.create({
      data: {
        userId: owner.id,
        registrationId: ownerRegistration.id,
        mealDate: ownerRegistration.mealDate,
        amount: 50000,
        reason: 'OWNER_NO_SHOW',
        status: 'PENDING',
      },
    });
    const malformedPenalty = await prisma.penalty.create({
      data: {
        userId: owner.id,
        registrationId: foreignRegistration.id,
        mealDate: foreignRegistration.mealDate,
        amount: 50000,
        reason: 'MALFORMED_OWNER_LINK',
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    foreignPenaltyId = malformedPenalty.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated history and returns owner history only', async () => {
    await request(app.getHttpServer())
      .get('/api/registrations/history')
      .expect(401);
    const response = await request(app.getHttpServer())
      .get('/api/registrations/history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].menuNameSnapshot).toBe('Owner lunch');
    expect(response.body.data[0].penalties).toHaveLength(1);
  });

  it('returns owner penalties and hides malformed registration context', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/penalties')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(response.body.data).toHaveLength(2);
    const malformed = response.body.data.find(
      (item: { id: string }) => item.id === foreignPenaltyId,
    );
    expect(malformed.registration).toBeNull();
  });

  it('returns identical 404 for foreign and missing penalty detail', async () => {
    const ownerDetail = await request(app.getHttpServer())
      .get(`/api/penalties/${foreignPenaltyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerDetail.body.data.registration).toBeNull();

    const wrongOwner = await request(app.getHttpServer())
      .get(`/api/penalties/${foreignPenaltyId}`)
      .set('Authorization', `Bearer ${foreignToken}`)
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get('/api/penalties/not-a-real-penalty')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    expect(wrongOwner.body.error).toEqual(missing.body.error);
  });
  it('exercises history ordering and month stats through PostgreSQL', async () => {
    const today = parseMealDate(getBusinessDate());
    const dateFor = (offset: number) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + offset);
      return date;
    };
    const createRegistration = (
      mealDate: Date,
      status: 'ACTIVE' | 'SERVED' | 'NO_SHOW' | 'CANCELLED',
      served = false,
    ) =>
      prisma.registration.create({
        data: {
          userId: ownerId,
          mealDate,
          status,
          mealChoice: 'REGULAR',
          menuRevisionId: null,
          menuNameSnapshot: null,
          registeredAt: null,
          ...(served
            ? {
                mealServing: {
                  create: { servedAt: new Date('2099-01-02T12:00:00.000Z') },
                },
              }
            : {}),
        },
      });

    const currentRegistration = await createRegistration(dateFor(0), 'ACTIVE');
    const futureRegistration = await createRegistration(dateFor(1), 'NO_SHOW');
    const history = await request(app.getHttpServer())
      .get('/api/registrations/history?page=1&limit=100')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      history.body.data.some(
        (item: { id: string }) => item.id === currentRegistration.id,
      ),
    ).toBe(true);
    expect(
      history.body.data.some(
        (item: { id: string }) => item.id === futureRegistration.id,
      ),
    ).toBe(false);
    const firstPage = await request(app.getHttpServer())
      .get('/api/registrations/history?page=1&limit=1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(firstPage.body.data[0].id).toBe(currentRegistration.id);

    await createRegistration(new Date('2099-01-01T00:00:00.000Z'), 'ACTIVE');
    await createRegistration(
      new Date('2099-01-02T00:00:00.000Z'),
      'ACTIVE',
      true,
    );
    await createRegistration(new Date('2099-01-03T00:00:00.000Z'), 'NO_SHOW');
    await createRegistration(new Date('2099-01-04T00:00:00.000Z'), 'CANCELLED');
    const stats = await request(app.getHttpServer())
      .get('/api/registrations/stats?month=2099-01')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(stats.body.data).toMatchObject({
      period: {
        month: '2099-01',
        startDate: '2099-01-01',
        endDate: '2099-01-31',
      },
      booked: 3,
      enjoyed: 1,
    });
    const inverseRegistration = await createRegistration(dateFor(-3), 'ACTIVE');
    const foreignLinkedPenalty = await prisma.penalty.create({
      data: {
        userId: foreignId,
        registrationId: inverseRegistration.id,
        mealDate: inverseRegistration.mealDate,
        amount: 50000,
        reason: 'FOREIGN_OWNER_LINK',
        status: 'PENDING',
      },
    });
    const historyWithInverse = await request(app.getHttpServer())
      .get('/api/registrations/history?page=1&limit=100')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      historyWithInverse.body.data.find(
        (item: { id: string }) => item.id === inverseRegistration.id,
      ).penalties,
    ).toEqual([]);
    await request(app.getHttpServer())
      .get(`/api/penalties/${foreignLinkedPenalty.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/registrations/history?userId=foreign')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/registrations/stats?month=2099-13')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/registrations/history?page=21474838&limit=100')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });
});
