import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PushTransportService } from '../notifications/push-transport.service.js';

@Injectable()
export class DelegationsOutboxProcessor {
  private prisma = new PrismaClient();
  private logger = new Logger(DelegationsOutboxProcessor.name);
  private isProcessing = false;

  constructor(private readonly pushService: PushTransportService) {
    // Basic polling for eventually consistent Outbox processing
    setInterval(() => this.processOutboxEvents(), 10000);
  }

  async processOutboxEvents() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Atomic claim to prevent concurrency race condition
      const claimedCount = await this.prisma.$executeRaw`
        UPDATE "outbox_events"
        SET "status" = 'PROCESSING'
        WHERE "id" IN (
          SELECT "id" FROM "outbox_events"
          WHERE "status" = 'PENDING' AND "event_type" = 'REGISTRATION_CANCELLED'
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 10
        )
      `;

      if (claimedCount === 0) return;

      const events = await this.prisma.outboxEvent.findMany({
        where: {
          status: 'PROCESSING',
          eventType: 'REGISTRATION_CANCELLED',
        },
      });

      for (const event of events) {
        const notificationsToSend: { userId: string; message: string }[] = [];

        await this.prisma.$transaction(async (tx) => {
          const payload = JSON.parse(event.payload);
          const registrationId = payload.registrationId;

          // Revoke delegations related to this cancelled registration
          const delegations = await tx.pickupDelegation.findMany({
            where: {
              registrationId,
              status: { in: ['PENDING', 'ACCEPTED'] },
            },
          });

          for (const d of delegations) {
            await tx.pickupDelegation.update({
              where: { id: d.id },
              data: { status: 'REVOKED' },
            });

            // Audit Log
            await tx.auditLog.create({
              data: {
                action: 'DELEGATION_REVOKED_CASCADE',
                details: `Delegation ${d.id} revoked because parent registration was cancelled`,
                userId: d.delegateUserId,
              },
            });

            // Notification for Delegatee
            const message = `Your pickup delegation has been revoked because the original registration was cancelled.`;
            await tx.notification.create({
              data: {
                userId: d.delegateUserId,
                content: message,
              },
            });
            notificationsToSend.push({ userId: d.delegateUserId, message });
          }

          // Mark event as PROCESSED
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'PROCESSED' },
          });
        });

        // Send pushes outside the transaction
        for (const notif of notificationsToSend) {
          await this.pushService
            .sendPushNotification(
              notif.userId,
              'Delegation Revoked',
              notif.message,
            )
            .catch((e) => {
              this.logger.error('Push error:', e);
            });
        }
      }
    } catch (err) {
      this.logger.error('Error processing outbox events', err);
    } finally {
      this.isProcessing = false;
    }
  }
}
