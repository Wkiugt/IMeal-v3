import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { WeeklyMenusService } from '../src/admin/weekly-menus/weekly-menus.service.js';

const MENU_START = '2026-10-05';

describe('Admin weekly menu lifecycle (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let service: WeeklyMenusService;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      providers: [PrismaService, NotificationsService, WeeklyMenusService],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(WeeklyMenusService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates, fills, and publishes a weekly menu with persisted revisions', async () => {
    const actor = await prisma.user.create({
      data: {
        email: 'weekly-menu-b4-admin@example.test',
        name: 'Weekly Menu B4 Admin',
      },
    });

    const draft = await service.createDraft(MENU_START);
    const enabledDays = await prisma.dailyMenu.findMany({
      where: { weeklyMenuId: draft.id, isEnabled: true },
      orderBy: { date: 'asc' },
    });
    expect(enabledDays).toHaveLength(5);

    for (const [index, day] of enabledDays.entries()) {
      await service.updateDailyMenu(
        day.date.toISOString().slice(0, 10),
        {
          content: `Meal ${index + 1}`,
          mealName: `Meal ${index + 1}`,
          description: `Description ${index + 1}`,
          imageUrl: index === 0 ? 'https://example.test/meal.jpg' : null,
        },
        actor.id,
      );
    }

    const revisions = await prisma.dailyMenuRevision.findMany({
      where: {
        dailyMenuId: { in: enabledDays.map((day) => day.id) },
        revision: { not: null },
      },
    });
    expect(revisions).toHaveLength(enabledDays.length);
    expect(revisions.every((revision) => revision.mealName?.startsWith('Meal '))).toBe(
      true,
    );

    await service.publishWeeklyMenu(MENU_START, actor.id);

    const published = await prisma.weeklyMenu.findUnique({
      where: { id: draft.id },
      select: { publishedAt: true },
    });
    expect(published?.publishedAt).toEqual(expect.any(Date));
  });
});
