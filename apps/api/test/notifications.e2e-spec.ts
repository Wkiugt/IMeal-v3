import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

import { vi } from 'vitest';
import { NotificationsService } from './../src/notifications/notifications.service.js';

describe('NotificationsController (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(() => {
    process.env.REQUIRE_AUTH = 'false'; // Bypass auth
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsService)
      .useValue({
        getNotifications: vi.fn().mockResolvedValue({
          items: [],
          meta: { page: 1, limit: 10, totalCount: 0, totalPages: 0 },
        }),
        markAsRead: vi.fn().mockResolvedValue({}),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return 400 for negative page', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?page=-1',
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 for negative limit', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?limit=-1',
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 for limit > 100', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?limit=101',
    );
    expect(res.status).toBe(400);
  });

  it('should parse valid pagination params', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?page=2&limit=50',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, totalCount: 0, totalPages: 0 },
    });
  });

  it('should fallback to defaults when query is missing', async () => {
    const res = await request(app.getHttpServer()).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, totalCount: 0, totalPages: 0 },
    });
  });
});
