import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenEventsService } from './kitchen-events.service.js';
import type { SseMessageEvent } from './kitchen-events.service.js';
import { KitchenDashboardService } from './kitchen-dashboard.service.js';

const mockPrisma = {
  registration: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  mealServing: {
    findMany: vi.fn(),
  },
  appSetting: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  mealDay: {
    updateMany: vi.fn(),
  },
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
  };
});

describe('KitchenDashboardService', () => {
  let service: KitchenDashboardService;
  let eventsService: KitchenEventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventsService = new KitchenEventsService();
    service = new KitchenDashboardService(eventsService);
  });

  describe('getDashboardSnapshot', () => {
    const targetDate = '2026-09-03';
    const serving = (
      id: string,
      ownerNameSnapshot: string | null = null,
    ) => ({
      id,
      registrationId: id.replace('srv-', 'reg-'),
      ownerNameSnapshot,
      ownerEmailSnapshot: ownerNameSnapshot
        ? `${ownerNameSnapshot.toLowerCase().replaceAll(' ', '.')}@example.com`
        : null,
      locationShortCode: 'SERVING',
      locationNameSnapshot: 'Approved Kitchen',
      locationAddressSnapshot: 'Approved address',
      menuRevisionId: 'serving-revision',
      menuNameSnapshot: 'Lunch',
      menuDescriptionSnapshot: 'Lunch menu',
      menuImageSnapshot: 'https://example.test/lunch.jpg',
      servedAt: new Date('2026-09-03T11:30:00Z'),
    });
    const registration = (overrides: Record<string, unknown>) => ({
      id: 'reg-default',
      userId: 'user-default',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      user: {
        name: 'Default User',
        email: 'default@example.com',
        isActive: true,
      },
      mealServing: null,
      delegations: [],
      ...overrides,
    });
    const configure = (rows: unknown[], recentRows: unknown[] = []) => {
      mockPrisma.registration.findMany.mockResolvedValueOnce(rows);
      mockPrisma.appSetting.findUnique.mockResolvedValueOnce({ value: 'true' });
      mockPrisma.mealServing.findMany.mockResolvedValueOnce(recentRows);
    };

    it('keeps_served_rows_in_total_and_served_list', async () => {
      const activeServed = registration({
        id: 'reg-active-served',
        userId: 'user-active-served',
        mealChoice: 'VEGETARIAN',
        user: {
          name: 'Active Served',
          email: 'active-served@example.com',
          isActive: true,
        },
        mealServing: serving('srv-active-served', 'Serving Snapshot Owner'),
      });
      const legacyServed = registration({
        id: 'reg-legacy-served',
        userId: 'user-legacy-served',
        status: 'SERVED',
        mealServing: serving('srv-legacy-served'),
      });
      configure([activeServed, legacyServed]);

      const snapshot = await service.getDashboardSnapshot(targetDate);

      expect(snapshot.counters.totalRegistered).toBe(2);
      expect(snapshot.counters.servedTotal).toBe(2);
      expect(snapshot.counters.remaining).toBe(0);
      expect(snapshot.lists.served.map((item) => item.registrationId)).toEqual([
        'reg-active-served',
        'reg-legacy-served',
      ]);
      expect(snapshot.lists.all).toHaveLength(2);
      expect(snapshot.lists.served[0].userName).toBe('Serving Snapshot Owner');
      expect(snapshot.lists.served[0].state).toBe('SERVED');
    });
    it('uses serving owner snapshots for recent serving logs', async () => {
      const row = registration({
        id: 'reg-serving-log',
        serviceLocationCode: 'REGISTRATION',
        serviceLocationName: 'Mutable current location',
        serviceLocationAddress: 'Mutable current address',
        menuRevisionId: 'registration-revision',
        menuNameSnapshot: 'Mutable current menu',
        mealServing: serving('srv-serving-log', 'Serving Snapshot Owner'),
      });
      configure(
        [row],
        [
          {
            ...serving('srv-serving-log', 'Serving Snapshot Owner'),
            registration: {
              userId: 'user-current',
              mealChoice: 'REGULAR',
              serviceLocationCode: 'REGISTRATION',
              serviceLocationName: 'Mutable current location',
              serviceLocationAddress: 'Mutable current address',
              menuRevisionId: 'registration-revision',
              menuNameSnapshot: 'Mutable current menu',
              user: {
                name: 'Current User Name',
                email: 'current@example.com',
              },
              delegations: [],
            },
          },
        ],
      );

      const snapshot = await service.getDashboardSnapshot(targetDate);

      expect(snapshot.recentLogs[0]).toMatchObject({
        userName: 'Serving Snapshot Owner',
        userEmail: 'serving.snapshot.owner@example.com',
      });
    });

    it('counts_no_show_without_pending_membership', async () => {
      const pending = registration({ id: 'reg-pending' });
      const noShow = registration({
        id: 'reg-no-show',
        userId: 'user-no-show',
        status: 'NO_SHOW',
        mealChoice: 'VEGETARIAN',
        user: {
          name: 'No Show',
          email: 'no-show@example.com',
          isActive: true,
        },
      });
      configure([pending, noShow]);

      const snapshot = await service.getDashboardSnapshot(targetDate);

      expect(snapshot.counters.totalRegistered).toBe(2);
      expect(snapshot.counters.noShowTotal).toBe(1);
      expect(snapshot.counters.remaining).toBe(1);
      expect(snapshot.lists.pending.map((item) => item.registrationId)).toEqual([
        'reg-pending',
      ]);
      expect(snapshot.lists.noShow.map((item) => item.registrationId)).toEqual([
        'reg-no-show',
      ]);
      expect(snapshot.lists.noShow[0]).toMatchObject({
        state: 'NO_SHOW',
        isServed: false,
        servedAt: null,
      });
      expect(snapshot.lists.all).toHaveLength(2);
    });

    it('excludes_cancelled_and_account_disabled_rows', async () => {
      configure([
        registration({ id: 'reg-valid' }),
        registration({
          id: 'reg-cancelled',
          status: 'CANCELLED',
          userId: 'user-cancelled',
        }),
        registration({
          id: 'reg-disabled',
          userId: 'user-disabled',
          user: {
            name: 'Disabled',
            email: 'disabled@example.com',
            isActive: false,
          },
        }),
      ]);

      const snapshot = await service.getDashboardSnapshot(targetDate);

      expect(snapshot.counters.totalRegistered).toBe(1);
      expect(snapshot.counters.regularTotal).toBe(1);
      expect(snapshot.lists.all.map((item) => item.registrationId)).toEqual([
        'reg-valid',
      ]);
      expect(snapshot.lists.noShow).toEqual([]);
    });

    it('sets_state_and_isServed_consistently', async () => {
      configure([
        registration({ id: 'reg-pending' }),
        registration({
          id: 'reg-served',
          mealServing: serving('srv-served'),
        }),
        registration({
          id: 'reg-no-show',
          status: 'NO_SHOW',
        }),
      ]);

      const snapshot = await service.getDashboardSnapshot(targetDate);

      for (const item of snapshot.lists.all) {
        expect(item.isServed).toBe(item.state === 'SERVED');
      }
      expect(snapshot.lists.pending[0].state).toBe('PENDING');
      expect(snapshot.lists.served[0].state).toBe('SERVED');
      expect(snapshot.lists.noShow[0].state).toBe('NO_SHOW');
      expect(
        snapshot.counters.servedTotal +
          snapshot.lists.pending.length +
          snapshot.counters.noShowTotal,
      ).toBe(snapshot.counters.totalRegistered);
      expect(
        snapshot.counters.regularTotal + snapshot.counters.vegetarianTotal,
      ).toBe(snapshot.counters.totalRegistered);
      expect(snapshot.counters.remaining).toBe(
        snapshot.lists.pending.length,
      );
    });

    it('rejects_state_serving_mismatch_with_internal_error_envelope', async () => {
      configure([
        registration({
          id: 'reg-invalid',
          status: 'SERVED',
          mealServing: null,
        }),
      ]);

      await expect(service.getDashboardSnapshot(targetDate)).rejects.toMatchObject(
        {
          response: {
            statusCode: 500,
            message: 'Internal server error',
          },
          status: 500,
        },
      );
      expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
    });

    it('rejects no-show and cancelled rows with servings', async () => {
      for (const status of ['NO_SHOW', 'CANCELLED']) {
        vi.clearAllMocks();
        configure([
          registration({
            id: `reg-invalid-${status.toLowerCase()}`,
            status,
            mealServing: serving(`srv-invalid-${status.toLowerCase()}`),
          }),
        ]);

        await expect(service.getDashboardSnapshot(targetDate)).rejects.toThrow(
          'Internal server error',
        );
      }
    });

    it('uses one registration query for the canonical projection', async () => {
      configure([registration({ id: 'reg-one-query' })]);

      await service.getDashboardSnapshot(targetDate);

      expect(mockPrisma.registration.findMany).toHaveBeenCalledTimes(1);
      const query = mockPrisma.registration.findMany.mock.calls[0][0];
      expect(query.where).toEqual({
        mealDate: new Date('2026-09-03T00:00:00Z'),
        OR: [
          { status: { in: ['ACTIVE', 'SERVED', 'NO_SHOW'] } },
          { status: 'CANCELLED', mealServing: { isNot: null } },
        ],
      });
      expect(query.include).toEqual({
        user: true,
        mealServing: true,
        delegations: true,
      });
      expect(query.orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
    });
  });

  describe('toggleServingSignal', () => {
    it('updates appSetting and emits KITCHEN_SIGNAL_CHANGED realtime event', async () => {
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      mockPrisma.appSetting.upsert.mockResolvedValueOnce({
        key: 'isServingReady:2026-09-03',
        value: 'true',
      });
      mockPrisma.mealDay.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.toggleServingSignal('2026-09-03', true);

      expect(result.success).toBe(true);
      expect(result.isServingReady).toBe(true);
      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'isServingReady:2026-09-03' },
          update: { value: 'true' },
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'KITCHEN_SIGNAL_CHANGED',
          mealDate: '2026-09-03',
          payload: { isServingReady: true, date: '2026-09-03' },
        }),
      );
    });
  });

  describe('events stream and deduplication', () => {
    it('duplicate_event_id_is_dropped_by_KitchenEventsService', () => {
      const receivedEvents: any[] = [];
      const sub = eventsService.getEvents$('2026-09-03').subscribe((e) => {
        if (e.type !== 'HEARTBEAT') receivedEvents.push(e);
      });

      const event1 = eventsService.emitEvent({
        eventId: 'evt-unique-1',
        eventType: 'SERVING_CONFIRMED',
        mealDate: '2026-09-03',
        payload: { count: 1 },
      });

      expect(event1.eventId).toBe('evt-unique-1');
      expect(eventsService.isDuplicate('evt-unique-1')).toBe(true);
      expect(eventsService.isDuplicate('evt-non-existent')).toBe(false);

      // Attempt to emit the exact same eventId again
      const event2 = eventsService.emitEvent({
        eventId: 'evt-unique-1',
        eventType: 'SERVING_CONFIRMED',
        mealDate: '2026-09-03',
        payload: { count: 1 },
      });

      expect(event2.eventId).toBe('evt-unique-1');
      // Subscriber must have received only the first event!
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].data.eventId).toBe('evt-unique-1');

      sub.unsubscribe();
    });

    it('delivers realtime event to multiple connected kitchen devices consistently', async () => {
      const device1Events: any[] = [];
      const device2Events: any[] = [];

      const sub1 = eventsService.getEvents$('2026-09-03').subscribe((e) => {
        if (e.type !== 'HEARTBEAT') device1Events.push(e);
      });
      const sub2 = eventsService.getEvents$('2026-09-03').subscribe((e) => {
        if (e.type !== 'HEARTBEAT') device2Events.push(e);
      });

      eventsService.emitEvent({
        eventId: 'evt-sync-test',
        eventType: 'SERVING_CONFIRMED',
        mealDate: '2026-09-03',
        payload: { servedCount: 1 },
      });

      expect(device1Events).toHaveLength(1);
      expect(device2Events).toHaveLength(1);
      expect(device1Events[0].data.eventId).toBe('evt-sync-test');
      expect(device2Events[0].data.eventId).toBe('evt-sync-test');
      expect(device1Events[0].data.payload).toEqual(
        device2Events[0].data.payload,
      );

      sub1.unsubscribe();
      sub2.unsubscribe();
    });
    it('emits heartbeat messages for connected kitchen devices', async () => {
      vi.useFakeTimers();
      const receivedEvents: SseMessageEvent[] = [];
      const sub = eventsService.getEvents$('2026-09-03').subscribe((event) => {
        receivedEvents.push(event);
      });

      try {
        await vi.advanceTimersByTimeAsync(15000);

        expect(receivedEvents).toHaveLength(1);
        expect(receivedEvents[0]).toMatchObject({
          type: 'HEARTBEAT',
          data: { type: 'heartbeat' },
        });
        expect(receivedEvents[0].data).toMatchObject({
          timestamp: expect.any(String),
        });
      } finally {
        sub.unsubscribe();
        vi.useRealTimers();
      }
    });


    it('notifyServingConfirmed emits snapshot counters to synchronize all devices', async () => {
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      vi.spyOn(service, 'getDashboardSnapshot').mockResolvedValueOnce({
        date: '2026-09-03',
        isServingReady: true,
        counters: {
          totalRegistered: 10,
          regularTotal: 7,
          vegetarianTotal: 3,
          servedTotal: 7,
          remaining: 3,
          noShowTotal: 0,
        },
        recentLogs: [
          {
            id: 'log-1',
            registrationId: 'reg-1',
            userId: 'user-1',
            userName: 'Nguyen Van A',
            userEmail: 'a@example.com',
            mealChoice: 'REGULAR',
            servedAt: '2026-09-03T11:00:00.000Z',
            isProxy: false,
          },
        ],
        lists: { served: [], pending: [], all: [], noShow: [] },
      });

      await service.notifyServingConfirmed('2026-09-03', [{ id: 'srv-1' }]);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SERVING_CONFIRMED',
          mealDate: '2026-09-03',
          payload: expect.objectContaining({
            counters: expect.objectContaining({ servedTotal: 7, remaining: 3 }),
            recentLogs: expect.any(Array),
          }),
        }),
      );
    });
  });
});
