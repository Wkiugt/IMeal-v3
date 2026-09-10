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
          timeZone: 'Asia/Ho_Chi_Minh',
          days: [],
        },
      }),
      batchRegister: vi.fn().mockResolvedValue([
        { date: '2026-09-05', success: true },
        { date: '2026-09-06', success: false, reason: 'Cutoff time exceeded' },
      ]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RegistrationsService)
      .useValue(mockRegistrationsService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
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
    expect(mockRegistrationsService.getWeekData).toHaveBeenCalledWith(
      'test-user-id',
      '2026-09-05',
    );
  });

  it('validates and forwards a batch request, returning each date result', async () => {
    const registrations = [
      { mealDate: '2026-09-05', status: 'ACTIVE' },
      { mealDate: '2026-09-06', status: 'CANCELLED' },
    ];
    const response = await request(app.getHttpServer())
      .put('/api/registrations/batch')
      .send({ registrations });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { date: '2026-09-05', success: true },
      { date: '2026-09-06', success: false, reason: 'Cutoff time exceeded' },
    ]);
    expect(mockRegistrationsService.batchRegister).toHaveBeenCalledWith(
      'test-user-id',
      registrations,
    );
  });

  it.each([
    ['missing body', undefined],
    ['missing registrations', {}],
    ['malformed registration item', { registrations: [{ mealDate: 'not-a-date', status: 'ACTIVE' }] }],
    ['invalid status', { registrations: [{ mealDate: '2026-09-05', status: 'PENDING' }] }],
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
      .send({ registrations: [{ mealDate: '2026-09-05', status: 'ACTIVE' }] });

    expect(response.status).toBe(404);
  });
});
