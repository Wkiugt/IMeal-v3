import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
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

describe('KitchenDashboardController (e2e)', () => {
  let app: INestApplication<Server>;

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
          isServed: true,
          servedAt: '2026-09-03T11:45:00.000Z',
        },
      ],
      pending: [
        {
          registrationId: 'reg-2',
          userId: 'user-2',
          userName: 'Tran Thi B',
          userEmail: 'b@example.com',
          mealChoice: 'REGULAR',
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KitchenDashboardService)
      .useValue({
        getDashboardSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
        toggleServingSignal: vi.fn().mockImplementation((date, isReady) =>
          Promise.resolve({
            success: true,
            isServingReady: isReady,
            date: date || '2026-09-03',
          }),
        ),
      })
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
    expect(res.body.lists.pending[0].mealChoice).toBe('REGULAR');
    expect(res.body.lists.served).toHaveLength(1);
    expect(res.body.lists.pending).toHaveLength(1);
    expect(res.body.lists.noShow).toEqual([]);
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
