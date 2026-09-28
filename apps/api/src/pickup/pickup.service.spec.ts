import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PickupService } from './pickup.service.js';
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
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
const completePickupSnapshot = {
  ownerNameSnapshot: 'Meal Owner',
  employeeCodeSnapshot: 'EMP-1',
  serviceLocationId: 'location-1',
  serviceLocationAssignmentId: 'assignment-1',
  serviceLocationCode: 'HQ',
  serviceLocationName: 'Approved HQ',
  serviceLocationAddress: 'Approved address',
  serviceLocationEffectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
  serviceLocationSnapshotAt: new Date('2026-09-01T00:00:00.000Z'),
  menuRevisionId: 'menu-revision-1',
  menuNameSnapshot: 'Lunch',
  menuDescriptionSnapshot: 'Lunch description',
  menuImageSnapshot: 'https://example.test/lunch.jpg',
  menuRevision: {
    id: 'menu-revision-1',
    mealName: 'Lunch',
    description: 'Lunch description',
    imageUrl: 'https://example.test/lunch.jpg',
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
        ...completePickupSnapshot,
      });
      mockPrisma.pickupDelegation.findMany.mockResolvedValueOnce([
        {
          id: 'delegation-1',
          registrationId: 'reg2',
          registration: {
            id: 'reg2',
            status: 'ACTIVE',
            mealDate: new Date('2026-09-04T00:00:00.000Z'),
            mealChoice: 'REGULAR',
            mealServing: null,
            ...completePickupSnapshot,
            user: {
              id: 'owner-1',
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
    it('getPickupOptions_excludes_legacy_registration_with_null_snapshot', async () => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
      mockPrisma.registration.findUnique.mockResolvedValueOnce({
        id: 'legacy-reg',
        status: 'ACTIVE',
        mealDate: new Date('2026-09-04T00:00:00.000Z'),
        mealChoice: 'REGULAR',
        mealServing: null,
        ...completePickupSnapshot,
        serviceLocationName: null,
      });
      mockPrisma.pickupDelegation.findMany.mockResolvedValueOnce([]);

      const result = await service.getPickupOptions('owner-1');

      expect(result.options).toEqual([]);
    });
    it('accepts null description and image when immutable revision omits them', async () => {
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
      mockPrisma.registration.findUnique.mockResolvedValueOnce({
        id: 'reg-null-content',
        status: 'ACTIVE',
        mealDate: new Date('2026-09-04T00:00:00.000Z'),
        mealChoice: 'REGULAR',
        mealServing: null,
        ...completePickupSnapshot,
        menuDescriptionSnapshot: null,
        menuImageSnapshot: null,
        menuRevision: {
          ...completePickupSnapshot.menuRevision,
          description: null,
          imageUrl: null,
        },
      });
      mockPrisma.pickupDelegation.findMany.mockResolvedValueOnce([]);

      const result = await service.getPickupOptions('owner-1');

      expect(result.options).toEqual([
        {
          type: 'OWN',
          registrationId: 'reg-null-content',
          mealDate: '2026-09-04',
          mealChoice: 'REGULAR',
        },
      ]);
    });
  });
  describe('pickup snapshot invariants', () => {
    const resolveIntentLocation = (
      target: PickupService,
      registrationIds: string[],
    ) =>
      (
        target as unknown as {
          resolveIntentLocation: (
            ids: string[],
            at: Date,
          ) => Promise<unknown>;
        }
      ).resolveIntentLocation(registrationIds, new Date('2026-09-04T04:00:00.000Z'));

    it.each([
      ['name', { serviceLocationName: null }],
      ['address', { serviceLocationAddress: null }],
      ['menu', { menuNameSnapshot: null }],
    ])(
      'resolvePickup_rejects_missing_name_address_or_menu_snapshot (%s)',
      async (_field, patch) => {
        const registration = {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          mealServing: null,
          ...completePickupSnapshot,
          ...patch,
        };
        vi.spyOn(
          service as unknown as { loadRegistrationContexts: () => unknown },
          'loadRegistrationContexts',
        ).mockResolvedValue([registration] as never);

        await expect(resolveIntentLocation(service, ['reg1'])).rejects.toMatchObject({
          response: { code: 'PICKUP_INTENT_CONFLICT' },
        });
      },
    );

    it('selected_items_must_share_one_snapshot_location', async () => {
      const registrations = [
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          mealServing: null,
          ...completePickupSnapshot,
        },
        {
          id: 'reg2',
          userId: 'owner-2',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
          mealServing: null,
          ...completePickupSnapshot,
          serviceLocationId: 'location-2',
          serviceLocationCode: 'ANNEX',
        },
      ];
      const loadContexts = vi
        .spyOn(
          service as unknown as { loadRegistrationContexts: () => unknown },
          'loadRegistrationContexts',
        )
        .mockResolvedValue(registrations as never);

      await expect(
        resolveIntentLocation(service, ['reg1', 'reg2']),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(loadContexts).toHaveBeenCalledWith(['reg1', 'reg2']);
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
    const kitchenActor = {
      id: 'kitchen-1',
      userId: 'kitchen-1',
      email: 'kitchen@example.test',
      roles: ['kitchen'],
      permissions: ['kitchen.serve'],
      sessionId: 'session-kitchen',
      isActive: true,
    };
    const session = {
      id: 'session-1',
      userId: 'presenter-1',
      presenterUserId: 'presenter-1',
      mealDate: new Date('2026-09-24T00:00:00.000Z'),
      registrationIds: ['reg-1'],
      intentRegistrationIds: ['reg-1'],
      intentHash: 'qr-hash-1',
      intentNonce: 'nonce-1',
      qrHash: 'qr-hash-1',
      locationId: 'location-1',
      servingVerificationId: 'qr-hash-1',
      expiresAt: new Date('2026-09-24T04:00:30.000Z'),
      consumedAt: null,
      createdAt: new Date('2026-09-24T03:59:30.000Z'),
    };
    const verification = {
      id: 'qr-hash-1',
      intentNonce: 'nonce-1',
      presenterUserId: 'presenter-1',
      locationId: 'location-1',
      locationPolicyId: 'policy-1',
      result: 'VALID',
      capturedAt: new Date('2026-09-24T03:59:00.000Z'),
      accuracyMeters: 12,
      safeVerificationCode: 'GPS_VALID',
      retentionUntil: new Date('2027-09-24T03:59:00.000Z'),
    };
    const location = {
      id: 'location-1',
      shortCode: 'HQ',
      displayName: 'Approved HQ',
      address: 'Approved address',
      isActive: true,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      effectiveTo: null,
    };
    const policy = {
      id: 'policy-1',
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      maxFixAgeSeconds: 120,
      maxAccuracyMeters: 50,
    };

    function makeRegistration(id: string, status = 'ACTIVE') {
      return {
        id,
        status,
        userId: 'presenter-1',
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        mealChoice: 'REGULAR',
        ownerNameSnapshot: 'Presenter',
        employeeCodeSnapshot: 'EMP-1',
        menuRevisionId: 'menu-revision-1',
        menuNameSnapshot: 'Lunch',
        menuDescriptionSnapshot: 'Lunch description',
        menuImageSnapshot: 'https://example.test/lunch.jpg',
        immutableMenuRevisionId: 'menu-revision-1',
        immutableMenuName: 'Lunch',
        immutableMenuDescription: 'Lunch description',
        immutableMenuImage: 'https://example.test/lunch.jpg',
        serviceLocationId: 'location-1',
        serviceLocationAssignmentId: 'assignment-1',
        serviceLocationCode: 'HQ',
        serviceLocationName: 'Approved HQ',
        serviceLocationAddress: 'Approved address',
        serviceLocationEffectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        serviceLocationSnapshotAt: new Date('2026-09-01T00:00:00.000Z'),
        mealServingId: null,
      };
    }

    function makeAccount(
      id: string,
      hasKitchenServe = false,
    ) {
      return {
        id,
        email: `${id}@example.test`,
        name: id,
        isActive: true,
        hasKitchenServe,
      };
    }

    function makeTransaction(
      overrides: {
        session?: typeof session;
        registrations?: ReturnType<typeof makeRegistration>[];
        delegations?: Array<{
          id: string;
          status: string;
          registrationId: string;
          delegateUserId: string;
        }>;
        accounts?: ReturnType<typeof makeAccount>[];
        servingVerification?: typeof verification | null;
      } = {},
    ) {
      const tx = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'request-1',
              callerUserId: 'kitchen-1',
              idempotencyKey: 'key-1',
              status: 'PROCESSING',
              requestBodyHash: null,
              intentHash: null,
              pickupSessionId: 'session-1',
              resultSnapshot: null,
            },
          ])
          .mockResolvedValueOnce([
            overrides.session ?? session,
          ])
          .mockResolvedValueOnce(
            overrides.registrations ?? [makeRegistration('reg-1')],
          )
          .mockResolvedValueOnce(overrides.delegations ?? [])
          .mockResolvedValueOnce(
            overrides.accounts ?? [
              makeAccount('kitchen-1', true),
              makeAccount('presenter-1'),
            ],
          ),
        servingVerification: {
          findUnique: vi
            .fn()
            .mockResolvedValue(overrides.servingVerification ?? verification),
        },
        location: {
          findUnique: vi.fn().mockResolvedValue(location),
        },
        locationPolicy: {
          findFirst: vi.fn().mockResolvedValue(policy),
        },
        pickupDelegation: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        mealServing: {
          create: vi.fn().mockImplementation(async ({ data }) => ({
            id: `serving-${data.registrationId}`,
            registrationId: data.registrationId,
            servedAt: data.servedAt,
          })),
        },
        registration: {
          update: vi.fn().mockResolvedValue({}),
        },
        mealEvent: {
          create: vi.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        },
        pickupSession: {
          update: vi.fn().mockResolvedValue({}),
        },
        servingConfirmRequest: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return tx;
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-24T04:00:00.000Z'));
      vi.spyOn(service, 'checkServingWindow').mockResolvedValue(undefined);
      vi.spyOn(
        service as unknown as {
          assertServingReadyInTransaction: () => Promise<{
            currentMenuRevisionId: string;
            serviceStartAt: Date;
            serviceEndAt: Date;
          }>;
        },
        'assertServingReadyInTransaction',
      ).mockResolvedValue({
        currentMenuRevisionId: 'menu-revision-1',
        serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
        serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
      });
    });

    it('commits every item or none when one locked registration is stale', async () => {
      const tx = makeTransaction({
        session: {
          ...session,
          registrationIds: ['reg-1', 'reg-2'],
          intentRegistrationIds: ['reg-1', 'reg-2'],
        },
        registrations: [
          makeRegistration('reg-1'),
          makeRegistration('reg-2', 'CANCELLED'),
        ],
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-1' },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(tx.mealServing.create).not.toHaveBeenCalled();
      expect(tx.pickupDelegation.updateMany).not.toHaveBeenCalled();
    });

    it('returns the original result for the same caller/key/body', async () => {
      const originalResult = {
        success: true as const,
        servedCount: 1,
        servings: [
          {
            id: 'serving-1',
            registrationId: 'reg-1',
            servedAt: '2026-09-24T04:00:00.000Z',
          },
        ],
      };
      const tx = makeTransaction();
      tx.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'request-1',
            callerUserId: 'kitchen-1',
            idempotencyKey: 'key-1',
            status: 'SUCCESS',
            requestBodyHash: createHash('sha256')
              .update(JSON.stringify({ pickupSessionId: 'session-1' }))
              .digest('hex'),
            intentHash: 'intent-hash-1',
            pickupSessionId: 'session-1',
            resultSnapshot: originalResult,
          },
        ]);
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-1' },
          kitchenActor,
        ),
      ).resolves.toEqual(originalResult);
      expect(tx.mealServing.create).not.toHaveBeenCalled();
    });

    it('conflicts when a successful key is reused for a changed session body', async () => {
      const tx = makeTransaction();
      tx.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'request-1',
            callerUserId: 'kitchen-1',
            idempotencyKey: 'key-1',
            status: 'SUCCESS',
            requestBodyHash: 'body-for-session-b',
            intentHash: 'intent-hash-1',
            pickupSessionId: 'session-b',
            resultSnapshot: {
              success: true,
              servedCount: 1,
              servings: [],
            },
          },
        ]);
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-1' },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    });

    it('records immutable owner, proxy, kitchen, location, intent and verification snapshots', async () => {
      const tx = makeTransaction({
        session: {
          ...session,
          userId: 'delegate-1',
          presenterUserId: 'delegate-1',
          intentHash: 'qr-hash-proxy',
          qrHash: 'qr-hash-proxy',
          intentNonce: 'nonce-proxy',
          servingVerificationId: 'qr-hash-proxy',
        },
        registrations: [
          {
            ...makeRegistration('reg-1'),
            userId: 'owner-1',
            ownerNameSnapshot: 'Owner',
          },
        ],
        delegations: [
          {
            id: 'delegation-1',
            status: 'ACCEPTED',
            registrationId: 'reg-1',
            delegateUserId: 'delegate-1',
          },
        ],
        accounts: [
          makeAccount('kitchen-1', true),
          makeAccount('delegate-1'),
          {
            ...makeAccount('owner-1'),
            email: 'owner@example.test',
            name: 'Owner',
          },
        ],
        servingVerification: {
          ...verification,
          id: 'qr-hash-proxy',
          intentNonce: 'nonce-proxy',
          presenterUserId: 'delegate-1',
        },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      const result = await service.confirmPickup(
        { pickupSessionId: 'session-1', idempotencyKey: 'key-1' },
        kitchenActor,
      );

      expect(result).toMatchObject({
        success: true,
        servedCount: 1,
      });
      expect(tx.mealServing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationId: 'reg-1',
          ownerUserId: 'owner-1',
          ownerEmailSnapshot: 'owner@example.test',
          ownerNameSnapshot: 'Owner',
          presenterUserId: 'delegate-1',
          receiverType: 'PROXY',
          kitchenUserId: 'kitchen-1',
          locationId: 'location-1',
          locationShortCode: 'HQ',
          locationNameSnapshot: 'Approved HQ',
          locationAddressSnapshot: 'Approved address',
          mealDate: new Date('2026-09-24T00:00:00.000Z'),
          menuRevisionId: 'menu-revision-1',
          menuNameSnapshot: 'Lunch',
          menuDescriptionSnapshot: 'Lunch description',
          menuImageSnapshot: 'https://example.test/lunch.jpg',
          intentHash: 'qr-hash-proxy',
          servingVerificationId: 'qr-hash-proxy',
          pickupSessionId: 'session-1',
          delegationId: 'delegation-1',
        }),
      });
      expect(tx.registration.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'kitchen-1',
          action: 'SERVING_CONFIRMED',
          details: expect.stringContaining('"receiverType":"PROXY"'),
        }),
      });
      expect(tx.pickupDelegation.updateMany).toHaveBeenCalledWith({
        where: { id: 'delegation-1', status: 'ACCEPTED' },
        data: { status: 'COMPLETED' },
      });
      expect(tx.pickupSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
    });
    it('confirmPickup_rejects_snapshot_changed_after_resolve', async () => {
      const tx = makeTransaction({
        registrations: [
          {
            ...makeRegistration('reg-1'),
            menuRevisionId: 'menu-revision-old',
            immutableMenuRevisionId: 'menu-revision-old',
          },
        ],
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-stale-snapshot' },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(tx.mealServing.create).not.toHaveBeenCalled();
      expect(tx.pickupDelegation.updateMany).not.toHaveBeenCalled();
      expect(tx.registration.update).not.toHaveBeenCalled();
    });
    it('emits realtime only after the serving transaction resolves', async () => {
      const tx = makeTransaction();
      let committed = false;
      const emitEvent = vi.fn(() => {
        expect(committed).toBe(true);
      });
      const serviceWithEvents = new PickupService({ emitEvent } as never);
      vi.spyOn(serviceWithEvents, 'checkServingWindow').mockResolvedValue(
        undefined,
      );
      vi.spyOn(
        serviceWithEvents as unknown as {
          assertServingReadyInTransaction: () => Promise<{
            currentMenuRevisionId: string;
            serviceStartAt: Date;
            serviceEndAt: Date;
          }>;
        },
        'assertServingReadyInTransaction',
      ).mockResolvedValue({
        currentMenuRevisionId: 'menu-revision-1',
        serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
        serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) => {
        const result = await callback(tx as never);
        committed = true;
        return result;
      });

      await serviceWithEvents.confirmPickup(
        { pickupSessionId: 'session-1', idempotencyKey: 'key-1' },
        kitchenActor,
      );

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SERVING_CONFIRMED',
          mealDate: '2026-09-24',
        }),
      );
    });

    it('returns previously generated servings on idempotency retry', async () => {
      const originalResult = {
        success: true as const,
        servedCount: 1,
        servings: [
          {
            id: 'serving1',
            registrationId: 'reg-1',
            servedAt: '2026-09-24T04:00:00.000Z',
          },
        ],
      };
      const tx = makeTransaction();
      tx.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'request-1',
            callerUserId: 'kitchen-1',
            idempotencyKey: 'key-1',
            status: 'SUCCESS',
            requestBodyHash: createHash('sha256')
              .update(JSON.stringify({ pickupSessionId: 'session-1' }))
              .digest('hex'),
            intentHash: 'intent-hash-1',
            pickupSessionId: 'session-1',
            resultSnapshot: originalResult,
          },
        ]);
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session-1',
          idempotencyKey: 'key-1',
        },
        kitchenActor,
      );

      expect(result.success).toBe(true);
      expect(result.servedCount).toBe(1);
      expect(result.servings[0].registrationId).toBe('reg-1');
      expect(tx.mealServing.create).not.toHaveBeenCalled();
    });

    it('processes transaction if not idempotently fulfilled', async () => {
      const tx = makeTransaction();
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      const result = await service.confirmPickup(
        {
          pickupSessionId: 'session-1',
          idempotencyKey: 'key-2',
        },
        kitchenActor,
      );

      expect(result.success).toBe(true);
      expect(result.servedCount).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('serving_confirmed_event_contains_projection_payload_after_commit', async () => {
      const eventsService = new KitchenEventsService();
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      const serviceWithEvents = new PickupService(eventsService);
      vi.spyOn(serviceWithEvents, 'checkServingWindow').mockResolvedValue(
        undefined,
      );
      vi.spyOn(
        serviceWithEvents as unknown as {
          assertServingReadyInTransaction: () => Promise<{
            currentMenuRevisionId: string;
            serviceStartAt: Date;
            serviceEndAt: Date;
          }>;
        },
        'assertServingReadyInTransaction',
      ).mockResolvedValue({
        currentMenuRevisionId: 'menu-revision-1',
        serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
        serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
      });
      const tx = makeTransaction();
      let committed = false;
      mockPrisma.$transaction.mockImplementationOnce(async (callback) => {
        const result = await callback(tx as never);
        committed = true;
        return result;
      });

      const result = await serviceWithEvents.confirmPickup(
        {
          pickupSessionId: 'session-1',
          idempotencyKey: 'key-events',
        },
        kitchenActor,
      );

      expect(result.success).toBe(true);
      expect(committed).toBe(true);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'serving:serving-reg-1',
          eventType: 'SERVING_CONFIRMED',
          mealDate: '2026-09-24',
          requestId: expect.any(String),
          payload: {
            servedCount: 1,
            servingIds: ['serving-reg-1'],
          },
        }),
      );
    });
    it('does not emit SERVING_CONFIRMED when the serving transaction rolls back', async () => {
      const eventsService = new KitchenEventsService();
      const emitSpy = vi.spyOn(eventsService, 'emitEvent');
      const serviceWithEvents = new PickupService(eventsService);
      const transactionError = new Error('serving transaction rolled back');
      mockPrisma.$transaction.mockRejectedValueOnce(transactionError);

      await expect(
        serviceWithEvents.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-rollback' },
          kitchenActor,
        ),
      ).rejects.toThrow(transactionError);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('throws if pickup session is expired', async () => {
      const tx = makeTransaction({
        session: {
          ...session,
          expiresAt: new Date('2026-09-24T03:59:00.000Z'),
        },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          {
            pickupSessionId: 'session-1',
            idempotencyKey: 'key-3',
          },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'PICKUP_SESSION_EXPIRED',
          message: 'Pickup session has expired',
        },
      });
      expect(tx.mealServing.create).not.toHaveBeenCalled();
    });

    it('gracefully handles concurrent idempotency inside transaction', async () => {
      const requestBodyHash = createHash('sha256')
        .update(JSON.stringify({ pickupSessionId: 'session-1' }))
        .digest('hex');
      const tx = makeTransaction();
      tx.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'request-1',
            callerUserId: 'kitchen-1',
            idempotencyKey: 'key-4',
            status: 'PROCESSING',
            requestBodyHash,
            intentHash: null,
            pickupSessionId: 'session-1',
            resultSnapshot: null,
          },
        ]);
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          {
            pickupSessionId: 'session-1',
            idempotencyKey: 'key-4',
          },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'IDEMPOTENCY_CONFLICT',
        },
      });
      expect(tx.mealServing.create).not.toHaveBeenCalled();
    });

    it('does not complete or audit an unrelated accepted delegation for SELF pickup', async () => {
      const tx = makeTransaction({
        delegations: [
          {
            id: 'delegation-unrelated',
            status: 'ACCEPTED',
            registrationId: 'reg-1',
            delegateUserId: 'other-delegate',
          },
        ],
        accounts: [
          makeAccount('kitchen-1', true),
          makeAccount('presenter-1'),
          makeAccount('other-delegate'),
        ],
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      const result = await service.confirmPickup(
        { pickupSessionId: 'session-1', idempotencyKey: 'key-self' },
        kitchenActor,
      );

      expect(result).toMatchObject({ success: true, servedCount: 1 });
      expect(tx.pickupDelegation.updateMany).not.toHaveBeenCalled();
      expect(tx.mealServing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          receiverType: 'SELF',
          delegationId: null,
        }),
      });
      const auditDetails = JSON.parse(
        tx.auditLog.create.mock.calls[0][0].data.details,
      ) as { delegationId: string | null };
      expect(auditDetails.delegationId).toBeNull();
    });

    it.each([
      ['intent hash', { intentHash: 'tampered-intent' }],
      ['QR hash', { qrHash: 'tampered-qr' }],
      ['verification link', { servingVerificationId: 'tampered-verification' }],
      ['intent nonce', { intentNonce: 'tampered-nonce' }],
    ])('rejects a mismatched session %s before serving writes', async (_name, patch) => {
      const tx = makeTransaction({
        session: { ...session, ...patch },
      });
      mockPrisma.$transaction.mockImplementationOnce(async (callback) =>
        callback(tx as never),
      );

      await expect(
        service.confirmPickup(
          { pickupSessionId: 'session-1', idempotencyKey: 'key-integrity' },
          kitchenActor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(tx.mealServing.create).not.toHaveBeenCalled();
      expect(tx.registration.update).not.toHaveBeenCalled();
      expect(tx.pickupSession.update).not.toHaveBeenCalled();
    });


  });
  describe('serving menu invariant', () => {
    const assertServingReady = (
      tx: unknown,
      mealDateKey = '2026-09-24',
    ) => {
      const privateService = service as unknown as {
        assertServingReadyInTransaction: (
          transaction: unknown,
          dateKey: string,
          at: Date,
        ) => Promise<{
          currentMenuRevisionId: string;
          serviceStartAt: Date;
          serviceEndAt: Date;
        }>;
      };
      return privateService.assertServingReadyInTransaction(
        tx,
        mealDateKey,
        new Date('2026-09-24T04:00:00.000Z'),
      );
    };

    it('does not let a ready signal bypass a disabled current menu', async () => {
      const tx = {
        appSetting: {
          findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
        },
        mealDay: {
          findFirst: vi.fn().mockResolvedValue({
            isServingReady: false,
            dailyMenu: {
              isEnabled: false,
              revisions: [{ id: 'revision-1' }],
            },
          }),
        },
      };

      await expect(assertServingReady(tx)).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(tx.mealDay.findFirst).toHaveBeenCalledTimes(1);
    });

    it('rejects a ready signal when the current menu or revision is missing', async () => {
      const tx = {
        appSetting: {
          findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
        },
        mealDay: {
          findFirst: vi.fn().mockResolvedValue({
            isServingReady: false,
            dailyMenu: { isEnabled: true, revisions: [] },
          }),
        },
      };

      await expect(assertServingReady(tx)).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
      expect(tx.mealDay.findFirst).toHaveBeenCalledTimes(1);
    });

    it('returns the current menu revision when the ready signal is true', async () => {
      const tx = {
        appSetting: {
          findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
        },
        mealDay: {
          findFirst: vi.fn().mockResolvedValue({
            isServingReady: false,
            serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
            serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
            dailyMenu: {
              isEnabled: true,
              revisions: [{ id: 'revision-current' }],
            },
          }),
        },
      };

      await expect(assertServingReady(tx)).resolves.toEqual({
        currentMenuRevisionId: 'revision-current',
        serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
        serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
      });
      expect(tx.mealDay.findFirst).toHaveBeenCalledTimes(1);
    });
    it('uses the verified revision when a later-created legacy revision exists', async () => {
      const revisions = [
        {
          id: 'legacy-created-later',
          revision: null,
          createdAt: new Date('2026-09-24T03:59:00.000Z'),
        },
        {
          id: 'verified-created-earlier',
          revision: 1,
          createdAt: new Date('2026-09-24T03:00:00.000Z'),
        },
      ];
      const findFirst = vi.fn().mockImplementation((query) => {
        const revisionQuery = query.include.dailyMenu.include.revisions;
        expect(revisionQuery.where).toEqual({ revision: { not: null } });
        expect(revisionQuery.orderBy).toEqual([
          { revision: 'desc' },
          { id: 'desc' },
        ]);
        const selected = revisions
          .filter((revision) => revision.revision !== null)
          .sort(
            (left, right) =>
              (right.revision ?? 0) - (left.revision ?? 0) ||
              right.id.localeCompare(left.id),
          )[0];
        return {
          isServingReady: false,
          serviceStartAt: new Date('2026-09-24T03:30:00.000Z'),
          serviceEndAt: new Date('2026-09-24T06:30:00.000Z'),
          dailyMenu: {
            isEnabled: true,
            revisions: [{ id: selected.id }],
          },
        };
      });
      const tx = {
        appSetting: {
          findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
        },
        mealDay: { findFirst },
      };

      await expect(assertServingReady(tx)).resolves.toMatchObject({
        currentMenuRevisionId: 'verified-created-earlier',
      });
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

    function makeLocationsService(
      result: unknown = {
        result: 'VALID',
        locationId: 'location-1',
        locationPolicyId: 'policy-1',
        capturedAt: validEvidence.capturedAt,
        verifiedAt: '2026-09-04T04:00:01.000Z',
        accuracyMeters: validEvidence.accuracyMeters,
        safeVerificationCode: 'GPS_VALID',
      },
      policyUpdatedAt = '2026-09-04T03:00:00.000Z',
    ) {
      return {
        resolveEffectiveLocation: vi.fn().mockResolvedValue({
          id: 'location-1',
          shortCode: 'HQ',
          locationPolicy: {
            id: 'policy-1',
            maxFixAgeSeconds: 120,
            maxAccuracyMeters: 50,
            updatedAt: new Date(policyUpdatedAt),
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
          mealServing: null,
          ...completePickupSnapshot,
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
          mealServing: null,
          ...completePickupSnapshot,
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
          mealServing: null,
          ...completePickupSnapshot,
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
          mealServing: null,
          ...completePickupSnapshot,
        },
      ]);

      await expect(
        taskService.resolvePickup({ qr: signed.qr }, kitchenActor),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });
    it('rejects GPS evidence captured before an in-place policy update', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T04:00:00.000Z'));
      const locationsService = makeLocationsService(
        undefined,
        '2026-09-04T04:00:01.000Z',
      );
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
          mealServing: null,
          ...completePickupSnapshot,
        },
      ]);

      await expect(
        taskService.resolvePickup({ qr: signed.qr }, kitchenActor),
      ).rejects.toMatchObject({
        response: {
          code: 'GPS_RETRY_REQUIRED',
          details: { action: 'REFRESH' },
        },
      });
    });

    it('rejects a QR whose meal date differs from registration snapshots', async () => {
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
      const signed = taskService.generateSignedQr(
        'presenter-1',
        ['reg1'],
        '2026-09-04',
      );
      mockPrisma.registration.findMany = vi.fn().mockResolvedValue([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date('2026-09-05T00:00:00.000Z'),
          mealServing: null,
          ...completePickupSnapshot,
        },
      ]);

      await expect(
        taskService.resolvePickup({ qr: signed.qr }, kitchenActor),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });
    });

    it('maps unknown service locations to the canonical pickup conflict code', async () => {
      const locationsService = makeLocationsService();
      locationsService.resolveEffectiveLocation.mockRejectedValue(
        new NotFoundException({
          code: 'UNKNOWN_SERVICE_LOCATION',
          message: 'Service location is not available.',
        }),
      );
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
          mealDate: new Date('2026-09-24T00:00:00.000Z'),
          mealServing: null,
          ...completePickupSnapshot,
          serviceLocationCode: 'MISSING',
        },
      ]);

      await expect(
        taskService.generateQr('presenter-1', {
          registrationIds: ['reg1'],
          presenterEvidence: validEvidence,
        } as never),
      ).rejects.toMatchObject({
        response: { code: 'PICKUP_INTENT_CONFLICT' },
      });

      mockPrisma.registration.findMany.mockResolvedValueOnce([
        {
          id: 'reg1',
          userId: 'presenter-1',
          status: 'ACTIVE',
          mealDate: new Date(),
          mealServing: null,
          ...completePickupSnapshot,
          serviceLocationCode: 'MISSING',
        },
      ]);
      const signed = taskService.generateSignedQr('presenter-1', ['reg1']);
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
