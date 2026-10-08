import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../common/prisma.service.js';
import { RegistrationsService } from '../registrations/registrations.service.js';
import { EmployeePenaltiesService } from './employee-penalties.service.js';

describe('Employee activity HTTP controllers', () => {
  let app!: INestApplication<Server>;
  const employeePenaltiesService = {
    getList: vi.fn(),
    getDetail: vi.fn(),
  };
  const registrationsService = {
    getHistory: vi.fn(),
    getStats: vi.fn(),
  };
  const prismaService = {
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
  };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    employeePenaltiesService.getList.mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
        },
      },
    });
    employeePenaltiesService.getDetail.mockResolvedValue({
      data: {
        id: 'penalty-1',
        amount: 50000,
        reason: 'NO_SHOW',
        status: 'PENDING',
        mealDate: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        registration: null,
      },
    });
    registrationsService.getHistory.mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
        },
      },
    });
    registrationsService.getStats.mockResolvedValue({
      data: {
        period: {
          month: '2026-09',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
        },
        booked: 0,
        enjoyed: 0,
      },
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(EmployeePenaltiesService)
      .useValue(employeePenaltiesService)
      .overrideProvider(RegistrationsService)
      .useValue(registrationsService)
      .compile();
    const nestApp = moduleFixture.createNestApplication();
    await nestApp.init();
    app = nestApp;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('uses CurrentUser for history and rejects client userId', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/registrations/history')
      .query({ page: '2', limit: '3', userId: 'other-user' });

    expect(response.status).toBe(400);
    expect(registrationsService.getHistory).not.toHaveBeenCalled();
  });

  it('passes authenticated history pagination and stats defaults to services', async () => {
    await request(app.getHttpServer())
      .get('/api/registrations/history')
      .query({ page: '2', limit: '3' })
      .expect(200);
    expect(registrationsService.getHistory).toHaveBeenCalledWith(
      'test-user-id',
      {
        page: 2,
        limit: 3,
      },
    );

    await request(app.getHttpServer())
      .get('/api/registrations/stats')
      .expect(200);
    expect(registrationsService.getStats).toHaveBeenCalledWith(
      'test-user-id',
      {},
    );
  });

  it('validates month and uses self-only penalty routes', async () => {
    await request(app.getHttpServer())
      .get('/api/registrations/stats')
      .query({ month: '2026-13' })
      .expect(400);
    expect(registrationsService.getStats).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/penalties')
      .query({ status: 'PAID', page: '1', limit: '10' })
      .expect(200);
    expect(employeePenaltiesService.getList).toHaveBeenCalledWith(
      'test-user-id',
      {
        status: 'PAID',
        page: 1,
        limit: 10,
      },
    );

    await request(app.getHttpServer())
      .get('/api/penalties/penalty-1')
      .expect(200);
    expect(employeePenaltiesService.getDetail).toHaveBeenCalledWith(
      'test-user-id',
      'penalty-1',
    );
  });

  it('keeps wrong-owner detail indistinguishable from missing detail', async () => {
    employeePenaltiesService.getDetail.mockRejectedValue(
      new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Penalty not found',
      }),
    );
    const foreign = await request(app.getHttpServer()).get(
      '/api/penalties/foreign',
    );
    const missing = await request(app.getHttpServer()).get(
      '/api/penalties/missing',
    );

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error).toEqual(missing.body.error);
  });
});
