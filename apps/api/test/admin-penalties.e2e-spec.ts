import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  NotFoundException,
  BadRequestException,
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
import { PenaltiesService } from './../src/admin/penalties/penalties.service.js';

describe('AdminPenaltiesController (e2e)', () => {
  let app: INestApplication<Server>;
  let mockPenaltiesService: any;

  const samplePenaltyItem = {
    id: 'pen-1',
    userId: 'user-1',
    userName: 'Minh Anh',
    userEmail: 'minh.anh@example.com',
    amount: 50000,
    reason: 'NO_SHOW_PENALTY_2026-09-03',
    status: 'PENDING',
    paidAt: null,
    waivedAt: null,
    waiveReason: null,
    waivedByUserId: null,
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  };

  const sampleMetrics = {
    totalInvoiced: 150000,
    outstandingAmount: 50000,
    pendingCount: 1,
    paidCount: 1,
    waivedCount: 1,
    paidAmount: 50000,
    waivedAmount: 50000,
  };

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false'; // Bypass auth for standard e2e flow
  });

  beforeEach(async () => {
    mockPenaltiesService = {
      getPenalties: vi.fn().mockImplementation((query) =>
        Promise.resolve({
          items: [samplePenaltyItem],
          metrics: sampleMetrics,
          total: 1,
          page: query.page || 1,
          limit: query.limit || 20,
          totalPages: 1,
        }),
      ),
      markAsPaid: vi.fn().mockImplementation((id, _adminUserId) => {
        if (id === 'non-existent') {
          throw new NotFoundException(`Penalty with ID ${id} not found`);
        }
        if (id === 'already-paid') {
          throw new BadRequestException(
            'Cannot mark as paid: Penalty is already PAID.',
          );
        }
        return Promise.resolve({
          ...samplePenaltyItem,
          id,
          status: 'PAID',
          paidAt: '2026-09-03T12:00:00.000Z',
        });
      }),
      waivePenalty: vi.fn().mockImplementation((id, reason, adminUserId) => {
        if (!reason || reason.trim().length < 5) {
          throw new BadRequestException(
            'Waive reason must be at least 5 characters long',
          );
        }
        if (id === 'non-existent') {
          throw new NotFoundException(`Penalty with ID ${id} not found`);
        }
        if (id === 'already-waived') {
          throw new BadRequestException(
            'Cannot waive penalty: Penalty is already WAIVED.',
          );
        }
        return Promise.resolve({
          ...samplePenaltyItem,
          id,
          status: 'WAIVED',
          waivedAt: '2026-09-03T12:00:00.000Z',
          waiveReason: reason.trim(),
          waivedByUserId: adminUserId || 'admin-user',
        });
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PenaltiesService)
      .useValue(mockPenaltiesService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/v1/admin/penalties (GET) - returns penalty list and metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/penalties')
      .query({ status: 'PENDING', search: 'Minh', page: '1', limit: '10' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].userName).toBe('Minh Anh');
    expect(res.body.metrics.outstandingAmount).toBe(50000);
    expect(mockPenaltiesService.getPenalties).toHaveBeenCalledWith({
      status: 'PENDING',
      search: 'Minh',
      startDate: undefined,
      endDate: undefined,
      page: 1,
      limit: 10,
    });
  });

  it('/v1/admin/penalties/:id/paid (POST) - marks pending penalty as paid', async () => {
    const res = await request(app.getHttpServer()).post(
      '/v1/admin/penalties/pen-1/paid',
    );

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('pen-1');
    expect(res.body.status).toBe('PAID');
    expect(res.body.paidAt).toBeDefined();
    expect(mockPenaltiesService.markAsPaid).toHaveBeenCalledWith(
      'pen-1',
      'test-user-id',
    );
  });

  it('/v1/admin/penalties/:id/paid (POST) - returns 404 for non-existent penalty', async () => {
    const res = await request(app.getHttpServer()).post(
      '/v1/admin/penalties/non-existent/paid',
    );

    expect(res.status).toBe(404);
  });

  it('/v1/admin/penalties/:id/paid (POST) - returns 400 when attempting to mark already paid penalty', async () => {
    const res = await request(app.getHttpServer()).post(
      '/v1/admin/penalties/already-paid/paid',
    );

    expect(res.status).toBe(400);
  });

  it('/v1/admin/penalties/:id/waive (POST) - waives pending penalty with valid reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/penalties/pen-1/waive')
      .send({ reason: 'Excused due to approved medical leave' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('pen-1');
    expect(res.body.status).toBe('WAIVED');
    expect(res.body.waiveReason).toBe('Excused due to approved medical leave');
  });

  it('/v1/admin/penalties/:id/waive (POST) - returns 400 if waive reason is less than 5 characters', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/penalties/pen-1/waive')
      .send({ reason: 'Sick' });

    expect(res.status).toBe(400);
  });

  it('/v1/admin/penalties/:id/waive (POST) - returns 400 if waive reason is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/penalties/pen-1/waive')
      .send({});

    expect(res.status).toBe(400);
  });

  it('/v1/admin/penalties/:id (DELETE) - returns 404 (DELETE is forbidden and disallowed)', async () => {
    const res = await request(app.getHttpServer()).delete(
      '/v1/admin/penalties/pen-1',
    );

    expect(res.status).toBe(404);
  });
});
