import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createPrismaClient, type PrismaClient } from '@imeal/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminUsersController } from '../src/admin/users/admin-users.controller.js';
import { AdminUsersService } from '../src/admin/users/admin-users.service.js';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { SessionService } from '../src/auth/session.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-user.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

type Registry = {
  __imealRegisterTestPrismaClient?: (client: PrismaClient) => void;
};

function track(client: PrismaClient): PrismaClient {
  (
    globalThis as typeof globalThis & Registry
  ).__imealRegisterTestPrismaClient?.(client);
  return client;
}

const actor: AuthenticatedUser = {
  id: 'admin-http-actor',
  userId: 'admin-http-actor',
  email: 'admin-http@example.test',
  name: 'HTTP Admin',
  roles: ['admin'],
  permissions: ['user.manage'],
  sessionId: 'admin-http-session',
  isActive: true,
};

async function createApp(
  client: PrismaClient,
  principal: AuthenticatedUser,
): Promise<INestApplication<Server>> {
  const sessionService = { resolve: vi.fn().mockResolvedValue(principal) };
  const notifications = new NotificationsService(client as never);
  const module = await Test.createTestingModule({
    controllers: [AdminUsersController],
    providers: [
      Reflector,
      SessionGuard,
      PermissionsGuard,
      { provide: SessionService, useValue: sessionService },
      { provide: PrismaService, useValue: client },
      { provide: NotificationsService, useValue: notifications },
      AdminUsersService,
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  return app;
}

async function seedRoles(client: PrismaClient): Promise<void> {
  await client.role.createMany({
    data: [{ name: 'staff' }, { name: 'kitchen' }],
  });
}

describe('Admin users HTTP lifecycle', () => {
  it('authorizes, lists, replaces roles, previews, disables and enables without restoration', async () => {
    const client = track(createPrismaClient(process.env.DATABASE_URL ?? ''));
    await seedRoles(client);
    const target = await client.user.create({
      data: { email: 'http-target@example.test', name: 'HTTP Target' },
    });
    await client.user.create({
      data: { id: actor.id, email: actor.email, name: actor.name },
    });
    const mealDate = new Date();
    mealDate.setUTCHours(0, 0, 0, 0);
    mealDate.setUTCDate(mealDate.getUTCDate() + 1);
    const registration = await client.registration.create({
      data: {
        userId: target.id,
        mealDate,
        status: 'ACTIVE',
      },
    });
    const app = await createApp(client, actor);
    try {
      const list = await request(app.getHttpServer())
        .get('/admin/users?limit=20')
        .set('Authorization', 'Bearer synthetic-http-session');
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: target.id, email: target.email }),
        ]),
      );

      const roles = await request(app.getHttpServer())
        .put(`/admin/users/${target.id}/roles`)
        .set('Authorization', 'Bearer synthetic-http-session')
        .send({ roles: ['kitchen'] });
      expect(roles.status).toBe(200);
      expect(roles.body).toMatchObject({
        managedRoles: ['kitchen'],
        changed: true,
      });

      const preview = await request(app.getHttpServer())
        .post(`/v1/admin/users/${target.id}/disable/preview`)
        .set('Authorization', 'Bearer synthetic-http-session');
      expect(preview.status).toBe(201);
      expect(preview.body.registrations).toMatchObject({ count: 1 });

      const disabled = await request(app.getHttpServer())
        .post(`/admin/users/${target.id}/disable`)
        .set('Authorization', 'Bearer synthetic-http-session')
        .send({ confirm: true });
      expect(disabled.status).toBe(201);
      expect(disabled.body.affected).toMatchObject({
        registrationsCancelled: 1,
      });

      const audit = await request(app.getHttpServer())
        .get(`/admin/users/${target.id}/audit`)
        .set('Authorization', 'Bearer synthetic-http-session');
      expect(audit.status).toBe(200);
      expect(audit.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'USER_ROLES_UPDATED' }),
          expect.objectContaining({ action: 'USER_DISABLED' }),
        ]),
      );
      expect(JSON.stringify(audit.body)).not.toContain('tokenHash');

      const enabled = await request(app.getHttpServer())
        .post(`/admin/users/${target.id}/enable`)
        .set('Authorization', 'Bearer synthetic-http-session')
        .send({});
      expect(enabled.status).toBe(201);
      expect(
        await client.registration.findUniqueOrThrow({
          where: { id: registration.id },
        }),
      ).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'ACCOUNT_DISABLED',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 403 without user.manage and rejects unsafe role request bodies', async () => {
    const client = track(createPrismaClient(process.env.DATABASE_URL ?? ''));
    await seedRoles(client);
    const target = await client.user.create({
      data: { email: 'http-guard-target@example.test', name: 'Guard Target' },
    });
    await client.user.create({
      data: { id: actor.id, email: actor.email, name: actor.name },
    });
    const app = await createApp(client, { ...actor, permissions: [] });
    try {
      const denied = await request(app.getHttpServer())
        .get('/v1/admin/users')
        .set('Authorization', 'Bearer synthetic-http-session');
      expect(denied.status).toBe(403);
    } finally {
      await app.close();
    }

    const strictApp = await createApp(client, actor);
    try {
      const strict = await request(strictApp.getHttpServer())
        .put(`/admin/users/${target.id}/roles`)
        .set('Authorization', 'Bearer synthetic-http-session')
        .send({ roles: ['staff'], admin: true });
      expect(strict.status).toBe(400);
    } finally {
      await strictApp.close();
    }
  });
});
