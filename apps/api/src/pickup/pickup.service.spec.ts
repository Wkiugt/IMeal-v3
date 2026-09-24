import { PickupService } from './pickup.service.js';
import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { KitchenEventsService } from '../kitchen/kitchen-events.service.js';

const mockPrisma = {
  registration: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  pickupDelegation: {
    findMany: vi.fn(),
  },
  servingVerification: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
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
  mealDate: '2026-09-04',
  mealChoice: 'VEGETARIAN',
} as const;
const delegatedPickupOption = {
  type: 'DELEGATED',
  registrationId: 'reg2',
  delegationId: 'delegation-1',
  mealDate: '2026-09-04',
  mealChoice: 'REGULAR',
  owner: {
    id: 'owner-1',
    name: 'Meal Owner',
    email: 'owner@example.com',
  },
} as const;

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
  describe('getPickupOptions', () => {
    it('returns the live meal choice for own and delegated registrations', async () => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
      mockPrisma.registration.findUnique.mockResolvedValueOnce({
        id: 'reg1',
        status: 'ACTIVE',
        mealDate: new Date('2026-09-04T00:00:00.000Z'),
        mealChoice: 'VEGETARIAN',
        mealServing: null,
      });
      mockPrisma.pickupDelegation.findMany.mockResolvedValueOnce([
        {
          id: 'delegation-1',
          registrationId: 'reg2',
          registration: {
            id: 'reg2',
            mealDate: new Date('2026-09-04T00:00:00.000Z'),
            mealChoice: 'REGULAR',
            user: {
              id: 'owner-1',
              name: 'Meal Owner',
              email: 'owner@example.com',
            },
          },
        },
      ]);

      const result = await service.getPickupOptions('delegate-1');

      expect(result.options).toEqual([
        {
          type: 'OWN',
          registrationId: 'reg1',
          mealDate: '2026-09-04',
          mealChoice: 'VEGETARIAN',
        },
        {
          type: 'DELEGATED',
          registrationId: 'reg2',
          delegationId: 'delegation-1',
          mealDate: '2026-09-04',
          mealChoice: 'REGULAR',
          owner: {
            id: 'owner-1',
            name: 'Meal Owner',
            email: 'owner@example.com',
          },
        },
      ]);
    });
  });


  describe('generateQr', () => {
    beforeEach(() => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
    });

    it('generates a 5s TTL server-signed v2 QR code', () => {
      const res = service.generateSignedQr('user123', ['reg1']);
      expect(res.qr).toBeDefined();

      const parts = res.qr.split(':');
      expect(parts.length).toBe(8);
      expect(parts[0]).toBe('imeal');
      expect(parts[1]).toBe('v2');
      expect(parts[2]).toBe('user123');
      expect(parts[4]).toBe('reg1');
      expect(res.ttl).toBe(5);
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
      ).rejects.toMatchObject({
        response: { code: 'QR_INVALID' },
      });
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

      await expect(service.verifyQr(parts.join(':'))).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });

    it('rejects a changed exact intent instead of filtering or substituting items', async () => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });

      const signed = service.generateSignedQr('user123', ['reg1', 'reg2']);

      await expect(service.verifyQr(signed.qr)).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });

    it('accepts an exact sorted multi-item intent', async () => {
      vi.spyOn(service, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption, delegatedPickupOption],
      });

      const signed = service.generateSignedQr('user123', ['reg2', 'reg1']);
      const result = await service.verifyQr(signed.qr);

      expect(result.pickupOptions.map((item) => item.registrationId)).toEqual([
        'reg1',
        'reg2',
      ]);
    });
  });

  describe('confirmPickup', () => {
    beforeEach(() => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
    });

    it('returns previously generated servings on idempotency retry', async () => {
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce({
        status: 'SUCCESS',
      });
      mockPrisma.mealServing.findMany.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session1',
          idempotencyKey: 'key1',
        },
        'caller1',
      );

      expect(result.success).toBe(true);
      expect(result.servedCount).toBe(1);
      expect(result.servings[0].registrationId).toBe('reg1');
    });

    it('processes transaction if not idempotently fulfilled', async () => {
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);

      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session1',
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

      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);

      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'serving1', registrationId: 'reg1', servedAt: new Date() },
      ]);

      const result = await serviceWithEvents.confirmPickup(
        {
          pickupSessionId: 'session1',
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
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() - 10000), // expired
        registrationIds: ['reg1'],
      });

      await expect(
        service.confirmPickup(
          {
            pickupSessionId: 'session1',
            idempotencyKey: 'key3',
          },
          'caller3',
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'PICKUP_SESSION_EXPIRED',
          message: 'Pickup session has expired',
        },
      });
    });

    it('gracefully handles concurrent idempotency inside transaction', async () => {
      mockPrisma.pickupSession.findUnique.mockResolvedValueOnce({
        id: 'session1',
        expiresAt: new Date(Date.now() + 10000),
        registrationIds: ['reg1'],
      });
      mockPrisma.servingConfirmRequest.findUnique.mockResolvedValueOnce(null);

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
  describe('Task 7 exact intent and presenter evidence', () => {
    const validEvidence = {
      capturedAt: '2026-09-04T04:00:00.000Z',
      latitude: 10.77,
      longitude: 106.69,
      accuracyMeters: 12,
    } as const;
    const kitchenActor = {
      id: 'kitchen-1',
      userId: 'kitchen-1',
      email: 'kitchen@example.test',
      roles: ['kitchen'],
      permissions: ['kitchen.serve'],
      sessionId: 'session-kitchen',
      isActive: true,
    };

    function makeLocationsService(result: unknown = {
      result: 'VALID',
      locationId: 'location-1',
      locationPolicyId: 'policy-1',
      capturedAt: validEvidence.capturedAt,
      verifiedAt: '2026-09-04T04:00:01.000Z',
      accuracyMeters: validEvidence.accuracyMeters,
      safeVerificationCode: 'GPS_VALID',
    }) {
      return {
        resolveEffectiveLocation: vi.fn().mockResolvedValue({
          id: 'location-1',
          shortCode: 'HQ',
          locationPolicy: {
            id: 'policy-1',
            maxFixAgeSeconds: 120,
            maxAccuracyMeters: 50,
          },
        }),
        evaluatePresenterEvidence: vi.fn().mockResolvedValue(result),
      };
    }

    it('rejects zero selection and does not issue a usable QR', async () => {
      const locationsService = makeLocationsService();
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);

      await expect(
        taskService.generateQr('presenter-1', {
          registrationIds: [],
          presenterEvidence: validEvidence,
        } as never),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_REQUIRED' },
      });
    });

    it('requires fresh presenter evidence on every QR generation or refresh', async () => {
      const locationsService = makeLocationsService({
        result: 'GPS_RETRY_REQUIRED',
        locationId: 'location-1',
        code: 'GPS_RETRY_REQUIRED',
        safeVerificationCode: 'GPS_STALE',
        details: { action: 'RETRY' },
      });
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(taskService, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      mockPrisma.registration.findMany = vi.fn().mockResolvedValue([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          serviceLocationId: 'location-1',
          serviceLocationCode: 'HQ',
          mealServing: null,
        },
      ]);

      await expect(
        taskService.generateQr('presenter-1', {
          registrationIds: ['reg1'],
          presenterEvidence: validEvidence,
        } as never),
      ).rejects.toMatchObject({
        response: {
          code: 'GPS_RETRY_REQUIRED',
          details: { action: 'RETRY' },
        },
      });
      expect(locationsService.evaluatePresenterEvidence).toHaveBeenCalledWith(
        'location-1',
        validEvidence,
        expect.any(Date),
      );
      expect(mockPrisma.servingVerification.create).not.toHaveBeenCalled();
    });
    it('persists only safe presenter verification evidence for the signed exact set', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T04:00:00.000Z'));
      const locationsService = makeLocationsService();
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(taskService, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      mockPrisma.registration.findMany.mockResolvedValueOnce([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          serviceLocationId: 'location-1',
          serviceLocationCode: 'HQ',
          serviceLocationName: 'HQ',
          serviceLocationAddress: 'Address',
          serviceLocationEffectiveFrom: null,
          mealServing: null,
        },
      ]);

      const result = await taskService.generateQr('presenter-1', {
        registrationIds: ['reg1'],
        presenterEvidence: validEvidence,
      } as never);

      expect(result.registrationIds).toEqual(['reg1']);
      expect(result.mealDate).toBe('2026-09-04');
      expect(result.ttl).toBe(5);
      expect(mockPrisma.servingVerification.create).toHaveBeenCalledTimes(1);
      const persisted = mockPrisma.servingVerification.create.mock.calls[0][0]
        .data;
      expect(persisted).toMatchObject({
        presenterUserId: 'presenter-1',
        locationId: 'location-1',
        locationPolicyId: 'policy-1',
        accuracyMeters: 12,
        safeVerificationCode: 'GPS_VALID',
      });
      expect(persisted).not.toHaveProperty('latitude');
      expect(persisted).not.toHaveProperty('longitude');
    });

    it('rejects a stale selected item without substituting another eligible item', async () => {
      const locationsService = makeLocationsService();
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(taskService, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      const signed = taskService.generateSignedQr('presenter-1', ['reg1', 'reg2']);
      mockPrisma.servingVerification.findUnique.mockResolvedValueOnce({
        id: 'qr-hash',
        presenterUserId: 'presenter-1',
        locationId: 'location-1',
        locationPolicyId: 'policy-1',
        result: 'VALID',
        capturedAt: new Date(validEvidence.capturedAt),
        accuracyMeters: 12,
      });

      await expect(
        taskService.resolvePickup(
          { qr: signed.qr },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });

    it('resolves only a QR for an authenticated Kitchen actor and stores no Kitchen GPS', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T04:00:00.000Z'));
      const locationsService = makeLocationsService();
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(taskService, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      const signed = taskService.generateSignedQr('presenter-1', ['reg1']);
      mockPrisma.servingVerification.findUnique.mockResolvedValueOnce({
        id: expect.any(String),
        presenterUserId: 'presenter-1',
        locationId: 'location-1',
        locationPolicyId: 'policy-1',
        result: 'VALID',
        capturedAt: new Date(validEvidence.capturedAt),
        accuracyMeters: 12,
      });
      mockPrisma.registration.findMany = vi.fn().mockResolvedValue([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          serviceLocationId: 'location-1',
          serviceLocationCode: 'HQ',
          mealServing: null,
        },
      ]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'session-1',
          userId: 'presenter-1',
          registrationIds: ['reg1'],
          expiresAt: new Date(Date.now() + 30_000),
          createdAt: new Date(),
        },
      ]);

      const resolved = await taskService.resolvePickup(
        { qr: signed.qr },
        kitchenActor,
      );

      expect(resolved.items.map((item) => item.registrationId)).toEqual([
        'reg1',
      ]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(locationsService.evaluatePresenterEvidence).not.toHaveBeenCalled();
    });
    it('rejects stored evidence when the effective location policy changes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T04:00:00.000Z'));
      const locationsService = makeLocationsService();
      const taskService = new PickupService(
        undefined,
        undefined,
        locationsService as never,
      );
      vi.spyOn(taskService, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(taskService, 'getPickupOptions').mockResolvedValue({
        options: [ownPickupOption],
      });
      const signed = taskService.generateSignedQr('presenter-1', ['reg1']);
      mockPrisma.servingVerification.findUnique.mockResolvedValueOnce({
        id: signed.qrHash,
        presenterUserId: 'presenter-1',
        locationId: 'location-1',
        locationPolicyId: 'policy-old',
        result: 'VALID',
        capturedAt: new Date(validEvidence.capturedAt),
        accuracyMeters: 12,
      });
      mockPrisma.registration.findMany = vi.fn().mockResolvedValue([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          serviceLocationId: 'location-1',
          serviceLocationCode: 'HQ',
          mealServing: null,
        },
      ]);

      await expect(
        taskService.resolvePickup({ qr: signed.qr }, kitchenActor),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });


    it('rejects a changed resolved intent at confirm time', async () => {
      const taskService = new PickupService();

      await expect(
        taskService.confirmPickup(
          {
            pickupSessionId: 'session-1',
            idempotencyKey: 'key-1',
            registrationIds: ['reg-other'],
          } as never,
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });
  });
});
