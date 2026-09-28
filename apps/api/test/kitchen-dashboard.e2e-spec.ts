import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  InternalServerErrorException,
} from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';
import {
  vi,
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  it,
  expect,
} from 'vitest';
import { KitchenDashboardService } from './../src/kitchen/kitchen-dashboard.service.js';

type DashboardServiceMock = {
  getDashboardSnapshot: (...args: unknown[]) => Promise<unknown>;
  toggleServingSignal: (
    date?: string,
    isReady?: boolean,
  ) => Promise<unknown>;
};

describe('KitchenDashboardController (e2e)', () => {
  let app: INestApplication<Server>;
  let dashboardService: DashboardServiceMock;
  const mockSnapshot = {
    date: '2026-09-03',
    isServingReady: true,
    counters: {
      totalRegistered: 10,
      regularTotal: 7,
      vegetarianTotal: 3,
      servedTotal: 6,
      remaining: 4,
      noShowTotal: 0,
    },
    recentLogs: [
      {
        id: 'srv-1',
        registrationId: 'reg-1',
        userId: 'user-1',
        userName: 'Nguyen Van A',
        userEmail: 'a@example.com',
        mealChoice: 'VEGETARIAN',
        servedAt: '2026-09-03T11:45:00.000Z',
        isProxy: false,
      },
    ],
    lists: {
      served: [
        {
          registrationId: 'reg-1',
          userId: 'user-1',
          userName: 'Nguyen Van A',
          mealChoice: 'VEGETARIAN',
          userEmail: 'a@example.com',
          state: 'SERVED',
          isServed: true,
          servedAt: '2026-09-03T11:45:00.000Z',
        },
      ],
      pending: [
        {
          registrationId: 'reg-2',
          userId: 'user-2',
          userName: 'Tran Thi B',
          mealChoice: 'REGULAR',
          userEmail: 'b@example.com',
          state: 'PENDING',
          isServed: false,
          servedAt: null,
        },
      ],
      all: [],
      noShow: [],
    },
  };

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false'; // Bypass auth for e2e tests
  });

  beforeEach(async () => {
    dashboardService = {
      getDashboardSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
      toggleServingSignal: vi.fn().mockImplementation((date, isReady) =>
        Promise.resolve({
          success: true,
          isServingReady: isReady,
          date: date || '2026-09-03',
        }),
      ),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KitchenDashboardService)
      .useValue(dashboardService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/v1/kitchen/days/:date/dashboard (GET) - returns snapshot with noShow and counters', async () => {
    const res = await request(app.getHttpServer()).get(
      '/v1/kitchen/days/2026-09-03/dashboard',
    );
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-09-03');
    expect(res.body.counters.totalRegistered).toBe(10);
    expect(res.body.counters.servedTotal).toBe(6);
    expect(res.body.counters.remaining).toBe(4);
    expect(res.body.counters.noShowTotal).toBe(0);
    expect(res.body.counters.regularTotal).toBe(7);
    expect(res.body.counters.vegetarianTotal).toBe(3);
    expect(
      res.body.counters.regularTotal + res.body.counters.vegetarianTotal,
    ).toBe(res.body.counters.totalRegistered);
    expect(res.body.recentLogs[0].mealChoice).toBe('VEGETARIAN');
    expect(res.body.lists.served[0].mealChoice).toBe('VEGETARIAN');
    expect(res.body.lists.served[0].state).toBe('SERVED');
    expect(res.body.lists.served[0].isServed).toBe(true);
    expect(res.body.lists.pending[0].mealChoice).toBe('REGULAR');
    expect(res.body.lists.pending[0].state).toBe('PENDING');
    expect(res.body.lists.pending[0].isServed).toBe(false);
    expect(res.body.lists.served).toHaveLength(1);
    expect(res.body.lists.pending).toHaveLength(1);
    expect(res.body.lists.noShow).toEqual([]);
  });
  it('maps dashboard state mismatches to the canonical error envelope', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    dashboardService.getDashboardSnapshot = vi
      .fn()
      .mockRejectedValue(
        new InternalServerErrorException(
          'Kitchen dashboard state invariant violated',
        ),
      );

    const res = await request(app.getHttpServer())
      .get('/v1/kitchen/days/2026-09-03/dashboard')
      .set('X-Request-Id', requestId);
    expect(res.status).toBe(500);
    expect(res.headers['x-request-id']).toBe(requestId);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Kitchen dashboard state invariant violated',
      },
      requestId,
    });
  });
  it('serves the real dashboard projection through the HTTP route', async () => {
    const fakePrisma = {
      registration: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'reg-http-pending',
            userId: 'user-http-pending',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
            user: {
              name: 'HTTP Pending',
              email: 'http-pending@example.com',
              isActive: true,
            },
            mealServing: null,
            delegations: [],
          },
          {
            id: 'reg-http-served',
            userId: 'user-http-served',
            status: 'ACTIVE',
            mealChoice: 'VEGETARIAN',
            user: {
              name: 'Current Served Name',
              email: 'current-served@example.com',
              isActive: true,
            },
            mealServing: {
              id: 'srv-http-served',
              servedAt: new Date('2026-09-03T11:30:00Z'),
              ownerNameSnapshot: 'Historical Served Name',
              ownerEmailSnapshot: 'historical-served@example.com',
            },
            delegations: [],
          },
          {
            id: 'reg-http-no-show',
            userId: 'user-http-no-show',
            status: 'NO_SHOW',
            mealChoice: 'REGULAR',
            user: {
              name: 'HTTP No Show',
              email: 'http-no-show@example.com',
              isActive: true,
            },
            mealServing: null,
            delegations: [],
          },
        ]),
      },
      appSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
      },
      mealServing: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const actualService = new KitchenDashboardService();
    // Replace only the persistence boundary; the HTTP path uses the real projection code.
    const serviceWithFakePrisma = actualService as unknown as {
      prisma: typeof fakePrisma;
    };
    serviceWithFakePrisma.prisma = fakePrisma;
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KitchenDashboardService)
      .useValue(actualService)
      .compile();
    const actualApp = moduleFixture.createNestApplication();
    await actualApp.init();

    try {
      const res = await request(actualApp.getHttpServer()).get(
        '/v1/kitchen/days/2026-09-03/dashboard',
      );

      expect(res.status).toBe(200);
      expect(res.body.counters).toMatchObject({
        totalRegistered: 3,
        servedTotal: 1,
        remaining: 1,
        noShowTotal: 1,
      });
      expect(res.body.lists.pending[0]).toMatchObject({
        registrationId: 'reg-http-pending',
        state: 'PENDING',
        isServed: false,
      });
      expect(res.body.lists.served[0]).toMatchObject({
        registrationId: 'reg-http-served',
        userName: 'Historical Served Name',
        state: 'SERVED',
        isServed: true,
      });
      expect(res.body.lists.noShow[0]).toMatchObject({
        registrationId: 'reg-http-no-show',
        state: 'NO_SHOW',
        isServed: false,
      });
      expect(fakePrisma.registration.findMany).toHaveBeenCalledTimes(1);
      expect(fakePrisma.mealServing.findMany).toHaveBeenCalledTimes(1);
    } finally {
      await actualApp.close();
    }
  });

  it('preserves dashboard authentication and permission guards', async () => {
    const previousRequireAuth = process.env.REQUIRE_AUTH;
    process.env.REQUIRE_AUTH = 'true';
    try {
      const res = await request(app.getHttpServer())
        .get('/v1/kitchen/days/2026-09-03/dashboard')
        .set('X-Request-Id', '22222222-2222-4222-8222-222222222222');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
      expect(res.body.requestId).toBe(
        '22222222-2222-4222-8222-222222222222',
      );
      expect(dashboardService.getDashboardSnapshot).not.toHaveBeenCalled();
    } finally {
      process.env.REQUIRE_AUTH = previousRequireAuth;
    }
  });
  it('preserves array-valued validation details through the canonical mapper', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const res = await request(app.getHttpServer())
      .post('/admin/weekly-menus/draft')
      .set('X-Request-Id', requestId)
      .send({ startDate: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBe(requestId);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('Request failed');
    expect(res.body.error.details.issues).toEqual([
      expect.objectContaining({
        path: ['startDate'],
        message: 'Start date must be a Monday',
      }),
    ]);
    expect(res.body.requestId).toBe(requestId);
  });



  it('/v1/kitchen/days/:date/events (GET SSE) - serves text/event-stream headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/kitchen/days/2026-09-03/events')
      .buffer(false)
      .parse((res, callback) => {
        if ('destroy' in res && typeof res.destroy === 'function') {
          res.destroy();
        }
        callback(null, null);
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('/api/kitchen/days/:date/dashboard (GET) - works with alias route', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/kitchen/days/2026-09-03/dashboard',
    );
    expect(res.status).toBe(200);
    expect(res.body.counters.totalRegistered).toBe(10);
  });

  it('/v1/kitchen/today/dashboard (GET) - returns today snapshot', async () => {
    const res = await request(app.getHttpServer()).get(
      '/v1/kitchen/today/dashboard',
    );
    expect(res.status).toBe(200);
    expect(res.body.counters.totalRegistered).toBe(10);
  });

  it('/v1/kitchen/days/:date/signal (POST) - toggles kitchen serving signal', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/kitchen/days/2026-09-03/signal')
      .send({ isServingReady: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      isServingReady: true,
      date: '2026-09-03',
    });
  });
});
