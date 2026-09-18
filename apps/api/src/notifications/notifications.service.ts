import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { renderNotificationCopy } from './notification-copy.js';

type PublishInput = {
  userId: string;
  kind: v1.NotificationKind;
  payload: Prisma.InputJsonObject;
  dedupeKey: string;
};

type NotificationRecord = {
  id: string;
  kind: v1.NotificationKind;
  payload: unknown;
  titleVi: string;
  bodyVi: string;
  titleEn: string;
  bodyEn: string;
  readAt: Date | null;
  createdAt: Date;
};

function invalid(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

@Injectable()
export class NotificationsService {
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async publish(tx: Prisma.TransactionClient, input: PublishInput): Promise<NotificationRecord> {
    if (input.kind === 'LEGACY_MESSAGE') {
      throw invalid('INVALID_NOTIFICATION_KIND', 'Legacy notifications are read-only');
    }

    const copy = renderNotificationCopy(input.kind, input.payload);
    const notification = await tx.notification.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        id: randomUUID(),
        userId: input.userId,
        kind: input.kind,
        payload: input.payload,
        titleVi: copy.vi.title,
        bodyVi: copy.vi.body,
        titleEn: copy.en.title,
        bodyEn: copy.en.body,
        dedupeKey: input.dedupeKey,
      },
    });

    await tx.outboxEvent.upsert({
      where: { dedupeKey: `notification-delivery:${notification.id}` },
      update: {},
      create: {
        id: randomUUID(),
        aggregateType: 'NOTIFICATION',
        aggregateId: notification.id,
        eventType: 'NOTIFICATION_CREATED',
        payload: JSON.stringify({ notificationId: notification.id }),
        dedupeKey: `notification-delivery:${notification.id}`,
      },
    });

    return notification as NotificationRecord;
  }

  async getNotifications(userId: string, cursor?: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw invalid('INVALID_NOTIFICATION_CURSOR', 'Notification limit must be between 1 and 50');
    }

    let cursorWhere: Record<string, unknown> | undefined;
    if (cursor) {
      const cursorItem = await this.prisma.notification.findFirst({
        where: { id: cursor, userId },
        select: { id: true, createdAt: true },
      });
      if (!cursorItem) {
        throw invalid('INVALID_NOTIFICATION_CURSOR', 'Notification cursor is invalid');
      }
      cursorWhere = {
        OR: [
          { createdAt: { lt: cursorItem.createdAt } },
          { createdAt: cursorItem.createdAt, id: { lt: cursorItem.id } },
        ],
      };
    }

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(cursorWhere ?? {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    const hasNextPage = rows.length > limit;
    const items = (hasNextPage ? rows.slice(0, limit) : rows) as NotificationRecord[];
    const data = items.map((item) => this.toItem(item));

    return {
      data,
      meta: {
        nextCursor: hasNextPage ? data[data.length - 1]?.id ?? null : null,
        hasNextPage,
        unreadCount,
      },
    };
  }

  async getNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    return { data: this.toItem(notification as NotificationRecord) };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }

    if (!notification.readAt) {
      await this.prisma.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
    }
    const updated = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    return { data: this.toItem(updated as NotificationRecord) };
  }

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { remindersEnabled: true, notificationLocale: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      data: {
        remindersEnabled: user.remindersEnabled,
        locale: String(user.notificationLocale).toLowerCase() as v1.NotificationLocale,
      },
    };
  }

  async updatePreferences(
    userId: string,
    input: v1.NotificationPreferencesRequest,
  ) {
    if (input.remindersEnabled === undefined && input.locale === undefined) {
      throw invalid(
        'INVALID_NOTIFICATION_PREFERENCE',
        'At least one notification preference is required',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.remindersEnabled === undefined
          ? {}
          : { remindersEnabled: input.remindersEnabled }),
        ...(input.locale === undefined
          ? {}
          : { notificationLocale: input.locale === 'en' ? 'EN' : 'VI' }),
      },
      select: { remindersEnabled: true, notificationLocale: true },
    });
    return {
      data: {
        remindersEnabled: updated.remindersEnabled,
        locale: String(updated.notificationLocale).toLowerCase() as v1.NotificationLocale,
      },
    };
  }

  private toItem(item: NotificationRecord) {
    return v1.NotificationItemSchema.parse({
      id: item.id,
      kind: item.kind,
      payload: item.payload,
      copy: {
        vi: { title: item.titleVi, body: item.bodyVi },
        en: { title: item.titleEn, body: item.bodyEn },
      },
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    });
  }

}
