import { Test, TestingModule } from '@nestjs/testing';
import { WeeklyMenusService } from './weekly-menus.service.js';
import { HttpException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsService } from '../../notifications/notifications.service.js';

const mockPrisma = {
  weeklyMenu: { findMany: vi.fn(), create: vi.fn() },
  dailyMenu: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback(mockTx),
  ),
  auditLog: { create: vi.fn() },
};

const mockTx = {
  $queryRaw: vi.fn(),
  weeklyMenu: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  dailyMenu: { findUnique: vi.fn(), update: vi.fn() },
  mealDay: { updateMany: vi.fn() },
  registration: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  dailyMenuRevision: { findFirst: vi.fn(), create: vi.fn() },
  user: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

const notificationsServiceMock = { publish: vi.fn() };

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
}));

describe('WeeklyMenusService', () => {
  let service: WeeklyMenusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyMenusService,
        { provide: NotificationsService, useValue: notificationsServiceMock },
      ],
    }).compile();

    service = module.get<WeeklyMenusService>(WeeklyMenusService);
    vi.clearAllMocks();
    mockTx.$queryRaw.mockResolvedValue([]);
    mockTx.weeklyMenu.findFirst.mockResolvedValue({ id: 'wm1' });
    mockTx.dailyMenuRevision.create.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      revision: 1,
      mealName: 'Lunch',
      description: 'Verified lunch',
      imageUrl: null,
      content: 'Lunch',
    });
    mockTx.auditLog.create.mockResolvedValue({});
    mockTx.registration.findMany.mockResolvedValue([]);
    mockTx.registration.update.mockResolvedValue({});
  });

  it('rejects disabling a registered day', async () => {
    mockTx.dailyMenu.findUnique.mockResolvedValueOnce({
      id: 'dm1',
      weeklyMenuId: 'wm1',
      date: new Date('2026-09-01T00:00:00.000Z'),
      isHoliday: false,
      isEnabled: true,
      weeklyMenu: { publishedAt: null },
      revisions: [],
      mealDays: [{ mealType: 'LUNCH' }],
    });
    mockTx.weeklyMenu.findUnique.mockResolvedValue({ publishedAt: null });
    mockTx.registration.findMany.mockResolvedValueOnce([
      { id: 'reg1', status: 'ACTIVE' },
    ]);

    await expect(
      service.updateDailyMenu('2026-09-01', { isHoliday: true }, 'admin-1'),
    ).rejects.toThrow(HttpException);
  });

  it('publishes a new revision to eligible active registration snapshots atomically', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    mockTx.dailyMenu.findUnique.mockResolvedValueOnce({
      id: 'dm1',
      date,
      isHoliday: false,
      isEnabled: true,
      weeklyMenu: { publishedAt: new Date('2026-08-31T00:00:00.000Z') },
      revisions: [
        {
          id: 'revision-1',
          revision: 1,
          mealName: 'Old lunch',
          description: 'Old description',
          imageUrl: null,
          content: 'Old lunch',
        },
      ],
      mealDays: [{ mealType: 'LUNCH' }],
    });
    mockTx.weeklyMenu.findUnique.mockResolvedValue({
      publishedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    mockTx.dailyMenuRevision.create.mockResolvedValue({
      id: 'revision-2',
      revision: 2,
      mealName: 'New lunch',
      description: 'New description',
      imageUrl: 'https://example.test/new.jpg',
      content: 'New lunch',
    });
    mockTx.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        userId: 'user-1',
        mealServing: null,
        noShowAt: null,
        penalties: [],
      },
      {
        id: 'reg-served',
        userId: 'user-2',
        mealServing: { id: 'serving-1' },
        noShowAt: null,
        penalties: [],
      },
      {
        id: 'reg-no-show',
        userId: 'user-3',
        mealServing: null,
        noShowAt: new Date('2026-09-01T07:00:00.000Z'),
        penalties: [],
      },
      {
        id: 'reg-penalty',
        userId: 'user-4',
        mealServing: null,
        noShowAt: null,
        penalties: [{ id: 'penalty-1' }],
      },
    ]);
    mockTx.dailyMenu.findUnique.mockResolvedValue({
      id: 'dm1',
      date,
      isHoliday: false,
      isEnabled: true,
      weeklyMenu: { publishedAt: new Date('2026-08-31T00:00:00.000Z') },
      revisions: [],
      mealDays: [],
    });

    await service.updateDailyMenu(
      '2026-09-01',
      {
        mealName: 'New lunch',
        description: 'New description',
        imageUrl: 'https://example.test/new.jpg',
      },
      'admin-1',
    );

    expect(mockTx.dailyMenuRevision.create).toHaveBeenCalledWith({
      data: {
        dailyMenuId: 'dm1',
        revision: 2,
        mealName: 'New lunch',
        description: 'New description',
        imageUrl: 'https://example.test/new.jpg',
        createdByUserId: 'admin-1',
        content: 'Old lunch',
      },
    });
    expect(mockTx.registration.update).toHaveBeenCalledTimes(1);
    expect(mockTx.registration.update).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: {
        menuRevisionId: 'revision-2',
        menuNameSnapshot: 'New lunch',
        menuDescriptionSnapshot: 'New description',
        menuImageSnapshot: 'https://example.test/new.jpg',
      },
    });
  });

  it('publishes registration-opened once per active staff user', async () => {
    const startDate = new Date('2026-09-01T00:00:00.000Z');
    const endDate = new Date('2026-09-07T00:00:00.000Z');
    mockTx.weeklyMenu.findFirst.mockResolvedValueOnce({
      id: 'wm1',
      startDate,
      endDate,
      publishedAt: null,
      dailyMenus: [
        {
          id: 'dm1',
          date: startDate,
          revisions: [
            {
              id: 'revision-1',
              revision: 1,
              mealName: 'Lunch',
              description: 'Verified lunch',
              imageUrl: null,
              content: 'Lunch',
            },
          ],
          mealDays: [],
        },
      ],
    });
    mockTx.weeklyMenu.findUnique.mockResolvedValue({ publishedAt: null });
    mockTx.dailyMenuRevision.findFirst.mockResolvedValueOnce(null);
    mockTx.weeklyMenu.update.mockResolvedValue({
      id: 'wm1',
      startDate,
      endDate,
      publishedAt: new Date(),
      dailyMenus: [],
    });
    mockTx.user.findMany.mockResolvedValueOnce([
      { id: 'user1', name: 'An', email: 'an@example.com' },
    ]);

    await service.publishWeeklyMenu('2026-09-01', 'admin-1');

    expect(notificationsServiceMock.publish).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        userId: 'user1',
        kind: 'REGISTRATION_OPENED',
        dedupeKey: 'registration-opened:user1:wm1',
      }),
    );
    expect(mockTx.mealDay.updateMany).toHaveBeenCalledWith({
      where: { dailyMenuId: 'dm1' },
      data: {
        menuNameSnapshot: 'Lunch',
        menuDescriptionSnapshot: 'Verified lunch',
        menuImageSnapshot: null,
        lockedAt: expect.any(Date),
        serviceStartAt: new Date('2026-09-01T03:30:00.000Z'),
        serviceEndAt: new Date('2026-09-01T06:30:00.000Z'),
      },
    });
  });
});
