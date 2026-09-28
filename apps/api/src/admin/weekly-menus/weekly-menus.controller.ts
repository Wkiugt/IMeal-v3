import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WeeklyMenusService } from './weekly-menus.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import {
  CreateDraftSchema,
  UpdateDailyMenuSchema,
} from './dto/weekly-menus.schema.js';

@Controller('admin/weekly-menus')
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('menu.manage')
export class WeeklyMenusController {
  constructor(private readonly weeklyMenusService: WeeklyMenusService) {}

  @Get()
  async getWeeklyMenus() {
    return this.weeklyMenusService.getWeeklyMenus();
  }

  @Post('draft')
  async createDraft(@Body() body: unknown) {
    const parseResult = CreateDraftSchema.safeParse(body);
    if (!parseResult.success) {
      throw new HttpException(parseResult.error.errors, HttpStatus.BAD_REQUEST);
    }
    return this.weeklyMenusService.createDraft(parseResult.data.startDate);
  }

  @Put(':date')
  async updateDailyMenu(
    @Param('date') date: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const parseResult = UpdateDailyMenuSchema.safeParse(body);
    if (!parseResult.success) {
      throw new HttpException(parseResult.error.errors, HttpStatus.BAD_REQUEST);
    }
    return this.weeklyMenusService.updateDailyMenu(date, parseResult.data, actor.id);
  }

  @Post(':week_start/publish')
  async publishWeeklyMenu(
    @Param('week_start') weekStart: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.weeklyMenusService.publishWeeklyMenu(weekStart, actor.id);
  }
}
