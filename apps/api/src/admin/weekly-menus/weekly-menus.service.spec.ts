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
  registration: { findMany: vi.fn() },
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
    });
    mockTx.auditLog.create.mockResolvedValue({});
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
      service.updateDailyMenu('2026-09-01', { isHoliday: true }),
    ).rejects.toThrow(HttpException);
  });

  it('publishes registration-opened once per active staff user', async () => {
    const startDate = new Date('2026-09-01T00:00:00.000Z');
    const endDate = new Date('2026-09-07T00:00:00.000Z');
    mockTx.weeklyMenu.findFirst.mockResolvedValueOnce({
      id: 'wm1',
      startDate,
      endDate,
      publishedAt: null,
      dailyMenus: [{ id: 'dm1', date: startDate }],
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

    await service.publishWeeklyMenu('2026-09-01');

    expect(notificationsServiceMock.publish).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        userId: 'user1',
        kind: 'REGISTRATION_OPENED',
        dedupeKey: 'registration-opened:user1:wm1',
      }),
    );
  });
});
