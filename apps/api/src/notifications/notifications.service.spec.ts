import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const mockPrisma = {
  notification: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      notification = mockPrisma.notification;
    },
  };
});

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    service = new NotificationsService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockDate = new Date();
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          userId: 'user-1',
          content: 'Hello',
          isRead: false,
          createdAt: mockDate,
        },
      ]);
      mockPrisma.notification.count.mockResolvedValue(1);

      const result = await service.getNotifications('user-1', 1, 10);
      expect(result.items).toHaveLength(1);
      expect(result.meta.totalCount).toBe(1);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
    });
  });

  describe('markAsRead', () => {
    it('should throw NotFoundException if notification does not exist', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue(null);
      await expect(
        service.markAsRead('user-1', 'notif-missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user does not own the notification', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'other-user',
      });
      await expect(service.markAsRead('user-1', 'notif-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should mark notification as read successfully', async () => {
      const mockDate = new Date();
      mockPrisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        content: 'test',
        isRead: true,
        createdAt: mockDate,
      });

      const result = await service.markAsRead('user-1', 'notif-1');
      expect(result.isRead).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { isRead: true },
      });
    });
  });
});
