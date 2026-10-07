import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditController } from '../src/admin/operations/admin-audit.controller.js';
import { AdminAuditService } from '../src/admin/operations/admin-audit.service.js';
import { AdminJobsController } from '../src/admin/operations/admin-jobs.controller.js';
import { AdminJobsService } from '../src/admin/operations/admin-jobs.service.js';
import { AdminServingAuditController } from '../src/admin/operations/admin-serving.controller.js';
import { AdminServingAuditService } from '../src/admin/operations/admin-serving.service.js';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { SessionService } from '../src/auth/session.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-user.js';

// Service override and session resolve are a harness. They do not prove production auth.
const admin: AuthenticatedUser = {
  id: 'admin-1',
  userId: 'admin-1',
  email: 'admin@example.test',
  name: 'Admin',
  roles: ['admin'],
  permissions: ['audit.read', 'serving.read', 'jobs.read'],
  sessionId: 'session-1',
  isActive: true,
};

const pagination = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
};

async function createApp(
  user: AuthenticatedUser,
  providers: Provider[],
  controllers: Type[],
): Promise<INestApplication<Server>> {
  const module = await Test.createTestingModule({
    controllers,
    providers: [
      Reflector,
      SessionGuard,
      PermissionsGuard,
      { provide: SessionService, useValue: { resolve: vi.fn().mockResolvedValue(user) } },
      ...providers,
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe('Admin oversight HTTP (service override)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'true';
  });

  it('requires audit.read and returns the overridden audit page', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], pagination });
    const denied = await createApp(
      { ...admin, permissions: [] },
      [{ provide: AdminAuditService, useValue: { list } }],
      [AdminAuditController],
    );
    await request(denied.getHttpServer())
      .get('/v1/admin/audit')
      .set('authorization', 'Bearer test-token')
      .expect(403);
    await denied.close();

    const allowed = await createApp(
      admin,
      [{ provide: AdminAuditService, useValue: { list } }],
      [AdminAuditController],
    );
    const response = await request(allowed.getHttpServer())
      .get('/v1/admin/audit?page=1&limit=20')
      .set('authorization', 'Bearer test-token')
      .expect(200);
    expect(response.body.pagination.page).toBe(1);
    expect(list).toHaveBeenCalled();
    await allowed.close();
  });

  it('serves read-only serving and jobs summaries without a retry route', async () => {
    const servings = vi.fn().mockResolvedValue({ items: [], pagination });
    const jobs = vi.fn().mockResolvedValue({
      api: {
        status: 'ok',
        release: null,
        checks: {
          environment: 'ok',
          database: 'ok',
          migration: 'ok',
          draining: 'ok',
        },
      },
      worker: { status: 'not_configured', release: null, checks: null },
      knownFamilies: [],
      items: [],
      pagination,
      retryAvailable: false,
    });
    const app = await createApp(
      admin,
      [
        { provide: AdminServingAuditService, useValue: { list: servings } },
        { provide: AdminJobsService, useValue: { list: jobs } },
      ],
      [AdminServingAuditController, AdminJobsController],
    );
    await request(app.getHttpServer())
      .get('/v1/admin/servings')
      .set('authorization', 'Bearer test-token')
      .expect(200);
    const jobsResponse = await request(app.getHttpServer())
      .get('/admin/jobs')
      .set('authorization', 'Bearer test-token')
      .expect(200);
    expect(jobsResponse.body.retryAvailable).toBe(false);
    await request(app.getHttpServer())
      .post('/v1/admin/jobs/retry')
      .set('authorization', 'Bearer test-token')
      .expect(404);
    await app.close();
  });
});
