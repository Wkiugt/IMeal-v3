import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import {
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
} from 'vitest';
import type { Mock } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/common/prisma.service.js';
import { RegistrationsService } from './../src/registrations/registrations.service.js';
describe('RegistrationsController (e2e)', () => {
  let app: INestApplication<Server>;
  let mockRegistrationsService: {
    getWeekData: Mock;
    batchRegister: Mock;
  };

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    mockRegistrationsService = {
      getWeekData: vi.fn().mockResolvedValue({
        menu: null,
        registrations: [],
        days: [
          '2026-09-05',
          '2026-09-06',
          '2026-09-07',
          '2026-09-08',
          '2026-09-09',
          '2026-09-10',
          '2026-09-11',
        ].map((mealDate, index) => ({
          mealDate,
          menu: null,
          registration: null,
          location: null,
          lunarDate: {
            day: index + 1,
            month: 7,
            year: 2026,
            isLeapMonth: false,
          },
          availableMealChoices:
            index === 2 ? ['REGULAR', 'VEGETARIAN'] : ['REGULAR'],
          cutoffAt: `2026-09-${String(4 + index).padStart(2, '0')}T07:00:00.000Z`,
          canActivate: false,
          canCancel: false,
          canChangeMealChoice: false,
          unavailableReasons: {
            activate: ['NO_PUBLISHED_MENU'],
            cancel: ['NOT_ACTIVE'],
            changeMealChoice: ['NOT_ACTIVE'],
          },
        })),
        registrationWindow: {
          serverNow: '2026-09-03T02:00:00.000Z',
          nextWeekOpenAt: '2026-09-05T10:00:00.000Z',
          cutoffAt: '2026-09-04T07:00:00.000Z',
          timeZone: 'Asia/Ho_Chi_Minh',
          days: [
            '2026-09-05',
            '2026-09-06',
            '2026-09-07',
            '2026-09-08',
            '2026-09-09',
            '2026-09-10',
            '2026-09-11',
          ].map((mealDate, index) => ({
            mealDate,
            cutoffAt: `2026-09-${String(4 + index).padStart(2, '0')}T07:00:00.000Z`,
            editable: true,
            lunarDate: {
              day: index + 1,
              month: 7,
              year: 2026,
              isLeapMonth: false,
            },
            availableMealChoices:
              index === 2 ? ['REGULAR', 'VEGETARIAN'] : ['REGULAR'],
          })),
        },
      }),
      batchRegister: vi.fn().mockResolvedValue([
        { date: '2026-09-25', success: true },
        {
          date: '2026-09-26',
          success: false,
          code: 'CUTOFF_PASSED',
          reason: 'Cutoff time exceeded',
        },
      ]),
    };

    return Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RegistrationsService)
      .useValue(mockRegistrationsService)
      .compile()
      .then((moduleFixture) => {
        app = moduleFixture.createNestApplication();
        return app.init();
      });
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the weekly registrations through the /api route', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/registrations/week')
      .query({ startDate: '2026-09-05' });
    expect(response.status).toBe(200);
    expect(response.body.days).toHaveLength(7);
    expect(response.body.registrationWindow.timeZone).toBe('Asia/Ho_Chi_Minh');
  });

  it('validates a batch request and returns each date result', async () => {
    const registrations = [
      {
        mealDate: '2026-09-25',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
      { mealDate: '2026-09-26', status: 'CANCELLED' },
    ];
    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({ registrations });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { date: '2026-09-25', success: true },
      {
        date: '2026-09-26',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
  });

  it('rejects client-selected registration location and menu authority', async () => {
    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({
        registrations: [
          {
            mealDate: '2026-09-25',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
            locationId: 'client-location',
            menuRevisionId: 'client-revision',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(mockRegistrationsService.batchRegister).not.toHaveBeenCalled();
  });

  it.each([
    ['missing body', undefined],
    ['missing registrations', {}],
    [
      'malformed registration item',
      {
        registrations: [
          {
            mealDate: 'not-a-date',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ],
      },
    ],
    [
      'invalid status',
      {
        registrations: [
          {
            mealDate: '2026-09-05',
            status: 'PENDING',
            mealChoice: 'REGULAR',
          },
        ],
      },
    ],
    [
      'cancelled item with meal choice',
      {
        registrations: [
          {
            mealDate: '2026-09-05',
            status: 'CANCELLED',
            mealChoice: 'REGULAR',
          },
        ],
      },
    ],
    [
      'active item without meal choice',
      {
        registrations: [{ mealDate: '2026-09-05', status: 'ACTIVE' }],
      },
    ],
  ])('returns 400 for %s', async (_name, body) => {
    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send(body);

    expect(response.status).toBe(400);
    expect(mockRegistrationsService.batchRegister).not.toHaveBeenCalled();
  });

  it('does not retain the old unprefixed batch route', async () => {
    const response = await request(app.getHttpServer())
      .put('/registrations/batch')
      .send({
        registrations: [
          {
            mealDate: '2026-09-05',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ],
      });

    expect(response.status).toBe(404);
  });
});

function createRealPrismaMock() {
  const txMock = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true }),
    },
    dailyMenu: {
      findFirst: vi.fn().mockResolvedValue({ id: 'daily-menu-1' }),
    },
    dailyMenuRevision: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'revision-1',
          revision: 1,
          mealName: 'Lunch',
          description: 'Verified lunch',
          imageUrl: null,
        },
      ]),
    },
    employeeLocationAssignment: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'assignment-1',
          employeeName: 'Test User',
          employeeCode: 'TEST-1',
          serviceLocationCode: 'LOC-A',
          locationId: 'location-1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    },
    location: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'location-1',
        shortCode: 'LOC-A',
        displayName: 'Main Hall',
        address: '1 Main Street',
      }),
    },
    registration: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    pickupDelegation: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    notification: { upsert: vi.fn().mockResolvedValue({}) },
    outboxEvent: {
      upsert: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prismaMock = {
    appSetting: {
      findUnique: vi.fn().mockResolvedValue({ value: '18:00', version: 1 }),
    },
    weeklyMenu: { findFirst: vi.fn().mockResolvedValue(null) },
    registration: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    employeeLocationAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  };
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof txMock) => Promise<unknown>) =>
      callback(txMock),
  );
  return prismaMock;
}

describe('RegistrationsController weekly window (real service)', () => {
  let app: INestApplication<Server>;
  let prismaMock = createRealPrismaMock();

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    prismaMock = createRealPrismaMock();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('runs real week reads through the route for current, closed next, and outside weeks', async () => {
    vi.setSystemTime(new Date('2026-09-04T03:00:00.000Z'));

    const current = await request(app.getHttpServer())
      .get('/api/registrations/week')
      .query({ startDate: '2026-08-31' })
      .expect(200);
    expect(current.body.registrationWindow.days[5].editable).toBe(true);

    const closedNext = await request(app.getHttpServer())
      .get('/api/registrations/week')
      .query({ startDate: '2026-09-07' })
      .expect(200);
    expect(closedNext.body.registrationWindow.days[0].editable).toBe(false);
    expect(closedNext.body.days[0].unavailableReasons.activate).toContain(
      'REGISTRATION_WEEK_NOT_OPEN',
    );

    const outside = await request(app.getHttpServer())
      .get('/api/registrations/week')
      .query({ startDate: '2026-09-14' })
      .expect(200);
    expect(outside.body.registrationWindow.days[0].editable).toBe(false);
    expect(outside.body.days[0].unavailableReasons.activate).toContain(
      'OUTSIDE_REGISTRATION_WINDOW',
    );
  });

  it('opens next week at the exact boundary and preserves mixed batch results', async () => {
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'));

    const openNext = await request(app.getHttpServer())
      .get('/api/registrations/week')
      .query({ startDate: '2026-09-07' })
      .expect(200);
    expect(openNext.body.registrationWindow.days[0].editable).toBe(true);
    expect(openNext.body.registrationWindow.nextWeekOpenAt).toBe(
      '2026-09-05T10:00:00.000Z',
    );

    const exactBoundary = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({
        registrations: [
          {
            mealDate: '2026-09-06',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
          {
            mealDate: '2026-09-13',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
          {
            mealDate: '2026-09-14',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ],
      })
      .expect(200);
    expect(exactBoundary.body).toEqual([
      { date: '2026-09-06', success: true },
      { date: '2026-09-13', success: true },
      {
        date: '2026-09-14',
        success: false,
        code: 'OUTSIDE_REGISTRATION_WINDOW',
        reason: 'Date is outside the registration window',
      },
    ]);

    vi.setSystemTime(new Date('2026-09-04T03:00:00.000Z'));
    const mixed = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({
        registrations: [
          {
            mealDate: '2026-09-06',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
          {
            mealDate: '2026-09-07',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
          {
            mealDate: '2026-09-14',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ],
      })
      .expect(200);
    expect(mixed.body).toEqual([
      { date: '2026-09-06', success: true },
      {
        date: '2026-09-07',
        success: false,
        code: 'REGISTRATION_WEEK_NOT_OPEN',
        reason: 'Registration week is not open',
      },
      {
        date: '2026-09-14',
        success: false,
        code: 'OUTSIDE_REGISTRATION_WINDOW',
        reason: 'Date is outside the registration window',
      },
    ]);
  });

  it('validates batch bodies before invoking the real service', async () => {
    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({
        registrations: [
          {
            mealDate: '2026-09-06',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
            locationId: 'client-location',
          },
        ],
      });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
