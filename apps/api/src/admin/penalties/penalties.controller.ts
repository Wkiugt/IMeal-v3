import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PenaltiesService } from './penalties.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { v1 } from '@imeal/contracts';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';

@Controller(['v1/admin/penalties', 'admin/penalties'])
@UseGuards(SessionGuard, PermissionsGuard)
export class PenaltiesController {
  constructor(private readonly penaltiesService: PenaltiesService) {}

  @Get()
  @RequirePermission('penalty.read')
  async getPenalties(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = v1.PenaltyListQuerySchema.safeParse({
      status,
      search,
      startDate,
      endDate,
      page,
      limit,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors[0]?.message);
    }
    return this.penaltiesService.getPenalties(parsed.data);
  }

  @Post(':id/paid')
  @RequirePermission('penalty.resolve')
  async markAsPaid(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.penaltiesService.markAsPaid(id, user.id);
  }

  @Post(':id/waive')
  @RequirePermission('penalty.resolve')
  async waivePenalty(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parseResult = v1.WaivePenaltyDtoSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(
        parseResult.error.errors[0]?.message ||
          'Waive reason must be at least 5 characters long',
      );
    }
    return this.penaltiesService.waivePenalty(
      id,
      parseResult.data.reason,
      user.id,
    );
  }
}
