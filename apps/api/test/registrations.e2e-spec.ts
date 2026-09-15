import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { describe, beforeAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppModule } from './../src/app.module.js';
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
        registrationWindow: {
          serverNow: '2026-09-03T02:00:00.000Z',
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
    expect(response.body.registrationWindow.timeZone).toBe('Asia/Ho_Chi_Minh');
    expect(response.body.registrationWindow.days).toHaveLength(7);
    expect(mockRegistrationsService.getWeekData).toHaveBeenCalledWith(
      'test-user-id',
      '2026-09-05',
    );
  });

  it('validates and forwards a batch request, returning each date result', async () => {
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
    expect(mockRegistrationsService.batchRegister).toHaveBeenCalledWith(
      'test-user-id',
      registrations,
    );
  });
  it('returns the typed unavailable-choice result for an ordinary date', async () => {
    mockRegistrationsService.batchRegister.mockResolvedValueOnce([
      {
        date: '2026-09-24',
        success: false,
        code: 'MEAL_CHOICE_UNAVAILABLE',
        reason: 'Meal choice is unavailable for this date',
      },
    ]);
    const registrations = [
      {
        mealDate: '2026-09-24',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ];

    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({ registrations });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'MEAL_CHOICE_UNAVAILABLE',
        reason: 'Meal choice is unavailable for this date',
      },
    ]);
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
