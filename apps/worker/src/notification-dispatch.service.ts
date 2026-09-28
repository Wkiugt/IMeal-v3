import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { Prisma } from '@prisma/client';
import type { StructuredLogger } from '@imeal/observability';
import { PrismaService } from './common/prisma.service.js';
import {
  createWorkerStructuredLogger,
  workerLogFields,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';

const CLAIM_BATCH_SIZE = 100;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MINUTES = [1, 5, 15];
const TRANSIENT_PROVIDER_CODES = new Set([
  'MessageRateExceeded',
  '429',
  'HTTP_429',
]);
const PERMANENT_PROVIDER_CODES = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MismatchSenderId',
  'InvalidCredentials',
]);

type DeliveryWithRelations = {
  id: string;
  notificationId: string;
  pushDeviceId: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  attemptCount: number;
  pushDevice: { token: string; revokedAt: Date | null };
  notification: {
    id: string;
    userId: string;
    titleVi: string;
    bodyVi: string;
    titleEn: string;
    bodyEn: string;
    user: { notificationLocale: 'VI' | 'EN' };
  };
};

type ProviderTicket = {
  status?: string;
  id?: string;
  details?: { error?: string; [key: string]: unknown };
  message?: string;
  [key: string]: unknown;
};

type Failure = {
  code: string;
  error: string;
};

function sanitizeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? 'Unknown provider error');
  return raw
    .replace(/(?:ExpoPushToken|ExponentPushToken)\[[^\]\r\n]*\]/g, '[redacted-token]')
    .replace(/("?(?:body|title|data|to)"?\s*:\s*)"[^"\r\n]*"/gi, '$1"[redacted]"')
    .replace(/\s+/g, ' ')
    .trim();
}
function providerCode(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'UNKNOWN';

  const record = value as Record<string, unknown>;
  const details = record.details;
  if (typeof details === 'object' && details !== null) {
    const error = (details as Record<string, unknown>).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }

  if (typeof record.code === 'string' || typeof record.code === 'number') {
    return String(record.code);
  }

  const message = record.message;
  if (typeof message === 'string') {
    if (/MessageRateExceeded/i.test(message)) return 'MessageRateExceeded';
    if (/DeviceNotRegistered/i.test(message)) return 'DeviceNotRegistered';
    if (/MessageTooBig/i.test(message)) return 'MessageTooBig';
    if (/MismatchSenderId/i.test(message)) return 'MismatchSenderId';
    if (/InvalidCredentials/i.test(message)) return 'InvalidCredentials';
    if (/\b429\b/.test(message)) return '429';
    const httpStatus = message.match(/\b(5\d\d)\b/);
    if (httpStatus) return httpStatus[1];
  }

  for (const key of ['status', 'statusCode', 'httpStatus']) {
    const status = record[key];
    if (typeof status === 'string' || typeof status === 'number') {
      return String(status);
    }
  }
  return 'UNKNOWN';
}
function isTransientFailure(failure: Failure): boolean {
  if (TRANSIENT_PROVIDER_CODES.has(failure.code)) return true;
  if (/^(?:HTTP_)?5\d\d$/.test(failure.code)) return true;
  if (/network|timeout|econn|socket|fetch|temporar/i.test(failure.code)) {
    return true;
  }
  return /(?:network|timeout|timed out|econn|socket|fetch failed|request failed|temporar|internal server|service unavailable|bad gateway|gateway timeout|too many requests)/i.test(
    failure.error,
  );
}

function isPermanentFailure(failure: Failure): boolean {
  return PERMANENT_PROVIDER_CODES.has(failure.code);
}

@Injectable()
export class NotificationDispatchService {
  private readonly logger: StructuredLogger;
  private readonly expo: Expo;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() expo?: Expo,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
    this.expo = expo ?? new Expo();
  }

  @Cron('*/15 * * * * *')
  async handleNotificationDispatchCron() {
    return this.processNotificationDispatch();
  }

  async processNotificationDispatch(now: Date = new Date()) {
    const outboxCount = await this.claimNotificationOutbox(now);
    const deliveryCount = await this.processNotificationDeliveries(now);
    return { outboxCount, deliveryCount };
  }

  async claimNotificationOutbox(
    now: Date = new Date(),
    limit = CLAIM_BATCH_SIZE,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; aggregate_id: string; attempt_count: number }>
      >(
        Prisma.sql`
          SELECT "id", "aggregate_id", "attempt_count"
          FROM "outbox_events"
          WHERE "event_type" = 'NOTIFICATION_CREATED'
            AND "status" = 'PENDING'
            AND "available_at" <= ${now}
          ORDER BY "created_at", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `,
      );

      let processed = 0;
      for (const row of rows) {
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: 'PROCESSING',
            attemptCount: { increment: 1 },
          },
        });

        try {
          const notification = await tx.notification.findUnique({
            where: { id: row.aggregate_id },
            select: { id: true, userId: true },
          });
          if (notification) {
            const devices = await tx.pushDevice.findMany({
              where: { userId: notification.userId, revokedAt: null },
              select: { id: true },
            });
            for (const device of devices) {
              await tx.notificationDelivery.upsert({
                where: {
                  notificationId_pushDeviceId: {
                    notificationId: notification.id,
                    pushDeviceId: device.id,
                  },
                },
                update: {},
                create: {
                  id: randomUUID(),
                  notificationId: notification.id,
                  pushDeviceId: device.id,
                },
              });
            }
          }

          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: 'PROCESSED',
              processedAt: now,
              lastError: null,
            },
          });
          processed += 1;
        } catch (error) {
          const failure = {
            code: providerCode(error),
            error: sanitizeError(error),
          };
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              lastError: failure.error,
            },
          });
          this.logger.error(
            'worker.notification.outbox_failed',
            workerLogFields('worker.notification.outbox_failed', {
              jobRunId: row.id,
              providerCode: failure.code,
              attempt: row.attempt_count,
              errorCode: 'PROVIDER_FAILURE',
            }),
          );
        }
      }
      return processed;
    });
  }

  async claimNotificationDeliveries(
    now: Date = new Date(),
    limit = CLAIM_BATCH_SIZE,
  ): Promise<DeliveryWithRelations[]> {
    const staleAt = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          WITH due AS (
            SELECT d."id"
            FROM "notification_deliveries" AS d
            INNER JOIN "push_devices" AS pd
              ON pd."id" = d."push_device_id"
             AND pd."revoked_at" IS NULL
            WHERE (
              d."status" = 'PENDING'
              AND d."next_attempt_at" <= ${now}
            ) OR (
              d."status" = 'PROCESSING'
              AND d."updated_at" <= ${staleAt}
            )
            ORDER BY d."next_attempt_at", d."id"
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "notification_deliveries" AS d
          SET "status" = 'PROCESSING', "updated_at" = ${now}
          FROM due
          WHERE d."id" = due."id"
          RETURNING d."id"
        `,
      );
      if (rows.length === 0) return [];

      return (await tx.notificationDelivery.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        include: {
          pushDevice: { select: { token: true, revokedAt: true } },
          notification: {
            include: {
              user: { select: { notificationLocale: true } },
            },
          },
        },
      })) as unknown as DeliveryWithRelations[];
    });
  }

  async processNotificationDeliveries(
    now: Date = new Date(),
    limit = CLAIM_BATCH_SIZE,
  ): Promise<number> {
    const deliveries = await this.claimNotificationDeliveries(now, limit);
    if (deliveries.length === 0) return 0;

    const deliverable: DeliveryWithRelations[] = [];
    for (const delivery of deliveries) {
      if (delivery.pushDevice.revokedAt) {
        await this.markRevoked(delivery, now);
      } else {
        deliverable.push(delivery);
      }
    }
    if (deliverable.length === 0) return deliveries.length;

    const messages = deliverable.map((delivery) => {
      const locale = delivery.notification.user.notificationLocale;
      return {
        to: delivery.pushDevice.token,
        sound: 'default' as const,
        title:
          locale === 'EN'
            ? delivery.notification.titleEn
            : delivery.notification.titleVi,
        body:
          locale === 'EN'
            ? delivery.notification.bodyEn
            : delivery.notification.bodyVi,
        data: {
          notificationId: delivery.notificationId,
          url: `imeal://notifications/${delivery.notificationId}`,
        },
        channelId: 'imeal-default',
      };
    });
    let offset = 0;
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const chunkDeliveries = deliverable.slice(
        offset,
        offset + chunk.length,
      );
      offset += chunk.length;
      await this.processChunkWithLocks(chunkDeliveries, chunk, now);
    }
    return deliveries.length;
  }

  private async markRevoked(delivery: DeliveryWithRelations, now: Date) {
    await this.prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        nextAttemptAt: now,
        lastError: 'Device revoked',
      },
    });
  }

  private async processChunkWithLocks(
    deliveries: DeliveryWithRelations[],
    messages: ExpoPushMessage[],
    now: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const lockOrder = [...deliveries].sort((left, right) =>
        left.pushDeviceId.localeCompare(right.pushDeviceId),
      );
      for (const delivery of lockOrder) {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${delivery.pushDeviceId}, 0))`,
        );
      }

      const eligible: Array<{ delivery: DeliveryWithRelations; index: number }> = [];
      for (const [index, delivery] of deliveries.entries()) {
        const currentDelivery = await tx.notificationDelivery.findUnique({
          where: { id: delivery.id },
          select: { status: true },
        });
        if (!currentDelivery || currentDelivery.status !== 'PROCESSING') {
          continue;
        }

        const [device, notification] = await Promise.all([
          tx.pushDevice.findUnique({
            where: { id: delivery.pushDeviceId },
            select: { userId: true, revokedAt: true },
          }),
          tx.notification.findUnique({
            where: { id: delivery.notificationId },
            select: { userId: true },
          }),
        ]);
        if (
          !device ||
          device.revokedAt ||
          !notification ||
          device.userId !== notification.userId
        ) {
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FAILED',
              nextAttemptAt: now,
              lastError: 'Device revoked or reassigned',
            },
          });
          continue;
        }
        eligible.push({ delivery, index });
      }

      if (eligible.length === 0) return;
      const eligibleMessages = eligible.map(({ index }) => messages[index]);
      let tickets: ProviderTicket[];
      try {
        tickets = (await this.expo.sendPushNotificationsAsync(
          eligibleMessages,
        )) as ProviderTicket[];
      } catch (error) {
        const failure = {
          code: providerCode(error),
          error: sanitizeError(error),
        };
        for (const { delivery } of eligible) {
          await this.recordFailure(tx, delivery, failure, now);
        }
        return;
      }

      for (const [index, { delivery }] of eligible.entries()) {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          await this.markSent(tx, delivery, now);
          continue;
        }
        if (!ticket) {
          await this.recordFailure(
            tx,
            delivery,
            { code: 'UNKNOWN', error: 'Provider returned no ticket' },
            now,
          );
          continue;
        }
        await this.recordFailure(
          tx,
          delivery,
          {
            code: providerCode(ticket),
            error: sanitizeError(
              ticket.message ?? ticket.details?.error ?? ticket,
            ),
          },
          now,
        );
      }
    });
  }

  private async markSent(
    tx: Prisma.TransactionClient,
    delivery: DeliveryWithRelations,
    now: Date,
  ) {
    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'SENT',
        attemptCount: { increment: 1 },
        nextAttemptAt: now,
        lastError: null,
      },
    });
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    delivery: DeliveryWithRelations,
    failure: Failure,
    now: Date,
  ) {
    const attempt = delivery.attemptCount + 1;
    const retryable = isTransientFailure(failure) && !isPermanentFailure(failure);
    const shouldRetry = retryable && attempt < 4;
    const status = shouldRetry ? 'PENDING' : 'FAILED';
    const nextAttemptAt = shouldRetry
      ? new Date(now.getTime() + RETRY_DELAYS_MINUTES[attempt - 1] * 60 * 1000)
      : now;

    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status,
        attemptCount: attempt,
        nextAttemptAt,
        lastError: failure.error,
      },
    });
    if (failure.code === 'DeviceNotRegistered') {
      await tx.pushDevice.updateMany({
        where: { id: delivery.pushDeviceId, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    this.logger.warn(
      'worker.notification.delivery_failed',
      workerLogFields('worker.notification.delivery_failed', {
        jobRunId: delivery.id,
        providerCode: failure.code,
        attempt,
        retry: shouldRetry,
        errorCode: 'PROVIDER_FAILURE',
      }),
    );
  }
}
