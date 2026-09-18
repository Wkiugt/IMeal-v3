import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { Prisma, Notification, NotificationKind } from '@prisma/client';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
type WorkerNotificationKind = Extract<
  NotificationKind,
  'REGISTRATION_REMINDER' | 'PICKUP_REMINDER' | 'NO_SHOW_PENALTY_CREATED'
>;

type NotificationCopy = {
  vi: { title: string; body: string };
  en: { title: string; body: string };
};

export type WorkerPublishInput = {
  userId: string;
  kind: WorkerNotificationKind;
  payload: Prisma.InputJsonObject;
  dedupeKey: string;
};

function dateValue(value: unknown): Date {
  const text = String(value ?? '');
  return new Date(`${text}T12:00:00.000Z`);
}

function formatNotificationDate(value: unknown, locale: 'vi' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(dateValue(value));
}

function countLabel(count: number, locale: 'vi' | 'en'): string {
  if (locale === 'vi') return String(count);
  return `${count} unregistered day${count === 1 ? '' : 's'}`;
}

function mealCountLabel(count: number, locale: 'vi' | 'en'): string {
  if (locale === 'vi') return String(count);
  return `${count} meal${count === 1 ? '' : 's'}`;
}

function renderLocale(
  kind: WorkerNotificationKind,
  payload: Readonly<Record<string, unknown>>,
  locale: 'vi' | 'en',
): { title: string; body: string } {
  const date = (value: unknown) => formatNotificationDate(value, locale);

  switch (kind) {
    case 'REGISTRATION_REMINDER': {
      const count = Array.isArray(payload.remainingMealDates)
        ? payload.remainingMealDates.length
        : 0;
      return locale === 'vi'
        ? {
            title: 'Nhắc đăng ký tuần tới',
            body: `Bạn còn ${countLabel(count, locale)} ngày chưa đăng ký. Hãy kiểm tra trước giờ chốt của từng ngày.`,
          }
        : {
            title: "Next week's registration",
            body: `You still have ${countLabel(count, locale)}. Review them before each day's cutoff.`,
          };
    }
    case 'PICKUP_REMINDER': {
      const count = Number(payload.registrationCount ?? 0);
      return locale === 'vi'
        ? {
            title: 'Nhắc nhận suất ăn',
            body: `Bạn còn ${mealCountLabel(count, locale)} suất chưa nhận hôm nay. Thời gian nhận kết thúc lúc 13:30.`,
          }
        : {
            title: 'Meal pickup reminder',
            body: `You still have ${mealCountLabel(count, locale)} to collect today. Pickup closes at 13:30.`,
          };
    }
    case 'NO_SHOW_PENALTY_CREATED':
      return locale === 'vi'
        ? {
            title: 'Phạt không nhận suất',
            body: `Bạn bị phạt 50.000đ do không nhận suất ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'No-show penalty',
            body: `A VND 50,000 penalty was added because your meal for ${date(payload.mealDate)} was not collected.`,
          };
    default:
      throw new Error(`Unsupported worker notification kind: ${String(kind)}`);
  }
}

function renderNotificationCopy(
  kind: WorkerNotificationKind,
  payload: Prisma.InputJsonObject,
): NotificationCopy {
  const record = payload as unknown as Readonly<Record<string, unknown>>;
  return {
    vi: renderLocale(kind, record, 'vi'),
    en: renderLocale(kind, record, 'en'),
  };
}

@Injectable()
export class WorkerNotificationPublisher {
  async publish(
    tx: Prisma.TransactionClient,
    input: WorkerPublishInput,
  ): Promise<Notification> {
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

    return notification;
  }
}
