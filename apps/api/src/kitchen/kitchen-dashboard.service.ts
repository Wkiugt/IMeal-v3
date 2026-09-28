import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { v1 } from '@imeal/contracts';
import { KitchenEventsService } from './kitchen-events.service.js';

@Injectable()
export class KitchenDashboardService {
  private readonly logger = new Logger(KitchenDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventsService?: KitchenEventsService,
  ) {}

  getTodayDateStr(): string {
    const now = new Date();
    // Assuming VN time (UTC+7)
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnTime.toISOString().split('T')[0];
  }

  parseDate(dateStr?: string): { dateObj: Date; dateStr: string } {
    const targetStr = dateStr || this.getTodayDateStr();
    return {
      dateObj: new Date(`${targetStr}T00:00:00Z`),
      dateStr: targetStr,
    };
  }

  async getDashboardSnapshot(dateInput?: string) {
    const { dateObj, dateStr } = this.parseDate(dateInput);

    // Include cancelled rows with servings only so their invariant can be
    // detected before valid cancelled rows are excluded from the projection.
    const registrations = await this.prisma.registration.findMany({
      where: {
        mealDate: dateObj,
        OR: [
          { status: { in: ['ACTIVE', 'SERVED', 'NO_SHOW'] } },
          {
            status: 'CANCELLED',
            mealServing: { isNot: null },
          },
        ],
      },
      include: {
        user: true,
        mealServing: true,
        delegations: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const registration of registrations) {
      const hasServing = registration.mealServing != null;
      const invalid =
        (registration.status === 'SERVED' && !hasServing) ||
        (registration.status === 'NO_SHOW' && hasServing) ||
        (registration.status === 'CANCELLED' && hasServing);
      if (invalid) {
        this.logger.error(
          `Kitchen dashboard state invariant violated for registration ${registration.id}`,
        );
        throw new InternalServerErrorException('Internal server error');
      }
    }

    // Account-disabled rows and valid cancelled rows remain out of the public
    // projection after invariant checks.
    const projectionRows = registrations.filter(
      (registration) =>
        registration.status !== 'CANCELLED' &&
        registration.user?.isActive !== false,
    );

    const kitchenSignal = await this.prisma.appSetting.findUnique({
      where: { key: `isServingReady:${dateStr}` },
    });
    const isServingReady = kitchenSignal?.value === 'true';

    const toState = (registration: (typeof projectionRows)[number]) => {
      if (registration.mealServing != null) return 'SERVED' as const;
      if (registration.status === 'NO_SHOW') return 'NO_SHOW' as const;
      return 'PENDING' as const;
    };
    const toItem = (registration: (typeof projectionRows)[number]) => {
      const serving = registration.mealServing ?? null;
      const state = toState(registration);
      return {
        registrationId: registration.id,
        userId: registration.userId,
        userName:
          serving?.ownerNameSnapshot ??
          registration.user?.name ??
          registration.user?.email ??
          'N/A',
        mealChoice: registration.mealChoice,
        userEmail:
          serving?.ownerEmailSnapshot ?? registration.user?.email ?? '',
        state,
        isServed: state === 'SERVED',
        servedAt: serving?.servedAt?.toISOString() ?? null,
      };
    };

    const allList = projectionRows.map(toItem);
    const servedList = projectionRows
      .filter((registration) => registration.mealServing != null)
      .map(toItem);
    const pendingList = projectionRows
      .filter(
        (registration) =>
          registration.status === 'ACTIVE' && registration.mealServing == null,
      )
      .map(toItem);
    const noShowList = projectionRows
      .filter(
        (registration) =>
          registration.status === 'NO_SHOW' && registration.mealServing == null,
      )
      .map(toItem);

    const totalRegistered = projectionRows.length;
    const servedTotal = servedList.length;
    const noShowTotal = noShowList.length;
    const remaining = pendingList.length;
    const regularTotal = projectionRows.filter(
      (registration) => registration.mealChoice === 'REGULAR',
    ).length;
    const vegetarianTotal = projectionRows.filter(
      (registration) => registration.mealChoice === 'VEGETARIAN',
    ).length;
    if (
      regularTotal + vegetarianTotal !== totalRegistered ||
      totalRegistered !== servedTotal + remaining + noShowTotal
    ) {
      throw new InternalServerErrorException('Internal server error');
    }

    const recentServings = await this.prisma.mealServing.findMany({
      where: {
        registration: {
          mealDate: dateObj,
        },
      },
      include: {
        registration: {
          include: {
            user: true,
            delegations: true,
          },
        },
      },
      orderBy: { servedAt: 'desc' },
      take: 50,
    });

    const recentLogs = recentServings.map((serving) => {
      const registration = serving.registration;
      const isProxy =
        registration.delegations?.some(
          (delegation) =>
            delegation.status === 'COMPLETED' ||
            delegation.status === 'ACCEPTED',
        ) || false;
      return {
        id: serving.id,
        registrationId: serving.registrationId,
        userId: registration.userId,
        userName:
          serving.ownerNameSnapshot ??
          registration.ownerNameSnapshot ??
          registration.user?.name ??
          registration.user?.email ??
          'N/A',
        userEmail: serving.ownerEmailSnapshot ?? registration.user?.email ?? '',
        mealChoice: registration.mealChoice,
        servedAt: serving.servedAt.toISOString(),
        isProxy,
      };
    });

    return v1.KitchenDashboardSnapshotSchema.parse({
      date: dateStr,
      isServingReady,
      counters: {
        totalRegistered,
        regularTotal,
        vegetarianTotal,
        servedTotal,
        remaining,
        noShowTotal,
      },
      recentLogs,
      lists: {
        served: servedList,
        pending: pendingList,
        all: allList,
        noShow: noShowList,
      },
    });
  }

  async toggleServingSignal(dateInput?: string, isReady: boolean = true) {
    const { dateObj, dateStr } = this.parseDate(dateInput);

    const settingKey = `isServingReady:${dateStr}`;
    await this.prisma.appSetting.upsert({
      where: { key: settingKey },
      update: { value: isReady ? 'true' : 'false' },
      create: { key: settingKey, value: isReady ? 'true' : 'false' },
    });

    // Also update mealDay if exists
    try {
      await this.prisma.mealDay.updateMany({
        where: {
          dailyMenu: { date: dateObj },
        },
        data: { isServingReady: isReady },
      });
    } catch {
      // Ignored if mealDay record does not exist
    }

    if (this.eventsService) {
      this.eventsService.emitEvent({
        eventType: 'KITCHEN_SIGNAL_CHANGED',
        mealDate: dateStr,
        payload: {
          isServingReady: isReady,
          date: dateStr,
        },
      });
    }

    return {
      success: true,
      isServingReady: isReady,
      date: dateStr,
    };
  }

  async notifyServingConfirmed(dateStr: string, servings: any[]) {
    if (!this.eventsService) return;

    try {
      const snapshot = await this.getDashboardSnapshot(dateStr);
      this.eventsService.emitEvent({
        eventType: 'SERVING_CONFIRMED',
        mealDate: dateStr,
        payload: {
          servings,
          counters: snapshot.counters,
          recentLogs: snapshot.recentLogs.slice(0, 10),
        },
      });
    } catch (err) {
      console.warn('Failed to publish serving confirmed event:', err);
    }
  }
}
