import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminUsersService } from './admin-users.service.js';

@Controller(['v1/admin/users', 'admin/users'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('user.manage')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(v1.AdminUserListQuerySchema))
    query: v1.AdminUserListQuery,
  ) {
    return this.service.list(query);
  }

  @Get(':userId')
  detail(@Param('userId') userId: string) {
    return this.service.detail(userId);
  }

  @Put(':userId/roles')
  updateRoles(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(v1.AdminUserRolesUpdateRequestSchema))
    body: v1.AdminUserRolesUpdateRequest,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateRoles(userId, body.roles, actor.id);
  }

  @Post(':userId/disable/preview')
  previewDisable(@Param('userId') userId: string) {
    return this.service.previewDisable(userId);
  }

  @Post(':userId/disable')
  disable(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(v1.AdminUserDisableRequestSchema))
    _body: v1.AdminUserDisableRequest,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.disable(userId, actor.id);
  }

  @Post(':userId/enable')
  enable(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(v1.AdminUserEnableRequestSchema))
    _body: v1.AdminUserEnableRequest,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.enable(userId, actor.id);
  }

  @Get(':userId/sessions')
  sessions(
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(v1.AdminUserSessionsQuerySchema))
    query: v1.AdminUserSessionsQuery,
  ) {
    return this.service.sessions(userId, query);
  }

  @Post(':userId/sessions/revoke-all')
  revokeAllSessions(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(v1.AdminUserRevokeAllRequestSchema))
    _body: v1.AdminUserRevokeAllRequest,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.revokeAllSessions(userId, actor.id);
  }

  @Get(':userId/audit')
  audit(
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(v1.AdminUserAuditQuerySchema))
    query: v1.AdminUserAuditQuery,
  ) {
    return this.service.audit(userId, query);
  }
}
