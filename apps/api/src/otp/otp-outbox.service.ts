import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@imeal/core';
import { PrismaService } from '../common/prisma.service.js';
import {
  encryptOtpProviderPayload,
  type OtpProviderInput,
} from './otp-provider.js';
export type ClaimedOtpDelivery = {
  id: string;
  challengeId: string;
  providerPayloadRef: string;
  claimToken: string;
  attemptCount: number;
  destination: string;
  purpose: OtpProviderInput['purpose'];
  expiresAt: Date;
};

export type OtpDeliveryFailure = {
  code: string;
  retryAt: Date | null;
};

type ClaimedRow = {
  id: string;
  challenge_id: string;
  provider_payload_ref: string;
  claim_token: string;
  attempt_count: number;
  destination: string;
  purpose: OtpProviderInput['purpose'];
  expires_at: Date;
};

const DEFAULT_CLAIM_LIMIT = 100;
const MAX_CLAIM_LIMIT = 500;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class OtpOutboxService {
  constructor(private readonly prisma: PrismaService) {}
  async enqueue(
    tx: Pick<Prisma.TransactionClient, 'otpDeliveryOutbox'>,
    input: OtpProviderInput & { challengeId: string; encryptionSecret: string },
  ): Promise<{ id: string; providerPayloadRef: string }> {
    const providerPayloadRef = encryptOtpProviderPayload(
      {
        destination: input.destination,
        code: input.code,
        purpose: input.purpose,
      },
      input.encryptionSecret,
    );
    const row = await tx.otpDeliveryOutbox.create({
      data: {
        challengeId: input.challengeId,
        providerPayloadRef,
      },
      select: { id: true, providerPayloadRef: true },
    });
    return row;
  }

  async claimBatch(
    now: Date,
    limit = DEFAULT_CLAIM_LIMIT,
  ): Promise<ClaimedOtpDelivery[]> {
    const boundedLimit = Math.max(
      1,
      Math.min(MAX_CLAIM_LIMIT, Math.floor(limit)),
    );
    const staleAt = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
    const claimToken = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "otp_delivery_outboxes" AS o
          SET "status" = 'FAILED',
              "processed_at" = ${now},
              "next_attempt_at" = ${now},
              "last_error" = 'OTP_EXPIRED',
              "claim_token" = NULL,
              "updated_at" = ${now}
          FROM "otp_challenges" AS c
          WHERE c."id" = o."challenge_id"
            AND o."status" IN ('PENDING', 'PROCESSING')
            AND o."processed_at" IS NULL
            AND (c."expires_at" <= ${now} OR c."consumed_at" IS NOT NULL)
        `);
      }

      const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        WITH due AS (
          SELECT o."id"
          FROM "otp_delivery_outboxes" AS o
          INNER JOIN "otp_challenges" AS c
            ON c."id" = o."challenge_id"
          WHERE (
            (o."status" = 'PENDING' AND o."next_attempt_at" <= ${now})
            OR (
              o."status" = 'PROCESSING'
              AND o."updated_at" <= ${staleAt}
            )
          )
            AND o."processed_at" IS NULL
            AND c."expires_at" > ${now}
            AND c."consumed_at" IS NULL
          ORDER BY o."next_attempt_at", o."id"
          LIMIT ${boundedLimit}
          FOR UPDATE OF o SKIP LOCKED
        ), claimed AS (
          UPDATE "otp_delivery_outboxes" AS o
          SET "status" = 'PROCESSING',
              "claim_token" = ${claimToken},
              "attempt_count" = o."attempt_count" + 1,
              "updated_at" = ${now}
          FROM due
          WHERE o."id" = due."id"
          RETURNING
            o."id",
            o."challenge_id",
            o."provider_payload_ref",
            o."claim_token",
            o."attempt_count"
        )
        SELECT
          claimed."id",
          claimed."challenge_id",
          claimed."provider_payload_ref",
          claimed."claim_token",
          claimed."attempt_count",
          c."normalized_email" AS "destination",
          c."purpose",
          c."expires_at"
        FROM claimed
        INNER JOIN "otp_challenges" AS c
          ON c."id" = claimed."challenge_id"
        ORDER BY claimed."id"
      `);
      return rows.map((row) => ({
        id: row.id,
        challengeId: row.challenge_id,
        providerPayloadRef: row.provider_payload_ref,
        claimToken: row.claim_token,
        attemptCount: row.attempt_count,
        destination: row.destination,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      }));
    });
  }

  async markProcessed(
    id: string,
    claimToken: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.otpDeliveryOutbox.updateMany({
      where: { id, status: 'PROCESSING', claimToken },
      data: {
        status: 'PROCESSED',
        processedAt: now,
        lastError: null,
      },
    });
    return result.count === 1;
  }

  async markFailed(
    id: string,
    claimToken: string,
    now: Date,
    failure: OtpDeliveryFailure,
  ): Promise<boolean> {
    const terminal = failure.retryAt === null;
    const result = await this.prisma.otpDeliveryOutbox.updateMany({
      where: { id, status: 'PROCESSING', claimToken },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        ...(terminal ? { processedAt: now } : { processedAt: null }),
        nextAttemptAt: failure.retryAt ?? now,
        lastError: failure.code,
      },
    });
    return result.count === 1;
  }
}
