import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { StructuredLogger } from '@imeal/observability';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from './common/prisma.service.js';
import {
  createWorkerStructuredLogger,
  workerLogFields,
  WORKER_STRUCTURED_LOGGER,
} from './common/structured-logger.js';
import {
  WORKER_HEALTH_SHUTDOWN_COORDINATOR,
  type WorkerShutdownCoordinatorLike,
} from './health.service.js';

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
  claimToken: string;
  attemptCount: number;
  attemptsBeforeClaim?: number;
  destination: string;
  purpose: OtpPurpose;
  expiresAt: Date;
};

export type DeliveryFailure = {
  code: string;
  retryAt: Date | null;
};

export type OtpClaimValidation =
  | {
      valid: true;
      destination: string;
      purpose: OtpPurpose;
      expiresAt: Date;
    }
  | {
      valid: false;
      reason: 'EXPIRED' | 'CONSUMED' | 'CLAIM_LOST';
    };
export interface OtpDeliveryOutboxPort {
  claimBatch(now: Date, limit: number): Promise<ClaimedOtpDelivery[]>;
  validateClaim(
    id: string,
    claimToken: string,
    now: Date,
  ): Promise<OtpClaimValidation>;
  markProcessed(id: string, claimToken: string, now: Date): Promise<boolean>;
  markFailed(
    id: string,
    claimToken: string,
    now: Date,
    failure: DeliveryFailure,
  ): Promise<boolean>;
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
const KNOWN_PROVIDER_CODES = new Set([
  'CONFIGURATION',
  'NETWORK',
  'HTTP_408',
  'HTTP_429',
]);
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const PLACEHOLDER_MARKERS = [
  'change_me_local',
  'replace-with-',
  'example.test',
];

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

function requireWorkerValue(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required worker environment variable: ${name}`);
  }
  if (isPlaceholder(value)) {
    throw new Error(`${name} must not use a placeholder value`);
  }
  return value;
}

function requireSupportedNodeEnvironment(
  env: NodeJS.ProcessEnv,
): 'production' | 'development' | 'test' {
  const configured = env.NODE_ENV;
  const normalized = configured?.trim();
  if (!normalized) {
    throw new Error('Missing required worker environment variable: NODE_ENV');
  }
  if (configured !== normalized) {
    throw new Error('NODE_ENV must not contain surrounding whitespace');
  }
  if (
    normalized !== 'production' &&
    normalized !== 'development' &&
    normalized !== 'test'
  ) {
    throw new Error('NODE_ENV must be production, development, or test');
  }
  return normalized;
}

function setting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  required = false,
  maximum?: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (required) {
      throw new Error(`Missing required worker environment variable: ${name}`);
    }
    return fallback;
  }
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    const maximumMessage = maximum === undefined ? '' : ` and <= ${maximum}`;
    throw new Error(
      `${name} must be an integer >= ${minimum}${maximumMessage}`,
    );
  }
  return value;
}

const WORKER_NUMERIC_SETTINGS = [
  ['OTP_DELIVERY_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1],
  ['OTP_DELIVERY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1],
  ['OTP_DELIVERY_RETRY_BASE_SECONDS', DEFAULT_RETRY_BASE_SECONDS, 1],
  ['OTP_DELIVERY_RETRY_MAX_SECONDS', DEFAULT_RETRY_MAX_SECONDS, 1],
  ['OTP_DELIVERY_CLAIM_TIMEOUT_SECONDS', DEFAULT_CLAIM_TIMEOUT_SECONDS, 1],
] as const;

const FIXED_OPERATIONAL_SETTINGS = [
  ['SERVING_TIME_ZONE', 'Asia/Ho_Chi_Minh'],
  ['SERVING_WINDOW_START', '10:30'],
  ['SERVING_WINDOW_END', '13:30'],
  ['NO_SHOW_PROCESSING_TIME', '13:45'],
  ['QR_TTL_SECONDS', '5'],
  ['QR_CLOCK_SKEW_SECONDS', '2'],
  ['PICKUP_SESSION_TTL_SECONDS', '30'],
] as const;

function requireFixedSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: string,
): void {
  const value = requireWorkerValue(name, env);
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}`);
  }
}

function requireProductionRuntimeSettings(env: NodeJS.ProcessEnv): void {
  const logLevel = requireWorkerValue('LOG_LEVEL', env).toLowerCase();
  if (!LOG_LEVELS.includes(logLevel as (typeof LOG_LEVELS)[number])) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error');
  }

  requireWorkerValue('RELEASE_VERSION', env);
  setting(env, 'SHUTDOWN_TIMEOUT_SECONDS', 0, 1, true, 300);
  const evidencePath = requireWorkerValue('MIGRATION_EVIDENCE_PATH', env);
  if (!evidencePath.startsWith('/')) {
    throw new Error('MIGRATION_EVIDENCE_PATH must be an absolute path');
  }
  requireWorkerValue('MIGRATION_TARGET_IDENTITY', env);
}

function requireProductionProviderUrl(env: NodeJS.ProcessEnv): void {
  const value = requireWorkerValue('OTP_PROVIDER_URL', env);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OTP_PROVIDER_URL must be a valid HTTPS URL in production');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    hostname.length === 0 ||
    hostname === 'localhost' ||
    isIP(hostname) !== 0
  ) {
    throw new Error(
      'OTP_PROVIDER_URL must not target loopback or IP-literal destinations in production',
    );
  }
}

function safeProviderCode(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return 'UNKNOWN';
  }
  const normalized = String(value).trim();
  if (KNOWN_PROVIDER_CODES.has(normalized)) return normalized;
  if (/^(?:HTTP_)?[45]\d\d$/.test(normalized)) {
    return `HTTP_${normalized.replace(/^HTTP_/, '')}`;
  }
  if (
    /network|timeout|timed out|econn|socket|fetch failed|request failed|temporar|service unavailable|bad gateway|gateway timeout|too many requests/i.test(
      normalized,
    )
  ) {
    return 'NETWORK';
  }
  const status = normalized.match(/\b([45]\d\d)\b/);
  if (status) return `HTTP_${status[1]}`;
  return 'UNKNOWN';
}

function providerCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('providerCode' in error) {
      const code = safeProviderCode(Reflect.get(error, 'providerCode'));
      if (code !== 'UNKNOWN') return code;
    }
    for (const key of ['code', 'status', 'statusCode']) {
      const code = safeProviderCode(Reflect.get(error, key));
      if (code !== 'UNKNOWN') return code;
    }
  }
  if (error instanceof Error && MESSAGE_RETRY_PATTERN.test(error.message)) {
    return 'NETWORK';
  }
  if (error instanceof Error) {
    const code = safeProviderCode(error.message);
    if (code !== 'UNKNOWN') return code;
  }
  return 'UNKNOWN';
}

function isTransientProviderFailure(code: string, error: unknown): boolean {
  if (code === 'NETWORK' || code === 'HTTP_408' || code === 'HTTP_429')
    return true;
  if (/^HTTP_5\d\d$/.test(code)) return true;
  if (error instanceof Error && MESSAGE_RETRY_PATTERN.test(error.message))
    return true;
  return false;
}

function deriveKey(secret: string): Buffer {
  if (secret.trim().length < 32) {
    throw new Error(
      'OTP_DELIVERY_ENCRYPTION_KEY must contain at least 32 characters',
    );
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
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      reference.split('.');
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
  if (env.NODE_ENV === 'test')
    return 'test-only-otp-delivery-encryption-secret';
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
  const isProduction = env.NODE_ENV?.trim() === 'production';
  if (isProduction) {
    requireProductionProviderUrl(env);
    requireWorkerValue('OTP_PROVIDER_API_KEY', env);
    requireWorkerValue('OTP_PROVIDER_FROM', env);
    let validHttpsUrl = /^https:\/\//i.test(url ?? '');
    if (validHttpsUrl && url) {
      const authority = url.slice('https://'.length).split(/[/?#]/, 1)[0];
      validHttpsUrl = authority.length > 0;
      try {
        const parsed = new URL(url);
        validHttpsUrl =
          validHttpsUrl &&
          parsed.protocol === 'https:' &&
          parsed.hostname.length > 0;
      } catch {
        validHttpsUrl = false;
      }
    }
    if (!validHttpsUrl) {
      throw new Error(
        'OTP_PROVIDER_URL must be a valid HTTPS URL with a hostname in production',
      );
    }
    if (!apiKey) {
      throw new Error('OTP_PROVIDER_API_KEY is required in production');
    }
    if (!from) {
      throw new Error('OTP_PROVIDER_FROM is required in production');
    }
  }
  return { url, apiKey, from };
}

export function validateWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const nodeEnv = requireSupportedNodeEnvironment(env);
  const isProduction = nodeEnv === 'production';

  const secret = requireWorkerValue('OTP_DELIVERY_ENCRYPTION_KEY', env);
  if (secret.length < 32) {
    throw new Error(
      'OTP_DELIVERY_ENCRYPTION_KEY must contain at least 32 characters',
    );
  }

  if (isProduction) {
    requireWorkerValue('DATABASE_URL', env);
    requireProductionRuntimeSettings(env);
  }
  const providerEnvironment =
    env.NODE_ENV === nodeEnv ? env : { ...env, NODE_ENV: nodeEnv };
  providerConfig(providerEnvironment);

  let retryBaseSeconds: number | undefined;
  let retryMaxSeconds: number | undefined;
  for (const [name, fallback, minimum] of WORKER_NUMERIC_SETTINGS) {
    const value = setting(env, name, fallback, minimum, isProduction);
    if (name === 'OTP_DELIVERY_RETRY_BASE_SECONDS') {
      retryBaseSeconds = value;
    }
    if (name === 'OTP_DELIVERY_RETRY_MAX_SECONDS') {
      retryMaxSeconds = value;
    }
  }
  if (
    retryBaseSeconds !== undefined &&
    retryMaxSeconds !== undefined &&
    retryMaxSeconds < retryBaseSeconds
  ) {
    throw new Error(
      'OTP_DELIVERY_RETRY_MAX_SECONDS must be >= OTP_DELIVERY_RETRY_BASE_SECONDS',
    );
  }
  if (isProduction) {
    for (const [name, expected] of FIXED_OPERATIONAL_SETTINGS) {
      requireFixedSetting(env, name, expected);
    }
  }
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
      const error = new Error(
        'OTP provider configuration is incomplete',
      ) as Error & {
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
      const error = new Error(
        'OTP provider request failed before receiving a response',
      ) as Error & {
        providerCode?: string;
      };
      error.providerCode = 'NETWORK';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        `OTP provider returned HTTP ${response.status}`,
      ) as Error & {
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
  claim_token: string;
  attempt_count: number;
  attempt_count_before_claim: number;
  destination: string;
  purpose: OtpPurpose;
  expires_at: Date;
};
type CurrentClaimRow = {
  status: string;
  destination: string;
  purpose: OtpPurpose;
  expires_at: Date;
  consumed_at: Date | null;
};

@Injectable()
export class WorkerOtpOutboxService implements OtpDeliveryOutboxPort {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(now: Date, limit: number): Promise<ClaimedOtpDelivery[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const maxAttempts = setting(
      process.env,
      'OTP_DELIVERY_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
      1,
    );
    const claimTimeoutSeconds = setting(
      process.env,
      'OTP_DELIVERY_CLAIM_TIMEOUT_SECONDS',
      DEFAULT_CLAIM_TIMEOUT_SECONDS,
      1,
    );
    const staleAt = new Date(now.getTime() - claimTimeoutSeconds * 1000);
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "otp_delivery_outboxes"
          SET "status" = 'FAILED',
              "processed_at" = ${now},
              "next_attempt_at" = ${now},
              "last_error" = 'MAX_ATTEMPTS',
              "claim_token" = NULL,
              "updated_at" = ${now}
          WHERE "processed_at" IS NULL
            AND "attempt_count" >= ${maxAttempts}
            AND (
              "status" = 'PENDING'
              OR ("status" = 'PROCESSING' AND "updated_at" <= ${staleAt})
            )
        `);
      }
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
            AND o."attempt_count" < ${maxAttempts}
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
            o."attempt_count",
            o."attempt_count" - 1 AS "attempt_count_before_claim"
        )
        SELECT
          claimed."id",
          claimed."challenge_id",
          claimed."provider_payload_ref",
          claimed."claim_token",
          claimed."attempt_count",
          claimed."attempt_count_before_claim",
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
        attemptsBeforeClaim: row.attempt_count_before_claim,
        destination: row.destination,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      }));
    });
  }
  async validateClaim(
    id: string,
    claimToken: string,
    now: Date,
  ): Promise<OtpClaimValidation> {
    const rows = await this.prisma.$queryRaw<CurrentClaimRow[]>(Prisma.sql`
      SELECT
        o."status",
        c."normalized_email" AS "destination",
        c."purpose",
        c."expires_at",
        c."consumed_at"
      FROM "otp_delivery_outboxes" AS o
      INNER JOIN "otp_challenges" AS c
        ON c."id" = o."challenge_id"
      WHERE o."id" = ${id}
        AND o."claim_token" = ${claimToken}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row || row.status !== 'PROCESSING') {
      return { valid: false, reason: 'CLAIM_LOST' };
    }
    if (row.expires_at <= now) {
      return { valid: false, reason: 'EXPIRED' };
    }
    if (row.consumed_at !== null) {
      return { valid: false, reason: 'CONSUMED' };
    }
    return {
      valid: true,
      destination: row.destination,
      purpose: row.purpose,
      expiresAt: row.expires_at,
    };
  }

  async markProcessed(
    id: string,
    claimToken: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.otpDeliveryOutbox.updateMany({
      where: { id, status: 'PROCESSING', claimToken },
      data: { status: 'PROCESSED', processedAt: now, lastError: null },
    });
    if (result.count !== 1) return false;
    await this.recordAudit(id, 'OTP_DELIVERY_SENT', { result: 'SENT' });
    return true;
  }
  async markFailed(
    id: string,
    claimToken: string,
    now: Date,
    failure: DeliveryFailure,
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
  private readonly logger: StructuredLogger;
  private readonly provider: OtpProvider;
  private readonly outbox: OtpDeliveryOutboxPort;

  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(WORKER_OTP_PROVIDER) provider?: OtpProvider,
    @Optional() outbox?: OtpDeliveryOutboxPort,
    @Optional() clock?: () => Date,
    @Optional() @Inject(WORKER_STRUCTURED_LOGGER) logger?: StructuredLogger,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
  ) {
    this.logger = logger ?? createWorkerStructuredLogger();
    this.provider = provider ?? new WorkerConfiguredOtpProvider();
    this.outbox = outbox ?? new WorkerOtpOutboxService(this.prisma);
    this.clock = clock ?? (() => new Date());
  }

  @Cron('*/15 * * * * *')
  async handleOtpDeliveryCron(): Promise<DeliveryRunResult> {
    const release = this.shutdown?.registerInFlight?.();
    if (this.shutdown?.registerInFlight && !release) {
      this.logger.info(
        'worker.otp_delivery.skipped',
        workerLogFields('worker.otp_delivery.skipped', {
          errorCode: 'SHUTDOWN_DRAINING',
        }),
      );
      return {
        claimed: 0,
        sent: 0,
        retried: 0,
        failed: 0,
        suppressed: 0,
      };
    }
    try {
      return await this.processOnce(new Date());
    } finally {
      release?.();
    }
  }

  async processOnce(now: Date): Promise<DeliveryRunResult> {
    const env = process.env;
    const maxAttempts = setting(
      env,
      'OTP_DELIVERY_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
      1,
    );
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

    for (const row of rows) {
      const currentNow = this.clock();
      const attemptsBeforeClaim = row.attemptsBeforeClaim ?? row.attemptCount;
      if (attemptsBeforeClaim >= maxAttempts) {
        await this.outbox.markFailed(row.id, row.claimToken, currentNow, {
          code: 'MAX_ATTEMPTS',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.warn(
          'worker.otp.failed',
          workerLogFields('worker.otp.failed', {
            jobRunId: row.id,
            errorCode: 'MAX_ATTEMPTS',
          }),
        );
        continue;
      }

      const validation = await this.outbox.validateClaim(
        row.id,
        row.claimToken,
        currentNow,
      );
      if (!validation.valid) {
        if (validation.reason === 'CLAIM_LOST') {
          this.logger.warn(
            'worker.otp.skipped',
            workerLogFields('worker.otp.skipped', {
              jobRunId: row.id,
              errorCode: 'CLAIM_LOST',
            }),
          );
          continue;
        }
        const code =
          validation.reason === 'CONSUMED' ? 'OTP_CONSUMED' : 'OTP_EXPIRED';
        await this.outbox.markFailed(row.id, row.claimToken, currentNow, {
          code,
          retryAt: null,
        });
        result.suppressed += 1;
        this.logger.warn(
          'worker.otp.suppressed',
          workerLogFields('worker.otp.suppressed', {
            jobRunId: row.id,
            errorCode: validation.reason,
          }),
        );
        continue;
      }

      let payload: OtpProviderInput;
      try {
        payload = decryptProviderPayload(
          row.providerPayloadRef,
          encryptionSecret(env),
        );
      } catch {
        await this.outbox.markFailed(row.id, row.claimToken, currentNow, {
          code: 'PAYLOAD_INVALID',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.error(
          'worker.otp.failed',
          workerLogFields('worker.otp.failed', {
            jobRunId: row.id,
            errorCode: 'PAYLOAD_INVALID',
          }),
        );
        continue;
      }
      if (
        payload.destination !== validation.destination ||
        payload.purpose !== validation.purpose
      ) {
        await this.outbox.markFailed(row.id, row.claimToken, currentNow, {
          code: 'PAYLOAD_MISMATCH',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.error(
          'worker.otp.failed',
          workerLogFields('worker.otp.failed', {
            jobRunId: row.id,
            errorCode: 'PAYLOAD_MISMATCH',
          }),
        );
        continue;
      }

      const finalNow = this.clock();
      const finalValidation = await this.outbox.validateClaim(
        row.id,
        row.claimToken,
        finalNow,
      );
      if (!finalValidation.valid) {
        if (finalValidation.reason === 'CLAIM_LOST') {
          this.logger.warn(
            'worker.otp.skipped',
            workerLogFields('worker.otp.skipped', {
              jobRunId: row.id,
              errorCode: 'CLAIM_LOST',
            }),
          );
          continue;
        }
        const code =
          finalValidation.reason === 'CONSUMED'
            ? 'OTP_CONSUMED'
            : 'OTP_EXPIRED';
        await this.outbox.markFailed(row.id, row.claimToken, finalNow, {
          code,
          retryAt: null,
        });
        result.suppressed += 1;
        this.logger.warn(
          'worker.otp.suppressed',
          workerLogFields('worker.otp.suppressed', {
            jobRunId: row.id,
            errorCode: finalValidation.reason,
          }),
        );
        continue;
      }
      if (
        payload.destination !== finalValidation.destination ||
        payload.purpose !== finalValidation.purpose
      ) {
        await this.outbox.markFailed(row.id, row.claimToken, finalNow, {
          code: 'PAYLOAD_MISMATCH',
          retryAt: null,
        });
        result.failed += 1;
        this.logger.error(
          'worker.otp.failed',
          workerLogFields('worker.otp.failed', {
            jobRunId: row.id,
            errorCode: 'PAYLOAD_MISMATCH',
          }),
        );
        continue;
      }

      try {
        await this.provider.send(payload);
        const marked = await this.outbox.markProcessed(
          row.id,
          row.claimToken,
          finalNow,
        );
        if (marked) result.sent += 1;
        this.logger.info(
          'worker.otp.sent',
          workerLogFields('worker.otp.sent', {
            jobRunId: row.id,
          }),
        );
      } catch (error) {
        const code = providerCode(error);
        const transient = isTransientProviderFailure(code, error);
        const canRetry = transient && row.attemptCount < maxAttempts;
        const delaySeconds = Math.min(
          retryMaxSeconds,
          retryBaseSeconds * 2 ** Math.max(0, row.attemptCount - 1),
        );
        const retryAt = canRetry
          ? new Date(finalNow.getTime() + delaySeconds * 1000)
          : null;
        const failureCode = canRetry
          ? 'PROVIDER_TRANSIENT'
          : transient
            ? 'PROVIDER_TRANSIENT_MAX_ATTEMPTS'
            : 'PROVIDER_PERMANENT';
        const marked = await this.outbox.markFailed(
          row.id,
          row.claimToken,
          finalNow,
          {
            code: failureCode,
            retryAt,
          },
        );
        if (marked && canRetry) result.retried += 1;
        if (marked && !canRetry) result.failed += 1;
        this.logger.warn(
          'worker.otp.delivery_failed',
          workerLogFields('worker.otp.delivery_failed', {
            jobRunId: row.id,
            providerCode: code,
            attempt: row.attemptCount,
            retry: canRetry,
            errorCode: failureCode,
          }),
        );
      }
    }
    return result;
  }
}
