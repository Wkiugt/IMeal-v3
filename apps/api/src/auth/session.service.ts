import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { lockUserLifecycle } from '../common/transaction-locks.js';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from './authenticated-user.js';

const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_ABSOLUTE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_BYTES = 32;

export type SessionPurpose = 'SESSION_LOGIN';
export type SessionRevocationReason =
  | 'LOGOUT'
  | 'ACCOUNT_DISABLED'
  | 'COMPROMISED'
  | 'OTP_REPLAY'
  | 'ADMIN_REVOKED'
  | 'EXPIRED';

export interface SessionMetadata {
  deviceId?: string;
  clientIp?: string;
  userAgent?: string;
}

export interface SessionCreateInput {
  userId: string;
  purpose: SessionPurpose;
  requestId: string;
  metadata: SessionMetadata;
}

export interface SessionTimeoutConfig {
  idleTimeoutSeconds: number;
  absoluteTimeoutSeconds: number;
}

function timeoutSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const configured = env[name]?.trim();
  if (!configured) return fallback;

  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1`);
  }
  return value;
}

export function hashSessionToken(
  rawToken: string,
  secret = process.env.SESSION_HASH_SECRET?.trim(),
): string {
  return (secret ? createHmac('sha256', secret) : createHash('sha256'))
    .update(rawToken, 'utf8')
    .digest('hex');
}

function hashMetadata(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function expiresAtAfter(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  getConfig(env: NodeJS.ProcessEnv = process.env): SessionTimeoutConfig {
    return {
      idleTimeoutSeconds: timeoutSetting(
        env,
        'SESSION_IDLE_TIMEOUT_SECONDS',
        DEFAULT_IDLE_TIMEOUT_SECONDS,
      ),
      absoluteTimeoutSeconds: timeoutSetting(
        env,
        'SESSION_ABSOLUTE_TIMEOUT_SECONDS',
        DEFAULT_ABSOLUTE_TIMEOUT_SECONDS,
      ),
    };
  }

  async create(
    input: SessionCreateInput,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = new Date();
    const config = this.getConfig();
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const absoluteExpiresAt = expiresAtAfter(
      now,
      config.absoluteTimeoutSeconds,
    );
    const idleExpiresAt = new Date(
      Math.min(
        expiresAtAfter(now, config.idleTimeoutSeconds).getTime(),
        absoluteExpiresAt.getTime(),
      ),
    );
    const tokenHash = hashSessionToken(token);

    await this.prisma.$transaction(async (tx) => {
      await lockUserLifecycle(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, isActive: true },
      });
      if (!user?.isActive) {
        throw new UnauthorizedException({
          code: 'SESSION_INVALID',
          message: 'Invalid or expired session.',
        });
      }
      const audit = await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'SESSION_CREATED',
          details: JSON.stringify({
            purpose: input.purpose,
            authMethod: 'EMAIL_OTP',
            requestId: input.requestId,
          }),
        },
      });

      await tx.authSession.create({
        data: {
          userId: input.userId,
          tokenHash,
          purpose: input.purpose,
          authMethod: 'EMAIL_OTP',
          createdAt: now,
          lastUsedAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
          deviceIdHash: hashMetadata(input.metadata.deviceId),
          clientIpHash: hashMetadata(input.metadata.clientIp),
          userAgentHash: hashMetadata(input.metadata.userAgent),
          requestId: input.requestId,
          auditEventId: audit.id,
        },
      });
    });

    return { token, expiresAt: absoluteExpiresAt };
  }

  async resolve(rawToken: string): Promise<AuthenticatedUser | null> {
    const token = rawToken.trim();
    if (!token) return null;

    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
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
    });

    if (!session || session.revokedAt || !session.user) return null;

    const now = new Date();
    if (
      !session.user.isActive ||
      session.absoluteExpiresAt <= now ||
      (session.idleExpiresAt !== null && session.idleExpiresAt <= now)
    ) {
      await this.revoke(
        session.id,
        session.user.isActive ? 'EXPIRED' : 'ACCOUNT_DISABLED',
        session.requestId ?? `session-resolve:${session.id}`,
      );
      return null;
    }

    const config = this.getConfig();
    const idleExpiresAt = new Date(
      Math.min(
        expiresAtAfter(now, config.idleTimeoutSeconds).getTime(),
        session.absoluteExpiresAt.getTime(),
      ),
    );
    const refreshed = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
        OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }],
      },
      data: {
        lastUsedAt: now,
        idleExpiresAt,
      },
    });
    if (refreshed.count !== 1) return null;

    const roles = session.user.userRoles.map(({ role }) => role.name);
    const permissions = new Set(
      session.user.userRoles.flatMap(({ role }) =>
        role.rolePermissions.map(({ permission }) => permission.name),
      ),
    );
    for (const { permission } of session.user.userPermissions) {
      permissions.add(permission.name);
    }

    return {
      id: session.user.id,
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
      roles,
      permissions: [...permissions],
      isActive: true,
      sessionId: session.id,
    };
  }

  async revoke(
    sessionId: string,
    reason: SessionRevocationReason,
    requestId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      if (revoked.count === 0) return;

      await tx.auditLog.create({
        data: {
          action: 'SESSION_REVOKED',
          details: JSON.stringify({ sessionId, reason, requestId }),
        },
      });
    });
  }

  async revokeForUser(
    userId: string,
    reason: Exclude<SessionRevocationReason, 'EXPIRED'>,
    requestId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      if (revoked.count === 0) return;

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SESSION_REVOKED',
          details: JSON.stringify({ reason, requestId }),
        },
      });
    });
  }
}
