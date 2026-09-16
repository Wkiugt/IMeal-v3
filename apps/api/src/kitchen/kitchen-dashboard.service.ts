import { Injectable, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { KitchenEventsService } from './kitchen-events.service.js';

@Injectable()
export class KitchenDashboardService {
  private prisma: PrismaClient;

  constructor(
    @Optional() private readonly eventsService?: KitchenEventsService,
  ) {
    this.prisma = new PrismaClient();
  }

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

    // 1. Fetch active registrations for date
    const registrations = await this.prisma.registration.findMany({
      where: {
        mealDate: dateObj,
        status: 'ACTIVE',
      },
      include: {
        user: true,
        mealServing: true,
        delegations: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Fetch no-show registrations
    const noShowRegistrations =
      (await this.prisma.registration.findMany({
        where: {
          mealDate: dateObj,
          status: 'NO_SHOW',
        },
        include: {
          user: true,
        },
        orderBy: { createdAt: 'asc' },
      })) || [];
    const noShowCount = noShowRegistrations.length;

    // 3. Check Kitchen Signal state
    const kitchenSignal = await this.prisma.appSetting.findUnique({
      where: { key: `isServingReady:${dateStr}` },
    });
    const isServingReady = kitchenSignal?.value === 'true';
    // 4. Calculate counters from the same ACTIVE registration set.
    const totalRegistered = registrations.length;
    const servedTotal = registrations.filter(
      (r) => r.mealServing !== null,
    ).length;
    const remaining = Math.max(0, totalRegistered - servedTotal);
    const regularTotal = registrations.filter(
      (r) => r.mealChoice === 'REGULAR',
    ).length;
    const vegetarianTotal = registrations.filter(
      (r) => r.mealChoice === 'VEGETARIAN',
    ).length;
    if (regularTotal + vegetarianTotal !== totalRegistered) {
      throw new Error(
        'Kitchen dashboard meal-choice counters do not match active registrations',
      );
    }

    // 5. Build lists
    const servedList = registrations
      .filter((r) => r.mealServing !== null)
      .map((r) => ({
        registrationId: r.id,
        userId: r.userId,
        userName: r.user?.name || r.user?.email || 'N/A',
        userEmail: r.user?.email || '',
        mealChoice: r.mealChoice,
        isServed: true,
        servedAt: r.mealServing?.servedAt
          ? r.mealServing.servedAt.toISOString()
          : null,
      }));

    const pendingList = registrations
      .filter((r) => r.mealServing === null)
      .map((r) => ({
        registrationId: r.id,
        userId: r.userId,
        userName: r.user?.name || r.user?.email || 'N/A',
        mealChoice: r.mealChoice,
        userEmail: r.user?.email || '',
        isServed: false,
        servedAt: null,
      }));

    const allList = registrations.map((r) => ({
      registrationId: r.id,
      mealChoice: r.mealChoice,
      userId: r.userId,
      userName: r.user?.name || r.user?.email || 'N/A',
      userEmail: r.user?.email || '',
      isServed: r.mealServing !== null,
      servedAt: r.mealServing?.servedAt
        ? r.mealServing.servedAt.toISOString()
        : null,
    }));

    // 6. Recent Serving logs
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

    const recentLogs = recentServings.map((s) => {
      const isProxy =
        s.registration.delegations?.some(
          (d) => d.status === 'COMPLETED' || d.status === 'ACCEPTED',
        ) || false;
      return {
        id: s.id,
        registrationId: s.registrationId,
        userId: s.registration.userId,
        userName:
          s.registration.user?.name || s.registration.user?.email || 'N/A',
        userEmail: s.registration.user?.email || '',
        mealChoice: s.registration.mealChoice,
        servedAt: s.servedAt.toISOString(),
        isProxy,
      };
    });

    const noShowList = noShowRegistrations.map((r) => ({
      registrationId: r.id,
      userId: r.userId,
      userName: r.user?.name || r.user?.email || 'N/A',
      userEmail: r.user?.email || '',
      mealChoice: r.mealChoice,
      isServed: false,
      servedAt: null,
    }));

    return v1.KitchenDashboardSnapshotSchema.parse({
      date: dateStr,
      isServingReady,
      counters: {
        totalRegistered,
        regularTotal,
        vegetarianTotal,
        servedTotal,
        remaining,
        noShowTotal: noShowCount,
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
