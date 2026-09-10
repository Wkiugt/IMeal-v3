import { PickupService } from './pickup.service.js';
import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { KitchenEventsService } from '../kitchen/kitchen-events.service.js';

const mockPrisma = {
  servingConfirmRequest: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  pickupSession: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mealServing: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  appSetting: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  mealDay: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
const ownPickupOption = {
  type: 'OWN',
  registrationId: 'reg1',
  mealDate: new Date('2026-09-04T00:00:00.000Z'),
};
const delegatedPickupOption = {
  type: 'DELEGATED',
  registrationId: 'reg2',
  delegationId: 'delegation-1',
  mealDate: new Date('2026-09-04T00:00:00.000Z'),
  owner: {
    id: 'owner-1',
    name: 'Meal Owner',
    email: 'owner@example.com',
  },
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
    Prisma: {
      join: vi.fn((arr) => arr),
    },
  };
});

describe('PickupService', () => {
  let service: PickupService;

  beforeEach(async () => {
    vi.stubEnv('QR_SIGNING_SECRET', 'test-qr-signing-secret-at-least-32');
    vi.resetAllMocks();
    service = new PickupService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('checkServingWindow', () => {
    it('throws the typed window-closed error before querying kitchen readiness', async () => {
      await expect(
        service.checkServingWindow('LUNCH', new Date('2026-09-04T03:29:59Z')),
      ).rejects.toMatchObject({
        response: {
          code: 'PICKUP_WINDOW_CLOSED',
          message:
            'Meal pickup is only available from 10:30 through 13:30 Vietnam time.',
          details: {
            availableFrom: '10:30',
            availableUntil: '13:30',
            timeZone: 'Asia/Ho_Chi_Minh',
          },
        },
      });
      expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
    });

    it('succeeds when kitchen signal in appSetting is true even without mealDay', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValueOnce({ value: 'true' });

      await expect(
        service.checkServingWindow('LUNCH', new Date('2026-09-04T04:00:00Z')),
      ).resolves.toBeUndefined();
    });

    it('succeeds when appSetting is missing but mealDay isServingReady is true', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValueOnce(null);
      mockPrisma.mealDay.findFirst.mockResolvedValueOnce({
        isServingReady: true,
      });

      await expect(
        service.checkServingWindow('LUNCH', new Date('2026-09-04T04:00:00Z')),
      ).resolves.toBeUndefined();
    });

    it('throws the typed not-ready error when neither kitchen signal nor mealDay is ready', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValueOnce({
        value: 'false',
      });
      mockPrisma.mealDay.findFirst.mockResolvedValueOnce({
        isServingReady: false,
      });

      await expect(
        service.checkServingWindow('LUNCH', new Date('2026-09-04T04:00:00Z')),
      ).rejects.toMatchObject({
        response: {
          code: 'PICKUP_NOT_READY',
          message:
            'Meal pickup is not currently available. Please wait for the kitchen signal.',
          details: {
            availableFrom: '10:30',
            availableUntil: '13:30',
            timeZone: 'Asia/Ho_Chi_Minh',
          },
        },
      });
    });
  });

  describe('generateQr', () => {
    beforeEach(() => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
    });

    it('generates a 5s TTL server-signed v2 QR code by default', async () => {
      const res = await service.generateQr('user123', ['reg1']);
      expect(res.qr).toBeDefined();

      const parts = res.qr.split(':');
      expect(parts.length).toBe(8);
      expect(parts[0]).toBe('imeal');
      expect(parts[1]).toBe('v2');
      expect(parts[2]).toBe('user123');
      expect(parts[4]).toBe('reg1');
      expect('ttl' in res ? res.ttl : undefined).toBe(5);
    });
  });

  describe('verifyQr', () => {
    beforeEach(() => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
    });

    it('verifies a valid short-lived server-signed QR code', async () => {
      const signed = service.generateSignedQr('user123', ['reg1']);
      const result = await service.verifyQr(signed.qr);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user123');
      expect(result.qrHash).toHaveLength(64);
      expect(result.pickupOptions[0].registrationId).toBe('reg1');
    });

    it('rejects the removed legacy TOTP format', async () => {
      await expect(
        service.verifyQr('imeal:totp:user123:000000'),
      ).rejects.toThrow('Invalid QR format');
    });

    it('rejects a QR after its clock-skew allowance', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T04:00:00.000Z'));
      const signed = service.generateSignedQr('user123', ['reg1']);
      vi.advanceTimersByTime(8_000);

      await expect(service.verifyQr(signed.qr)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a QR with an invalid signature', async () => {
      const signed = service.generateSignedQr('user123', ['reg1']);
      const parts = signed.qr.split(':');
      parts[7] = '0'.repeat(64);

      await expect(service.verifyQr(parts.join(':'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a QR code for a different business date', async () => {
      const signed = service.generateSignedQr('user123', ['reg1']);
      const parts = signed.qr.split(':');
      parts[3] = '2025-01-01';

      await expect(service.verifyQr(parts.join(':'))).rejects.toThrow(
        'QR code is not for today',
      );
    });

    it('filters pickup options to the signed intent', async () => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption, delegatedPickupOption],
      });

      const signed = service.generateSignedQr('user123', ['reg1']);
      const result = await service.verifyQr(signed.qr);

      expect(result.pickupOptions).toHaveLength(1);
      expect(result.pickupOptions[0].registrationId).toBe('reg1');
    });

    it('returns all eligible options for an all-items intent', async () => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption, delegatedPickupOption],
      });

      const signed = service.generateSignedQr('user123');
      const result = await service.verifyQr(signed.qr);

      expect(result.pickupOptions).toHaveLength(2);
    });
  });

  describe('resolvePickup with pickupIntent', () => {
    beforeEach(() => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption, delegatedPickupOption],
      });
    });

    it('atomically creates one persisted redemption session', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'sess-test-1',
          userId: 'user123',
          registrationIds: ['reg1'],
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      const signed = service.generateSignedQr('user123', ['reg1']);

      const resolved = await service.resolvePickup(signed.qr);

      expect(resolved.items).toHaveLength(1);
      expect(resolved.items[0].registrationId).toBe('reg1');
      expect(resolved.pickupSessionToken).toBe('sess-test-1');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects a QR whose database redemption already exists', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      const signed = service.generateSignedQr('user123', ['reg1']);

      await expect(service.resolvePickup(signed.qr)).rejects.toThrow(
        'QR code has already been used',
      );
    });
  });

  describe('confirmPickup', () => {
    beforeEach(() => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
    });

    it('returns previously generated servings on idempotency retry', async () => {
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce({
        status: 'SUCCESS',
      });
      mockPrisma.mealServing.findMany.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session1',
          registrationIds: ['reg1'],
          idempotencyKey: 'key1',
        },
        'caller1',
      );

      expect(result.success).toBe(true);
      expect(result.servedCount).toBe(1);
      expect(result.servings[0].registrationId).toBe('reg1');
    });

    it('processes transaction if not idempotently fulfilled', async () => {
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });

      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session1',
          registrationIds: ['reg1'],
          idempotencyKey: 'key2',
        },
        'caller2',
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('emits realtime SERVING_CONFIRMED event via KitchenEventsService after transaction commits', async () => {
      const eventsService = new KitchenEventsService();
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      const serviceWithEvents = new PickupService(eventsService);
      vi.spyOn(serviceWithEvents, 'checkServingWindow').mockResolvedValue(
        undefined,
      );

      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });

      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await serviceWithEvents.confirmPickup(
        {
          pickupSessionId: 'session1',
          registrationIds: ['reg1'],
          idempotencyKey: 'key-events',
        },
        'caller-event',
      );

      expect(result.success).toBe(true);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SERVING_CONFIRMED',
        }),
      );
    });

    it('throws if pickup session is expired', async () => {
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() - 10000), // expired
        registrationIds: ['reg1'],
      });

      await expect(
        service.confirmPickup(
          {
            pickupSessionId: 'session1',
            registrationIds: ['reg1'],
            idempotencyKey: 'key3',
          },
          'caller3',
        ),
      ).rejects.toThrow('Pickup session has expired');
    });

    it('gracefully handles concurrent idempotency inside transaction', async () => {
      // Setup outer check to pass (simulate concurrent entry)
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });

      // We will test the inner transaction logic by directly executing the transaction callback
      // However, we just mocked $transaction to return a value.
      // To test the inner callback, we can capture it and run it.
      let txCallback:
        | ((tx: unknown) => Promise<Array<{ registrationId: string }>>)
        | undefined;
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        txCallback = cb as (
          tx: unknown,
        ) => Promise<Array<{ registrationId: string }>>;
        return [
          { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
        ];
      });

      await service.confirmPickup(
        {
          pickupSessionId: 'session1',
          registrationIds: ['reg1'],
          idempotencyKey: 'key4',
        },
        'caller4',
      );

      expect(txCallback).toBeDefined();

      const mockTx = {
        appSetting: {
          findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ id: 'reg1', status: 'ACTIVE' }]),
        mealServing: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'serving1', registrationId: 'reg1' }]),
        },
        servingConfirmRequest: {
          findUnique: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        },
      };

      const capturedCallback = txCallback;
      if (!capturedCallback) {
        throw new Error('Transaction callback was not captured');
      }
      const result = await capturedCallback(mockTx);
      expect(result[0].registrationId).toBe('reg1'); // Graceful return!
    });
  });
});
