import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser, EntraIdentity } from './authenticated-user.js';

export type EntraClaims = EntraIdentity;

@Injectable()
export class AuthService {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger(AuthService.name);

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
