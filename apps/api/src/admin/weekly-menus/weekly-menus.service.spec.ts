import { Test, TestingModule } from '@nestjs/testing';
import { WeeklyMenusService } from './weekly-menus.service.js';
import { HttpException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PushTransportService } from '../../notifications/push-transport.service.js';

const mockPrisma = {
  weeklyMenu: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  dailyMenu: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  registration: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (cb) => {
    return cb(mockTx);
  }),
  auditLog: {
    create: vi.fn(),
  },
};

const mockTx = {
  dailyMenu: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  weeklyMenu: {
    findFirst: vi.fn(),
  },
  registration: {
    findMany: vi.fn(),
  },
  dailyMenuRevision: {
    count: vi.fn(),
    create: vi.fn(),
  },
  notification: {
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
  };
});

describe('WeeklyMenusService', () => {
  let service: WeeklyMenusService;

  beforeEach(async () => {
    const pushServiceMock = {
      registerToken: vi.fn(),
      sendPushNotification: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyMenusService,
        {
          provide: PushTransportService,
          useValue: pushServiceMock,
        },
      ],
    }).compile();

    service = module.get<WeeklyMenusService>(WeeklyMenusService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateDailyMenu', () => {
    it('should throw Conflict if disabling day with active registrations', async () => {
      mockTx.dailyMenu.findUnique.mockResolvedValueOnce({
        id: 'dm1',
        date: new Date(),
        isHoliday: false,
        isEnabled: true,
      });
      mockTx.registration.findMany.mockResolvedValueOnce([
        { id: 'reg1', status: 'ACTIVE' },
      ]);

      await expect(
        service.updateDailyMenu('2026-09-01', { isHoliday: true }),
      ).rejects.toThrow(HttpException);

      expect(mockTx.registration.findMany).toHaveBeenCalled();
    });

    it('should allow disabling if no active registrations', async () => {
      mockTx.dailyMenu.findUnique.mockResolvedValueOnce({
        id: 'dm1',
        date: new Date(),
        isHoliday: false,
        isEnabled: true,
      });
      mockTx.registration.findMany.mockResolvedValueOnce([]); // No registrations
      mockTx.dailyMenu.update.mockResolvedValueOnce({
        id: 'dm1',
        isHoliday: true,
        isEnabled: true,
      });

      const res = await service.updateDailyMenu('2026-09-01', {
        isHoliday: true,
      });
      expect(res.isHoliday).toBe(true);
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('publishWeeklyMenu', () => {
    it('should insert notifications for existing registrations', async () => {
      const dmDate = new Date();
      mockTx.weeklyMenu.findFirst.mockResolvedValueOnce({
        id: 'wm1',
        startDate: new Date(),
        dailyMenus: [{ id: 'dm1', date: dmDate }],
      });

      mockTx.dailyMenuRevision.count.mockResolvedValueOnce(0);
      mockTx.registration.findMany.mockResolvedValueOnce([
        { userId: 'user1', status: 'ACTIVE', mealDate: dmDate },
      ]);

      await service.publishWeeklyMenu('2026-09-01');

      expect(mockTx.dailyMenuRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: 'Revision 1 published' }),
        }),
      );
      expect(mockTx.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user1' }),
        }),
      );
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });
  });
});
