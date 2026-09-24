import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { KitchenDashboardService } from './kitchen-dashboard.service.js';
import { KitchenEventsService } from './kitchen-events.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermission } from '../auth/require-permission.decorator.js';

@Controller(['v1/kitchen', 'api/kitchen'])
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermission('kitchen.serve')
export class KitchenDashboardController {
  constructor(
    private readonly dashboardService: KitchenDashboardService,
    private readonly eventsService: KitchenEventsService,
  ) {}

  @Get('days/:date/dashboard')
  async getDashboard(@Param('date') date: string) {
    return this.dashboardService.getDashboardSnapshot(date);
  }

  @Get('today/dashboard')
  async getTodayDashboard() {
    return this.dashboardService.getDashboardSnapshot();
  }

  @Sse('days/:date/events')
  streamEvents(@Param('date') date: string): Observable<MessageEvent> {
    return this.eventsService.getEvents$(
      date,
    ) as unknown as Observable<MessageEvent>;
  }

  @Sse('events')
  streamAllEvents(): Observable<MessageEvent> {
    return this.eventsService.getEvents$() as unknown as Observable<MessageEvent>;
  }

  @Post('days/:date/signal')
  async setServingSignal(
    @Param('date') date: string,
    @Body() body: { isServingReady: boolean },
  ) {
    return this.dashboardService.toggleServingSignal(date, body.isServingReady);
  }

  @Post('signal')
  async setTodayServingSignal(@Body() body: { isServingReady: boolean }) {
    return this.dashboardService.toggleServingSignal(
      undefined,
      body.isServingReady,
    );
  }
}
