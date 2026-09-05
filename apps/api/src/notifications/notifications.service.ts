import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getNotifications(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, totalCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        content: item.content,
        isRead: item.isRead,
        createdAt: item.createdAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You can only read your own notifications.');
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      content: updated.content,
      isRead: updated.isRead,
      createdAt: updated.createdAt.toISOString(),
    };
  }
}
