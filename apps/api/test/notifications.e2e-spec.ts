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
    process.env.REQUIRE_AUTH = 'false';
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsService)
      .useValue({
        getNotifications: vi.fn().mockResolvedValue({
          data: [],
          meta: { nextCursor: null, hasNextPage: false, unreadCount: 0 },
        }),
        getNotification: vi.fn(),
        markAsRead: vi.fn(),
        getPreferences: vi.fn(),
        updatePreferences: vi.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return 400 for an invalid cursor', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?cursor=not-a-uuid',
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 for negative limit', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?limit=-1',
    );
    expect(res.status).toBe(400);
  });

  it('should return 400 for limit > 50', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?limit=51',
    );
    expect(res.status).toBe(400);
  });

  it('should parse valid cursor pagination params', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/notifications?limit=50',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: { nextCursor: null, hasNextPage: false, unreadCount: 0 },
    });
  });

  it('should use the default limit when query is missing', async () => {
    const res = await request(app.getHttpServer()).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: { nextCursor: null, hasNextPage: false, unreadCount: 0 },
    });
  });
});
