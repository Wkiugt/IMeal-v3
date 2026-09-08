import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser, EntraIdentity } from './authenticated-user.js';
import { type LocalAuthAccount, readLocalAuthAccounts } from './local-auth.js';

const LOCAL_AUTH_JWT_EXPIRY = '12h';

export type EntraClaims = EntraIdentity;

function localUserId(account: LocalAuthAccount): string {
  return `local-${account.role}-${account.username.toLowerCase()}`;
}

function localAuthSecret(): string {
  const secret = process.env.LOCAL_AUTH_JWT_SECRET?.trim();
  if (!secret) throw new Error('LOCAL_AUTH_JWT_SECRET is not configured');
  return secret;
}

@Injectable()
export class AuthService {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtService = new JwtService();

  async authenticateLocal(
    username: string,
    password: string,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const account = readLocalAuthAccounts().find(
      (candidate) =>
        candidate.username.toLowerCase() === username.toLowerCase(),
    );
    if (!account || account.password !== password) {
      throw new UnauthorizedException('Invalid local credentials');
    }

    const user = await this.provisionLocalUser(account);
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, authType: 'local' },
      { secret: localAuthSecret(), expiresIn: LOCAL_AUTH_JWT_EXPIRY },
    );
    return { accessToken, user };
  }

  private async provisionLocalUser(
    account: LocalAuthAccount,
  ): Promise<AuthenticatedUser> {
    const userId = localUserId(account);
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { id: userId },
        update: { email: account.email, name: account.name },
        create: {
          id: userId,
          email: account.email,
          name: account.name,
          isActive: true,
        },
      });
      const role = await tx.role.upsert({
        where: { name: account.role },
        update: {},
        create: { name: account.role },
      });
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: role.id,
        },
      });
    });
    return this.getPrincipal(userId);
  }

  async provisionUser(claims: EntraClaims): Promise<AuthenticatedUser> {
    try {
      const email = claims.email.trim().toLowerCase();
      const user = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { id: claims.userId },
        });
        if (existing) {
          const [accountState] = await tx.$queryRaw<
            Array<{ is_active: boolean }>
          >`SELECT "is_active" FROM "users" WHERE "id" = ${claims.userId}`;
          if (!accountState?.is_active) {
            throw new ForbiddenException('IMeal account is disabled');
          }
        }

        const upsertedUser = await tx.user.upsert({
          where: { id: claims.userId },
          update: {
            email,
            name: claims.name,
          },
          create: {
            id: claims.userId,
            email,
            name: claims.name,
          },
        });

        if (!existing) {
          const staffRole = await tx.role.upsert({
            where: { name: 'staff' },
            update: {},
            create: { name: 'staff' },
          });
          await tx.userRole.upsert({
            where: {
              userId_roleId: {
                userId: upsertedUser.id,
                roleId: staffRole.id,
              },
            },
            update: {},
            create: {
              userId: upsertedUser.id,
              roleId: staffRole.id,
            },
          });
        }

        return upsertedUser;
      });

      return this.getPrincipal(user.id);
    } catch (error) {
      this.logger.error(`Error provisioning user: ${String(error)}`);
      throw error;
    }
  }

  async getPrincipal(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
        userPermissions: {
          include: { permission: true },
        },
      },
    });

    const [accountState] = await this.prisma.$queryRaw<
      Array<{ is_active: boolean }>
    >`SELECT "is_active" FROM "users" WHERE "id" = ${userId}`;
    if (!user || !accountState?.is_active) {
      throw new ForbiddenException('IMeal account is disabled');
    }

    const roles = user.userRoles.map(({ role }) => role.name);
    const permissions = new Set(
      user.userRoles.flatMap(({ role }) =>
        role.rolePermissions.map(({ permission }) => permission.name),
      ),
    );
    for (const { permission } of user.userPermissions) {
      permissions.add(permission.name);
    }

    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      name: user.name ?? undefined,
      roles,
      permissions: [...permissions],
    };
  }
}
