import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './authenticated-user.js';
import { isTestAuthBypassEnabled } from '../config/environment.js';
import { PERMISSIONS_KEY } from './require-permission.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isTestAuthBypassEnabled()) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as
      AuthenticatedUser | undefined;
    return requiredPermissions.every((permission) =>
      user?.permissions.includes(permission),
    );
  }
}
