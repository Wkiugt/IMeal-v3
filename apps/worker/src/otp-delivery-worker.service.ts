import { createDecipheriv, createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@prisma/client';

export type OtpPurpose = 'SESSION_LOGIN';

export type OtpProviderInput = {
  destination: string;
  code: string;
  purpose: OtpPurpose;
};

export interface OtpProvider {
  send(input: OtpProviderInput): Promise<void>;
}

export type ClaimedOtpDelivery = {
  id: string;
  challengeId: string;
  providerPayloadRef: string;
  attemptCount: number;
  destination: string;
  purpose: OtpPurpose;
  expiresAt: Date;
};

export type DeliveryFailure = {
  code: string;
  retryAt: Date | null;
};

export interface OtpDeliveryOutboxPort {
  claimBatch(now: Date, limit: number): Promise<ClaimedOtpDelivery[]>;
  markProcessed(id: string, now: Date): Promise<boolean>;
  markFailed(id: string, now: Date, failure: DeliveryFailure): Promise<boolean>;
}

export type DeliveryRunResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
};
export const WORKER_OTP_PROVIDER = Symbol('WORKER_OTP_PROVIDER');

const PAYLOAD_VERSION = 'v1';
const PAYLOAD_AAD = 'imeal:otp-delivery:v1';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_SECONDS = 60;
const DEFAULT_RETRY_MAX_SECONDS = 15 * 60;
const DEFAULT_CLAIM_TIMEOUT_SECONDS = 5 * 60;
const MESSAGE_RETRY_PATTERN =
  /network|timeout|timed out|econn|socket|fetch failed|request failed|temporar|service unavailable|bad gateway|gateway timeout|too many requests/i;

function setting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function providerCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('providerCode' in error) {
      const value = error.providerCode;
      if (typeof value === 'string' && value.length > 0) return value;
    }
    for (const key of ['code', 'status', 'statusCode']) {
      const value = Reflect.get(error, key);
      if (typeof value === 'number' && Number.isInteger(value)) {
        return `HTTP_${value}`;
      }
      if (typeof value === 'string' && value.length > 0) {
        return /^\d{3}$/.test(value) ? `HTTP_${value}` : value;
      }
    }
  }
  if (error instanceof Error && MESSAGE_RETRY_PATTERN.test(error.message)) {
    return 'NETWORK';
  }
  if (error instanceof Error) {
    const status = error.message.match(/\b([45]\d\d)\b/);
    if (status) return `HTTP_${status[1]}`;
  }
  return 'UNKNOWN';
}

function isTransientProviderFailure(code: string, error: unknown): boolean {
  if (code === 'NETWORK' || code === 'HTTP_408' || code === 'HTTP_429') return true;
  if (/^HTTP_5\d\d$/.test(code)) return true;
  if (error instanceof Error && MESSAGE_RETRY_PATTERN.test(error.message)) return true;
  return false;
}

function deriveKey(secret: string): Buffer {
  if (secret.trim().length < 32) {
    throw new Error('OTP_DELIVERY_ENCRYPTION_KEY must contain at least 32 characters');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  return Buffer.from(value, 'base64url');
}

function decryptProviderPayload(
  reference: string,
  secret: string,
): OtpProviderInput {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] = reference.split('.');
    if (
      version !== PAYLOAD_VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext
    ) {
      throw new Error('invalid payload');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret),
      decodeBase64Url(encodedIv),
    );
    decipher.setAuthTag(decodeBase64Url(encodedTag));
    decipher.setAAD(Buffer.from(PAYLOAD_AAD, 'utf8'));
    const payload = JSON.parse(
      Buffer.concat([
        decipher.update(decodeBase64Url(encodedCiphertext)),
        decipher.final(),
      ]).toString('utf8'),
    ) as Partial<OtpProviderInput>;
    if (
      typeof payload.destination !== 'string' ||
      !payload.destination ||
      typeof payload.code !== 'string' ||
      !/^\d{6}$/.test(payload.code) ||
      payload.purpose !== 'SESSION_LOGIN'
    ) {
      throw new Error('invalid payload');
    }
    return {
      destination: payload.destination,
      code: payload.code,
      purpose: payload.purpose,
    };
  } catch {
    throw new Error('Invalid OTP provider payload');
  }
}

function encryptionSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.OTP_DELIVERY_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'test') return 'test-only-otp-delivery-encryption-secret';
  throw new Error('OTP_DELIVERY_ENCRYPTION_KEY is not configured');
}

export type WorkerOtpProviderConfig = {
  url: string | null;
  apiKey: string | null;
  from: string | null;
};

function providerConfig(env: NodeJS.ProcessEnv): WorkerOtpProviderConfig {
  const url = env.OTP_PROVIDER_URL?.trim() || null;
  const apiKey = env.OTP_PROVIDER_API_KEY?.trim() || null;
  const from = env.OTP_PROVIDER_FROM?.trim() || null;
  if (env.NODE_ENV === 'production' && (!url || !apiKey || !/^https:\/\//i.test(url))) {
    throw new Error(
      'OTP provider configuration requires an HTTPS URL and API key in production',
    );
  }
  return { url, apiKey, from };
}

@Injectable()
export class WorkerConfiguredOtpProvider implements OtpProvider {
  private readonly config: WorkerOtpProviderConfig;

  constructor() {
    this.config = providerConfig(process.env);
  }

  async send(input: OtpProviderInput): Promise<void> {
    const { url, apiKey, from } = this.config;
    if (!url || !apiKey) {
      const error = new Error('OTP provider configuration is incomplete') as Error & {
        providerCode?: string;
      };
      error.providerCode = 'CONFIGURATION';
      throw error;
    }
    const body: { to: string; message: string; from?: string } = {
      to: input.destination,
      message: `Your verification code is ${input.code}. It expires soon.`,
    };
    if (from) body.from = from;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      const error = new Error('OTP provider request failed before receiving a response') as Error & {
        providerCode?: string;
      };
      error.providerCode = 'NETWORK';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`OTP provider returned HTTP ${response.status}`) as Error & {
        providerCode?: string;
      };
      error.providerCode = `HTTP_${response.status}`;
      throw error;
    }
  }
}

type ClaimedRow = {
  id: string;
  challenge_id: string;
  provider_payload_ref: string;
  attempt_count: number;
  destination: string;
  purpose: OtpPurpose;
  expires_at: Date;
};

@Injectable()
export class WorkerOtpOutboxService implements OtpDeliveryOutboxPort {
  private readonly prisma: PrismaClient;

  constructor(@Optional() prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  async claimBatch(now: Date, limit: number): Promise<ClaimedOtpDelivery[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const claimTimeoutSeconds = setting(
      process.env,
      'OTP_DELIVERY_CLAIM_TIMEOUT_SECONDS',
      DEFAULT_CLAIM_TIMEOUT_SECONDS,
      1,
    );
    const staleAt = new Date(now.getTime() - claimTimeoutSeconds * 1000);
    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "otp_delivery_outboxes" AS o
          SET "status" = 'FAILED',
              "processed_at" = ${now},
              "next_attempt_at" = ${now},
              "last_error" = 'OTP_EXPIRED',
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
              "attempt_count" = o."attempt_count" + 1,
              "updated_at" = ${now}
          FROM due
          WHERE o."id" = due."id"
          RETURNING
            o."id",
            o."challenge_id",
            o."provider_payload_ref",
            o."attempt_count"
        )
        SELECT
          claimed."id",
          claimed."challenge_id",
          claimed."provider_payload_ref",
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
        attemptCount: row.attempt_count,
        destination: row.destination,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      }));
    });
  }

  async markProcessed(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.otpDeliveryOutbox.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { status: 'PROCESSED', processedAt: now, lastError: null },
    });
    if (result.count !== 1) return false;
    await this.recordAudit(id, 'OTP_DELIVERY_SENT', { result: 'SENT' });
    return true;
  }

  async markFailed(
    id: string,
    now: Date,
    failure: DeliveryFailure,
  ): Promise<boolean> {
    const terminal = failure.retryAt === null;
    const result = await this.prisma.otpDeliveryOutbox.updateMany({
      where: { id, status: 'PROCESSING' },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        ...(terminal ? { processedAt: now } : { processedAt: null }),
        nextAttemptAt: failure.retryAt ?? now,
        lastError: failure.code,
      },
    });
    if (result.count !== 1) return false;
    await this.recordAudit(id, 'OTP_DELIVERY_FAILED', {
      result: terminal ? 'FAILED' : 'RETRY',
      providerCode: failure.code,
    });
    return true;
  }

  private async recordAudit(
    outboxId: string,
    action: string,
    details: { result: string; providerCode?: string },
  ): Promise<void> {
    const auditLog = this.prisma.auditLog;
    if (!auditLog?.create) return;
    try {
      await auditLog.create({
        data: {
          action,
          details: JSON.stringify({ outboxId, ...details }),
        },
      });
    } catch {
      // Delivery state is authoritative; an audit write must not trigger resend.
    }
  }
}

@Injectable()
export class OtpDeliveryWorker {
  private readonly logger = new Logger(OtpDeliveryWorker.name);
  private readonly prisma: PrismaClient;
  private readonly provider: OtpProvider;
  private readonly outbox: OtpDeliveryOutboxPort;

  constructor(
    @Optional() prisma?: PrismaClient,
    @Optional() @Inject(WORKER_OTP_PROVIDER) provider?: OtpProvider,
    @Optional() outbox?: OtpDeliveryOutboxPort,
  ) {
    this.prisma = prisma ?? new PrismaClient();
    this.provider = provider ?? new WorkerConfiguredOtpProvider();
    this.outbox = outbox ?? new WorkerOtpOutboxService(this.prisma);
  }

  @Cron('*/15 * * * * *')
  async handleOtpDeliveryCron(): Promise<DeliveryRunResult> {
    return this.processOnce(new Date());
  }

  async processOnce(now: Date): Promise<DeliveryRunResult> {
    const env = process.env;
    const rows = await this.outbox.claimBatch(
      now,
      setting(env, 'OTP_DELIVERY_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1),
    );
    const result: DeliveryRunResult = {
      claimed: rows.length,
      sent: 0,
      retried: 0,
      failed: 0,
      suppressed: 0,
    };
    const maxAttempts = setting(env, 'OTP_DELIVERY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1);
    const retryBaseSeconds = setting(
      env,
      'OTP_DELIVERY_RETRY_BASE_SECONDS',
      DEFAULT_RETRY_BASE_SECONDS,
      1,
    );
    const retryMaxSeconds = setting(
      env,
      'OTP_DELIVERY_RETRY_MAX_SECONDS',
      DEFAULT_RETRY_MAX_SECONDS,
      retryBaseSeconds,
    );

    for (const row of rows) {
      if (row.expiresAt <= now) {
        await this.outbox.markFailed(row.id, now, {
          code: 'OTP_EXPIRED',
          retryAt: null,
        });
        result.suppressed += 1;
        this.logger.warn(`otp-delivery=${row.id} result=suppressed reason=expired`);
        continue;
      }

      let payload: OtpProviderInput;
      try {
        payload = decryptProviderPayload(
          row.providerPayloadRef,
          encryptionSecret(env),
        );
      } catch {
        await this.outbox.markFailed(row.id, now, {
          code: 'PAYLOAD_INVALID',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.error(`otp-delivery=${row.id} result=failed reason=payload-invalid`);
        continue;
      }

      if (
        payload.destination !== row.destination ||
        payload.purpose !== row.purpose
      ) {
        await this.outbox.markFailed(row.id, now, {
          code: 'PAYLOAD_MISMATCH',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.error(`otp-delivery=${row.id} result=failed reason=payload-mismatch`);
        continue;
      }

      try {
        await this.provider.send(payload);
        const marked = await this.outbox.markProcessed(row.id, now);
        if (marked) result.sent += 1;
        this.logger.log(`otp-delivery=${row.id} result=sent`);
      } catch (error) {
        const code = providerCode(error);
        const transient = isTransientProviderFailure(code, error);
        const canRetry = transient && row.attemptCount < maxAttempts;
        const delaySeconds = Math.min(
          retryMaxSeconds,
          retryBaseSeconds * 2 ** Math.max(0, row.attemptCount - 1),
        );
        const retryAt = canRetry
          ? new Date(now.getTime() + delaySeconds * 1000)
          : null;
        const failureCode = canRetry
          ? 'PROVIDER_TRANSIENT'
          : transient
            ? 'PROVIDER_TRANSIENT_MAX_ATTEMPTS'
            : 'PROVIDER_PERMANENT';
        const marked = await this.outbox.markFailed(row.id, now, {
          code: failureCode,
          retryAt,
        });
        if (marked && canRetry) result.retried += 1;
        if (marked && !canRetry) result.failed += 1;
        this.logger.warn(
          `otp-delivery=${row.id} result=${canRetry ? 'retry' : 'failed'} provider=${code} attempt=${row.attemptCount}`,
        );
      }
    }
    return result;
  }
}
