import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import type { v1 } from '@imeal/contracts';
import { AllowlistService } from './allowlist.service.js';
import type {
  AuthenticatedUser,
  VerifiedOtpPrincipal,
} from './authenticated-user.js';

const OTP_INVALID_CODE = 'OTP_INVALID_OR_EXPIRED' as const;
const DEFAULT_EXPIRY_SECONDS = 10 * 60;
const DEFAULT_RESEND_SECONDS = 60;
const DEFAULT_ATTEMPT_LIMIT = 5;
const DEFAULT_RATE_WINDOW_SECONDS = 60 * 60;
const DEFAULT_ADDRESS_RATE_LIMIT = 5;
const DEFAULT_CLIENT_RATE_LIMIT = 20;

export interface OtpRequestContext {
  requestId?: string;
  clientIp?: string;
  clientFingerprint?: string;
  now?: Date;
}

export type OtpVerifyContext = OtpRequestContext;

export interface OtpServiceConfig {
  expirySeconds: number;
  resendSeconds: number;
  attemptLimit: number;
  rateWindowSeconds: number;
  addressRateLimit: number;
  clientRateLimit: number;
  hashSecret: string;
}

interface OtpFailure {
  failure: true;
  reason: 'INVALID_OR_EXPIRED';
}

interface OtpVerificationResult {
  principal?: VerifiedOtpPrincipal;
  failure?: OtpFailure;
}

function numericSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
): number {
  const value = env[name];
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function verifierSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.OTP_HASH_SECRET?.trim() || env.QR_SIGNING_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'test') {
    return 'test-only-otp-verifier-secret-32-characters';
  }
  throw new Error('OTP_HASH_SECRET is not configured');
}

export function hashOtpCode(
  code: string,
  normalizedEmail: string,
  purpose: v1.OtpPurpose,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${purpose}\n${normalizedEmail}\n${code}`, 'utf8')
    .digest('hex');
}

function hashMetadata(value: string | undefined, secret: string): string | null {
  if (!value?.trim()) return null;
  return createHash('sha256').update(`${secret}\n${value}`, 'utf8').digest('hex');
}


@Injectable()
export class OtpService {
  private readonly prisma = new PrismaClient();

  constructor(private readonly allowlistService: AllowlistService) {}

  getConfig(env: NodeJS.ProcessEnv = process.env): OtpServiceConfig {
    return {
      expirySeconds: numericSetting(
        env,
        'OTP_EXPIRY_SECONDS',
        DEFAULT_EXPIRY_SECONDS,
        1,
      ),
      resendSeconds: numericSetting(
        env,
        'OTP_RESEND_SECONDS',
        DEFAULT_RESEND_SECONDS,
        0,
      ),
      attemptLimit: numericSetting(
        env,
        'OTP_ATTEMPT_LIMIT',
        DEFAULT_ATTEMPT_LIMIT,
        1,
      ),
      rateWindowSeconds: numericSetting(
        env,
        'OTP_RATE_WINDOW_SECONDS',
        DEFAULT_RATE_WINDOW_SECONDS,
        1,
      ),
      addressRateLimit: numericSetting(
        env,
        'OTP_ADDRESS_RATE_LIMIT',
        DEFAULT_ADDRESS_RATE_LIMIT,
        1,
      ),
      clientRateLimit: numericSetting(
        env,
        'OTP_CLIENT_RATE_LIMIT',
        DEFAULT_CLIENT_RATE_LIMIT,
        1,
      ),
      hashSecret: verifierSecret(env),
    };
  }

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async request(
    input: v1.RequestOtpInput,
    context: OtpRequestContext = {},
  ): Promise<v1.RequestOtpResponse> {
    const now = context.now ?? new Date();
    const normalizedEmail = this.allowlistService.normalizeEmail(input.email);
    const requestId = context.requestId ?? randomUUID();
    const eligible = await this.allowlistService.findEligible(
      normalizedEmail,
      input.purpose,
      now,
    );

    if (!eligible) {
      await this.recordAudit(this.prisma, {
        action: 'OTP_REQUEST_REJECTED',
        result: 'NOT_ELIGIBLE',
        requestId,
        normalizedEmail,
      });
      return { accepted: true };
    }

    const config = this.getConfig();
    const clientIpHash = hashMetadata(context.clientIp, config.hashSecret);
    const clientFingerprintHash = hashMetadata(
      context.clientFingerprint,
      config.hashSecret,
    );

    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        const clientLockKeys = [
          clientIpHash,
          clientFingerprintHash,
        ]
          .filter((value): value is string => Boolean(value))
          .sort();
        if (clientLockKeys.length > 0) {
          for (const identityHash of clientLockKeys) {
            const lockKey = `otp-rate-limit:${input.purpose}:${identityHash}`;
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          }
        } else {
          await tx.$queryRaw`SELECT id FROM "otp_allowlists" WHERE id = ${eligible.id} FOR UPDATE`;
        }
      }
      const activeChallenge = await tx.otpChallenge.findFirst({
        where: {
          allowlistId: eligible.id,
          normalizedEmail,
          purpose: input.purpose,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeChallenge?.resendAfter && activeChallenge.resendAfter > now) {
        await this.recordAudit(tx, {
          userId: eligible.userId,
          action: 'OTP_REQUEST_THROTTLED',
          result: 'RESEND_THROTTLED',
          requestId,
          normalizedEmail,
        });
        return { accepted: true };
      }

      const windowStart = new Date(
        now.getTime() - config.rateWindowSeconds * 1000,
      );
      const addressCount = await tx.otpChallenge.count({
        where: {
          normalizedEmail,
          purpose: input.purpose,
          createdAt: { gte: windowStart },
        },
      });
      const clientCount = clientIpHash || clientFingerprintHash
        ? await tx.otpChallenge.count({
            where: {
              purpose: input.purpose,
              createdAt: { gte: windowStart },
              OR: [
                ...(clientIpHash ? [{ clientIpHash }] : []),
                ...(clientFingerprintHash ? [{ clientFingerprintHash }] : []),
              ],
            },
          })
        : 0;

      if (
        addressCount >= config.addressRateLimit ||
        clientCount >= config.clientRateLimit
      ) {
        await this.recordAudit(tx, {
          userId: eligible.userId,
          action: 'OTP_REQUEST_THROTTLED',
          result: 'RATE_LIMITED',
          requestId,
          normalizedEmail,
        });
        return { accepted: true };
      }

      const code = this.generateCode();
      const expiresAt = new Date(
        now.getTime() + config.expirySeconds * 1000,
      );
      const resendAfter = new Date(
        now.getTime() + config.resendSeconds * 1000,
      );
      const challenge = await tx.otpChallenge.create({
        data: {
          allowlistId: eligible.id,
          normalizedEmail,
          purpose: input.purpose,
          verifierHash: hashOtpCode(
            code,
            normalizedEmail,
            input.purpose,
            config.hashSecret,
          ),
          expiresAt,
          attemptLimit: config.attemptLimit,
          resendAfter,
          lastSentAt: now,
          clientFingerprintHash,
          clientIpHash,
          requestId,
        },
      });
      const audit = await this.recordAudit(tx, {
        userId: eligible.userId,
        action: 'OTP_REQUEST_ACCEPTED',
        result: 'ACCEPTED',
        requestId,
        normalizedEmail,
      });
      if (audit?.id && tx.otpChallenge.update) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { auditEventId: audit.id },
        });
      }
      await tx.otpDeliveryOutbox.create({
        data: {
          challengeId: challenge.id,
          providerPayloadRef: `otp-delivery:${challenge.id}:${randomUUID()}`,
        },
      });

      return { accepted: true };
    });
  }

  async verify(
    input: v1.VerifyOtpInput,
    context: OtpVerifyContext = {},
  ): Promise<VerifiedOtpPrincipal> {
    const now = context.now ?? new Date();
    const normalizedEmail = this.allowlistService.normalizeEmail(input.email);
    const requestId = context.requestId ?? randomUUID();
    const config = this.getConfig();
    const verifierHash = hashOtpCode(
      input.code,
      normalizedEmail,
      input.purpose,
      config.hashSecret,
    );

    const outcome = (await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: {
          normalizedEmail,
          purpose: input.purpose,
          allowlist: {
            state: 'ACTIVE',
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
        },
        include: {
          allowlist: {
            include: {
              user: {
                include: {
                  userRoles: {
                    include: {
                      role: {
                        include: {
                          rolePermissions: { include: { permission: true } },
                        },
                      },
                    },
                  },
                  userPermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!challenge) {
        await this.recordAudit(tx, {
          action: 'OTP_VERIFY_REJECTED',
          result: 'INVALID_OR_EXPIRED',
          requestId,
          normalizedEmail,
        });
        return { failure: true, reason: 'INVALID_OR_EXPIRED' } satisfies OtpFailure;
      }

      const challengeUser = challenge.allowlist?.user;
      if (!challengeUser || !challengeUser.isActive) {
        await this.recordAudit(tx, {
          userId: challenge.allowlist?.userId ?? undefined,
          action: 'OTP_VERIFY_REJECTED',
          result: 'INVALID_OR_EXPIRED',
          requestId,
          normalizedEmail,
        });
        return { failure: true, reason: 'INVALID_OR_EXPIRED' } satisfies OtpFailure;
      }

      const expired = challenge.expiresAt <= now;
      const exhausted = challenge.attemptCount >= challenge.attemptLimit;
      if (challenge.consumedAt || expired || exhausted) {
        await this.recordAudit(tx, {
          userId: challenge.allowlist.userId ?? undefined,
          action: 'OTP_VERIFY_REJECTED',
          result: 'INVALID_OR_EXPIRED',
          requestId,
          normalizedEmail,
        });
        return { failure: true, reason: 'INVALID_OR_EXPIRED' } satisfies OtpFailure;
      }

      if (challenge.verifierHash !== verifierHash) {
        await tx.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            expiresAt: { gt: now },
            attemptCount: { lt: challenge.attemptLimit },
          },
          data: { attemptCount: { increment: 1 } },
        });
        await this.recordAudit(tx, {
          userId: challenge.allowlist.userId ?? undefined,
          action: 'OTP_VERIFY_REJECTED',
          result: 'INVALID_OR_EXPIRED',
          requestId,
          normalizedEmail,
        });
        return { failure: true, reason: 'INVALID_OR_EXPIRED' } satisfies OtpFailure;
      }

      const consumed = await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          purpose: input.purpose,
          normalizedEmail,
          consumedAt: null,
          expiresAt: { gt: now },
          attemptCount: { lt: challenge.attemptLimit },
          verifierHash,
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        await this.recordAudit(tx, {
          userId: challenge.allowlist.userId ?? undefined,
          action: 'OTP_VERIFY_REJECTED',
          result: 'INVALID_OR_EXPIRED',
          requestId,
          normalizedEmail,
        });
        return { failure: true, reason: 'INVALID_OR_EXPIRED' } satisfies OtpFailure;
      }

      const principal = this.principalFromUser(
        challengeUser,
        challenge.id,
        requestId,
      );
      await this.recordAudit(tx, {
        userId: challenge.allowlist.userId ?? undefined,
        action: 'OTP_VERIFY_ACCEPTED',
        result: 'ACCEPTED',
        requestId,
        normalizedEmail,
      });
      return { principal } satisfies OtpVerificationResult;
    })) as OtpVerificationResult;

    if (outcome.failure || !outcome.principal) {
      throw new UnauthorizedException({
        code: OTP_INVALID_CODE,
        message: 'The verification code is invalid or expired.',
      });
    }
    return outcome.principal;
  }

  private principalFromUser(
    user: {
      id: string;
      email: string;
      name: string | null;
      userRoles?: Array<{
        role: {
          name: string;
          rolePermissions?: Array<{ permission: { name: string } }>;
        };
      }>;
      userPermissions?: Array<{ permission: { name: string } }>;
    },
    challengeId: string,
    requestId: string,
  ): VerifiedOtpPrincipal {
    const roles = (user.userRoles ?? []).map(({ role }) => role.name);
    const permissions = new Set(
      (user.userRoles ?? []).flatMap(({ role }) =>
        (role.rolePermissions ?? []).map(({ permission }) => permission.name),
      ),
    );
    for (const { permission } of user.userPermissions ?? []) {
      permissions.add(permission.name);
    }
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      userId: user.id,
      email: user.email,
      name: user.name ?? undefined,
      roles,
      permissions: [...permissions],
    };
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      challengeId,
      requestId,
      user: authenticatedUser,
    };
  }

  private async recordAudit(
    tx: {
      auditLog?: {
        create: (input: {
          data: {
            userId?: string;
            action: string;
            details: string;
          };
        }) => Promise<{ id: string }>;
      };
    },
    input: {
      userId?: string;
      action: string;
      result: string;
      requestId: string;
      normalizedEmail: string;
    },
  ): Promise<{ id: string } | null> {
    if (!tx.auditLog?.create) return null;
    const subjectHash = createHash('sha256')
      .update(input.normalizedEmail, 'utf8')
      .digest('hex');
    return tx.auditLog.create({
      data: {
        ...(input.userId ? { userId: input.userId } : {}),
        action: input.action,
        details: JSON.stringify({
          purpose: 'SESSION_LOGIN',
          result: input.result,
          requestId: input.requestId,
          subjectHash,
        }),
      },
    });
  }
}
