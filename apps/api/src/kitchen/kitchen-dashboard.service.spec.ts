import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KitchenDashboardService } from './kitchen-dashboard.service.js';
import { KitchenEventsService } from './kitchen-events.service.js';

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
    it('computes counters and separates served vs pending lists accurately', async () => {
      const targetDate = '2026-09-03';
      const mockRegistrations = [
        {
          id: 'reg-1',
          userId: 'user-1',
          status: 'ACTIVE',
          user: { name: 'Nguyen Van A', email: 'a@example.com' },
          mealServing: {
            id: 'srv-1',
            servedAt: new Date('2026-09-03T11:30:00Z'),
          },
          delegations: [],
        },
        {
          id: 'reg-2',
          userId: 'user-2',
          status: 'ACTIVE',
          user: { name: 'Tran Thi B', email: 'b@example.com' },
          mealServing: null,
          delegations: [],
        },
        {
          id: 'reg-3',
          userId: 'user-3',
          status: 'ACTIVE',
          user: { name: 'Le Van C', email: 'c@example.com' },
          mealServing: null,
          delegations: [],
        },
      ];

      mockPrisma.registration.findMany
        .mockResolvedValueOnce(mockRegistrations)
        .mockResolvedValueOnce([
          {
            id: 'reg-noshow',
            userId: 'user-4',
            status: 'NO_SHOW',
            user: { name: 'Pham Van D', email: 'd@example.com' },
          },
        ]);
      mockPrisma.appSetting.findUnique.mockResolvedValueOnce({ value: 'true' });
      mockPrisma.mealServing.findMany.mockResolvedValueOnce([
        {
          id: 'srv-1',
          registrationId: 'reg-1',
          servedAt: new Date('2026-09-03T11:30:00Z'),
          registration: {
            userId: 'user-1',
            user: { name: 'Nguyen Van A', email: 'a@example.com' },
            delegations: [],
          },
        },
      ]);

      const snapshot = await service.getDashboardSnapshot(targetDate);

      expect(snapshot.date).toBe(targetDate);
      expect(snapshot.isServingReady).toBe(true);
      expect(snapshot.counters.totalRegistered).toBe(3);
      expect(snapshot.counters.servedTotal).toBe(1);
      expect(snapshot.counters.remaining).toBe(2);
      expect(snapshot.counters.noShowTotal).toBe(1);

      expect(snapshot.lists.served).toHaveLength(1);
      expect(snapshot.lists.served[0].registrationId).toBe('reg-1');
      expect(snapshot.lists.pending).toHaveLength(2);
      expect(snapshot.lists.all).toHaveLength(3);
      expect(snapshot.lists.noShow).toHaveLength(1);
      expect(snapshot.lists.noShow[0].userName).toBe('Pham Van D');

      expect(snapshot.recentLogs).toHaveLength(1);
      expect(snapshot.recentLogs[0].userName).toBe('Nguyen Van A');
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
    it('deduplicates events by eventId and suppresses duplicate broadcast', () => {
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

    it('notifyServingConfirmed emits snapshot counters to synchronize all devices', async () => {
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      vi.spyOn(service, 'getDashboardSnapshot').mockResolvedValueOnce({
        date: '2026-09-03',
        isServingReady: true,
        counters: {
          totalRegistered: 10,
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
