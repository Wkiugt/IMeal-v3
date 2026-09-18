import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

const notificationId = '11111111-1111-4111-8111-111111111111';
const mockPrisma = {
  notification: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  outboxEvent: { upsert: vi.fn() },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
}));

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    service = new NotificationsService();
    vi.clearAllMocks();
  });

  it('lists stable cursor pages with unread count', async () => {
    const createdAt = new Date('2026-09-18T03:00:00.000Z');
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: notificationId,
        kind: 'DELEGATION_REQUESTED',
        payload: {
          delegationId: '22222222-2222-4222-8222-222222222222',
          registrationId: '33333333-3333-4333-8333-333333333333',
          mealDate: '2026-09-21',
          counterpartName: 'An',
        },
        titleVi: 'Yêu cầu nhận hộ mới',
        bodyVi: 'An muốn bạn nhận hộ suất ngày 21/9/2026.',
        titleEn: 'New pickup request',
        bodyEn: 'An asked you to collect their meal for 9/21/2026.',
        readAt: null,
        createdAt,
      },
    ]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const result = await service.getNotifications('user-1', undefined, 20);
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      nextCursor: null,
      hasNextPage: false,
      unreadCount: 1,
    });
  });

  it('marks only an owned notification read idempotently', async () => {
    const createdAt = new Date('2026-09-18T03:00:00.000Z');
    const row = {
      id: notificationId,
      kind: 'DELEGATION_REQUESTED',
      payload: {
        delegationId: '22222222-2222-4222-8222-222222222222',
        registrationId: '33333333-3333-4333-8333-333333333333',
        mealDate: '2026-09-21',
        counterpartName: 'An',
      },
      titleVi: 'Yêu cầu nhận hộ mới',
      bodyVi: 'An muốn bạn nhận hộ suất ngày 21/9/2026.',
      titleEn: 'New pickup request',
      bodyEn: 'An asked you to collect their meal for 9/21/2026.',
      readAt: null,
      createdAt,
    };
    mockPrisma.notification.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, readAt: createdAt });

    const result = await service.markAsRead('user-1', notificationId);
    expect(result.data.readAt).toBe(createdAt.toISOString());
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
