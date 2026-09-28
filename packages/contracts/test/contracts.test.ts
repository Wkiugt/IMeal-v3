import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { v1 } from '../src';

describe('Contracts v1', () => {
  describe('Envelopes', () => {
    const TestDataSchema = z.object({ id: z.number() });

    it('validates success envelope', () => {
      const schema = v1.SuccessEnvelopeSchema(TestDataSchema);
      const result = schema.safeParse({ success: true, data: { id: 1 } });
      expect(result.success).toBe(true);
    });

    it('validates error envelope', () => {
      const schema = v1.ErrorEnvelopeSchema;
      const result = schema.safeParse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Pagination', () => {
    it('validates pagination request defaults', () => {
      const result = v1.CursorPaginationRequestSchema.safeParse({});
      if (!result.success) throw new Error('Expected success');
      expect(result.data.limit).toBe(20);
    });

    it('validates pagination meta', () => {
      const result = v1.CursorPaginationMetaSchema.safeParse({
        nextCursor: 'cursor_123',
        hasNextPage: true,
        totalCount: 100,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Headers', () => {
    it('validates standard headers', () => {
      const result = v1.StandardHeadersSchema.safeParse({
        'x-request-id': '123e4567-e89b-12d3-a456-426614174000',
        'x-client-platform': 'ios',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Realtime', () => {
    it('validates realtime events', () => {
      const schema = v1.RealtimeEventEnvelopeSchema(
        z.object({ userId: z.number() }),
      );
      const result = schema.safeParse({
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'MEAL_REGISTERED',
        timestamp: new Date().toISOString(),
        payload: { userId: 42 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Penalties', () => {
    it('validates penalty item DTO and status', () => {
      const penalty = {
        id: 'pen-1',
        userId: 'user-1',
        userName: 'Minh Anh',
        userEmail: 'minh.anh@example.com',
        amount: 50000,
        reason: 'NO_SHOW_PENALTY_2026-09-03',
        status: 'PENDING' as const,
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        waivedByUserId: null,
        registrationId: null,
        mealDate: null,
        createdAt: '2026-09-03T10:00:00.000Z',
        updatedAt: '2026-09-03T10:00:00.000Z',
      };
      const result = v1.PenaltyItemDtoSchema.safeParse(penalty);
      expect(result.success).toBe(true);
    });

    it('parses_legacy_nullable_menu_and_penalty_metadata', () => {
      expect(
        v1.WeekDailyMenuSchema.safeParse({
          id: 'menu-day-legacy',
          weeklyMenuId: 'week-legacy',
          date: '2026-09-21',
          isHoliday: false,
          isEnabled: true,
          menuRevisionId: null,
          mealName: null,
          description: null,
          imageUrl: null,
          createdAt: '2026-09-01T00:00:00.000Z',
        }).success,
      ).toBe(true);
      expect(
        v1.PenaltyItemDtoSchema.safeParse({
          id: 'pen-legacy',
          userId: 'user-1',
          amount: 50000,
          reason: 'NO_SHOW_PENALTY_2026-09-03',
          status: 'PENDING',
          registrationId: null,
          mealDate: null,
          createdAt: '2026-09-03T10:00:00.000Z',
          updatedAt: '2026-09-03T10:00:00.000Z',
        }).success,
      ).toBe(true);
      expect(
        v1.PenaltyItemDtoSchema.safeParse({
          id: 'pen-current',
          userId: 'user-1',
          amount: 50000,
          reason: 'NO_SHOW_PENALTY_2026-09-03',
          status: 'PENDING',
          registrationId: 'registration-1',
          mealDate: '2026-09-03',
          createdAt: '2026-09-03T10:00:00.000Z',
          updatedAt: '2026-09-03T10:00:00.000Z',
        }).success,
      ).toBe(true);
    });

    it('validates penalty metrics and list response', () => {
      const metrics = {
        totalInvoiced: 150000,
        outstandingAmount: 50000,
        pendingCount: 1,
        paidCount: 1,
        waivedCount: 1,
      };
      const listResponse = {
        items: [],
        metrics,
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
      expect(v1.PenaltyMetricsDtoSchema.safeParse(metrics).success).toBe(true);
      expect(v1.PenaltyListResponseDtoSchema.safeParse(listResponse).success).toBe(true);
    });

    it('validates waive penalty DTO minimum 5 chars requirement', () => {
      expect(v1.WaivePenaltyDtoSchema.safeParse({ reason: 'Sick' }).success).toBe(false);
      expect(v1.WaivePenaltyDtoSchema.safeParse({ reason: 'Medical leave approved' }).success).toBe(true);
    });
  });
  describe('Pickup availability', () => {
    const details = {
      availableFrom: '10:30' as const,
      availableUntil: '13:30' as const,
      timeZone: 'Asia/Ho_Chi_Minh' as const,
    };

    it('validates the closed-window error with its exact details', () => {
      const result = v1.PickupAvailabilityErrorSchema.safeParse({
        code: 'PICKUP_WINDOW_CLOSED',
        message:
          'Meal pickup is only available from 10:30 through 13:30 Vietnam time.',
        details,
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data.code).toBe('PICKUP_WINDOW_CLOSED');
      expect(result.success && result.data.details).toEqual(details);
    });

    it('validates the not-ready error with its exact details', () => {
      const result = v1.PickupAvailabilityErrorSchema.safeParse({
        code: 'PICKUP_NOT_READY',
        message:
          'Meal pickup is not currently available. Please wait for the kitchen signal.',
        details,
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data.code).toBe('PICKUP_NOT_READY');
      expect(result.success && result.data.details).toEqual(details);
    });

    it('rejects missing or incorrect availability details', () => {
      expect(
        v1.PickupAvailabilityErrorSchema.safeParse({
          code: 'PICKUP_WINDOW_CLOSED',
          message: 'closed',
          details: { ...details, availableUntil: '14:00' },
        }).success,
      ).toBe(false);
    });
  });
  describe('Registrations', () => {
    it('validates meal choices and strict status-specific batch items', () => {
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            {
              mealDate: '2026-09-05',
              status: 'ACTIVE',
              mealChoice: 'VEGETARIAN',
            },
            { mealDate: '2026-09-06', status: 'CANCELLED' },
          ],
        }).success,
      ).toBe(true);
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            {
              mealDate: '2026-09-05',
              status: 'CANCELLED',
              mealChoice: 'REGULAR',
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            { mealDate: '2026-09-05', status: 'ACTIVE' },
          ],
        }).success,
      ).toBe(false);
    });

    it('validates ordered per-date success and failure results', () => {
      const result = v1.BatchRegistrationResponseSchema.safeParse([
        { date: '2026-09-05', success: false, code: 'CUTOFF_PASSED', reason: 'Cutoff time exceeded' },
        { date: '2026-09-06', success: true },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.map((item) => item.date)).toEqual([
          '2026-09-05',
          '2026-09-06',
        ]);
      }
    });

    it('rejects unknown failure codes and result branch fields', () => {
      expect(
        v1.BatchRegistrationResponseSchema.safeParse([
          {
            date: '2026-09-05',
            success: false,
            code: 'UNKNOWN',
            reason: 'invalid',
          },
        ]).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationResponseSchema.safeParse([
          {
            date: '2026-09-05',
            success: true,
            code: 'CUTOFF_PASSED',
          },
        ]).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationResponseSchema.safeParse([
          { date: '2026-09-05', success: false, reason: 'invalid' },
        ]).success,
      ).toBe(false);
    });

    it('rejects invalid meal date formats and calendar dates', () => {
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            {
              mealDate: '09/05/2026',
              status: 'ACTIVE',
              mealChoice: 'REGULAR',
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            {
              mealDate: '2026-02-30',
              status: 'ACTIVE',
              mealChoice: 'REGULAR',
            },
          ],
        }).success,
      ).toBe(false);
    });

    it('rejects invalid registration status', () => {
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            {
              mealDate: '2026-09-05',
              status: 'PENDING',
              mealChoice: 'REGULAR',
            },
          ],
        }).success,
      ).toBe(false);
    });
    it('rejects_client_registration_location_or_menu_fields', () => {
      const activeRegistration = {
        mealDate: '2026-09-05',
        status: 'ACTIVE' as const,
        mealChoice: 'REGULAR' as const,
      };

      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [{ ...activeRegistration, locationId: 'location-1' }],
        }).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [
            { ...activeRegistration, menuRevisionId: 'revision-1' },
          ],
        }).success,
      ).toBe(false);
      expect(
        v1.BatchRegistrationRequestSchema.safeParse({
          registrations: [{ ...activeRegistration, mealName: 'Lunch' }],
        }).success,
      ).toBe(false);
    });


    it('validates the seven-day week response without Date objects', () => {
      const response = v1.WeekRegistrationResponseSchema.safeParse({
        menu: {
          id: 'week-1',
          startDate: '2026-09-21',
          endDate: '2026-09-27',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
          dailyMenus: [
            {
              id: 'menu-day-1',
              weeklyMenuId: 'week-1',
              date: '2026-09-21',
              isHoliday: false,
              isEnabled: true,
              menuRevisionId: null,
              mealName: null,
              description: null,
              imageUrl: null,
              createdAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
        registrations: [
          {
            id: 'registration-1',
            mealDate: '2026-09-25',
            status: 'ACTIVE',
            mealChoice: 'VEGETARIAN',
            menuRevisionId: null,
          },
        ],
        registrationWindow: {
          serverNow: '2026-09-20T06:00:00.000Z',
          cutoffAt: '2026-09-20T07:00:00.000Z',
          timeZone: 'Asia/Ho_Chi_Minh',
          days: [
            '2026-09-21',
            '2026-09-22',
            '2026-09-23',
            '2026-09-24',
            '2026-09-25',
            '2026-09-26',
            '2026-09-27',
          ].map((mealDate, index) => ({
            mealDate,
            cutoffAt: `2026-09-${String(20 + index).padStart(2, '0')}T07:00:00.000Z`,
            editable: index > 0,
            lunarDate: {
              day: index + 1,
              month: 8,
              year: 2026,
              isLeapMonth: false,
            },
            availableMealChoices:
              index === 4
                ? ['REGULAR', 'VEGETARIAN']
                : ['REGULAR'],
          })),
        },
      });

      expect(response.success).toBe(true);
    });

    it('requires UTC timestamps, exact seven days, and strict week response objects', () => {
      const invalidWindowDay = {
        mealDate: '2026-09-21',
        cutoffAt: '2026-09-20T14:00:00+07:00',
        editable: true,
        lunarDate: {
          day: 1,
          month: 8,
          year: 2026,
          isLeapMonth: false,
        },
        availableMealChoices: ['REGULAR'],
      };
      const response = {
        menu: null,
        registrations: [],
        registrationWindow: {
          serverNow: '2026-09-20T06:00:00.000Z',
          cutoffAt: '2026-09-20T07:00:00.000Z',
          timeZone: 'Asia/Ho_Chi_Minh',
          days: Array.from({ length: 6 }, () => invalidWindowDay),
        },
      };

      expect(
        v1.WeekRegistrationResponseSchema.safeParse(response).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          registrationWindow: {
            ...response.registrationWindow,
            days: Array.from({ length: 7 }, () => invalidWindowDay),
          },
        }).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          registrationWindow: {
            ...response.registrationWindow,
            cutoffAt: '2026-09-20T14:00:00+07:00',
            days: Array.from({ length: 7 }, () => ({
              ...invalidWindowDay,
              cutoffAt: '2026-09-20T07:00:00.000Z',
            })),
          },
        }).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          extra: true,
        }).success,
      ).toBe(false);
    });
  });

  describe('Pickup and kitchen meal choice transport', () => {
    const owner = {
      id: 'owner-1',
      name: 'Meal Owner',
      email: 'owner@example.com',
    };
    const pickupOption = {
      type: 'DELEGATED' as const,
      registrationId: 'registration-1',
      delegationId: 'delegation-1',
      mealDate: '2026-09-25',
      mealChoice: 'VEGETARIAN' as const,
      owner,
    };

    it('requires mealChoice on pickup options and serving intent items', () => {
      expect(
        v1.PickupOptionsResponseSchema.safeParse({
          options: [pickupOption],
        }).success,
      ).toBe(true);
      expect(
        v1.PickupOptionsResponseSchema.safeParse({
          options: [{ ...pickupOption, mealChoice: undefined }],
        }).success,
      ).toBe(false);
      expect(
        v1.ServingIntentItemSchema.safeParse({
          id: 'registration-1',
          itemName: 'Lunch',
          quantity: 1,
          mealChoice: 'VEGETARIAN',
        }).success,
      ).toBe(true);
      expect(
        v1.PickupOptionsResponseSchema.safeParse({
          options: [{ ...pickupOption, owner: undefined }],
        }).success,
      ).toBe(false);
      expect(
        v1.PickupOptionsResponseSchema.safeParse({
          options: [
            {
              ...pickupOption,
              type: 'OWN',
              delegationId: 'delegation-1',
              owner,
            },
          ],
        }).success,
      ).toBe(false);
    });

    it('validates resolved serving payloads with choice on every item', () => {
      const payload = {
        session: {
          id: 'session-1',
          userId: 'delegate-1',
          registrationIds: ['registration-1'],
          expiresAt: '2026-09-04T04:00:30.000Z',
          createdAt: '2026-09-04T04:00:00.000Z',
        },
        items: [pickupOption],
        pickupSessionToken: 'session-1',
        intent: {
          userId: 'delegate-1',
          items: [
            {
              id: 'registration-1',
              itemName: 'Lunch',
              quantity: 1,
              mealChoice: 'VEGETARIAN',
            },
          ],
          totalCount: 1,
          isProxy: true,
        },
      };
      expect(v1.ResolveServingResponseSchema.safeParse(payload).success).toBe(
        true,
      );
      expect(
        v1.ResolveServingResponseSchema.safeParse({
          ...payload,
          intent: {
            ...payload.intent,
            items: [{ ...payload.intent.items[0], mealChoice: undefined }],
          },
        }).success,
      ).toBe(false);
    });

    it('requires meal choice and partitions kitchen counters', () => {
      expect(
        v1.KitchenDashboardCountersSchema.parse({
          totalRegistered: 3,
          regularTotal: 2,
          vegetarianTotal: 1,
          servedTotal: 1,
          remaining: 2,
          noShowTotal: 0,
        }),
      ).toMatchObject({ regularTotal: 2, vegetarianTotal: 1 });
      expect(
        v1.KitchenDashboardCountersSchema.safeParse({
          totalRegistered: 3,
          regularTotal: 3,
          vegetarianTotal: 1,
          servedTotal: 1,
          remaining: 2,
          noShowTotal: 0,
        }).success,
      ).toBe(false);
      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          registrationId: 'registration-1',
          userId: 'user-1',
          userName: 'Meal Owner',
          userEmail: 'owner@example.com',
          mealChoice: 'VEGETARIAN',
          state: 'PENDING',
          isServed: false,
          servedAt: null,
        }).success,
      ).toBe(true);
      expect(
        v1.ServingLogItemSchema.safeParse({
          id: 'serving-1',
          registrationId: 'registration-1',
          userId: 'user-1',
          userName: 'Meal Owner',
          userEmail: 'owner@example.com',
          mealChoice: 'VEGETARIAN',
          servedAt: '2026-09-25T04:00:00.000Z',
          isProxy: false,
        }).success,
      ).toBe(true);
    });
    it('parses_dashboard_pending_served_and_no_show_states', () => {
      const baseItem = {
        registrationId: 'registration-1',
        userId: 'user-1',
        userName: 'Meal Owner',
        userEmail: 'owner@example.com',
        mealChoice: 'REGULAR' as const,
      };

      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          ...baseItem,
          state: 'PENDING',
          isServed: false,
          servedAt: null,
        }).success,
      ).toBe(true);
      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          ...baseItem,
          state: 'SERVED',
          isServed: true,
          servedAt: '2026-09-25T04:00:00.000Z',
        }).success,
      ).toBe(true);
      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          ...baseItem,
          state: 'NO_SHOW',
          isServed: false,
          servedAt: null,
        }).success,
      ).toBe(true);
    });

    it('rejects dashboard state when isServed does not match', () => {
      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          registrationId: 'registration-1',
          userId: 'user-1',
          userName: 'Meal Owner',
          userEmail: 'owner@example.com',
          mealChoice: 'REGULAR',
          state: 'SERVED',
          isServed: false,
          servedAt: null,
        }).success,
      ).toBe(false);
    });

    it('rejects unknown fields in all kitchen response objects and lists', () => {
      const counters = {
        totalRegistered: 1,
        regularTotal: 1,
        vegetarianTotal: 0,
        servedTotal: 1,
        remaining: 0,
        noShowTotal: 0,
      };
      const registrationItem = {
        registrationId: 'registration-1',
        userId: 'user-1',
        userName: 'Meal Owner',
        userEmail: 'owner@example.com',
        mealChoice: 'REGULAR' as const,
        state: 'SERVED' as const,
        isServed: true,
        servedAt: '2026-09-25T04:00:00.000Z',
      };
      const servingLog = {
        id: 'serving-1',
        registrationId: 'registration-1',
        userId: 'user-1',
        userName: 'Meal Owner',
        userEmail: 'owner@example.com',
        mealChoice: 'REGULAR' as const,
        servedAt: '2026-09-25T04:00:00.000Z',
        isProxy: false,
      };
      const snapshot = {
        date: '2026-09-25',
        isServingReady: true,
        counters,
        recentLogs: [servingLog],
        lists: {
          served: [registrationItem],
          pending: [],
          all: [registrationItem],
          noShow: [],
        },
      };

      expect(
        v1.KitchenDashboardCountersSchema.safeParse({
          ...counters,
          extra: true,
        }).success,
      ).toBe(false);
      expect(
        v1.ServingLogItemSchema.safeParse({
          ...servingLog,
          extra: true,
        }).success,
      ).toBe(false);
      expect(
        v1.KitchenRegistrationItemSchema.safeParse({
          ...registrationItem,
          extra: true,
        }).success,
      ).toBe(false);
      expect(
        v1.KitchenDashboardSnapshotSchema.safeParse({
          ...snapshot,
          extra: true,
        }).success,
      ).toBe(false);
      expect(
        v1.KitchenDashboardSnapshotSchema.safeParse({
          ...snapshot,
          lists: { ...snapshot.lists, extra: true },
        }).success,
      ).toBe(false);
    });
  });

  describe('Notifications', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const registrationId = '22222222-2222-4222-8222-222222222222';
    const copy = {
      vi: { title: 'Thông báo', body: 'Nội dung' },
      en: { title: 'Notification', body: 'Body' },
    };
    const common = {
      id,
      copy,
      readAt: null,
      createdAt: '2026-09-18T10:00:00Z',
    };

    it('accepts representative notification kinds and exact response envelopes', () => {
      const opened = v1.NotificationItemSchema.parse({
        ...common,
        kind: 'REGISTRATION_OPENED',
        payload: { weekStart: '2026-09-21', weekEnd: '2026-09-27' },
      });
      expect(opened.kind).toBe('REGISTRATION_OPENED');

      const pickup = v1.NotificationItemSchema.parse({
        ...common,
        kind: 'PICKUP_REMINDER',
        payload: {
          mealDate: '2026-09-21',
          registrationIds: [registrationId],
          registrationCount: 1,
        },
      });
      expect(pickup.payload.registrationCount).toBe(1);

      const response = v1.NotificationListResponseSchema.parse({
        data: [opened, pickup],
        meta: {
          nextCursor: id,
          hasNextPage: true,
          unreadCount: 2,
        },
      });
      expect(response.meta.nextCursor).toBe(id);
      expect(
        v1.NotificationDetailResponseSchema.parse({ data: opened }).data.id,
      ).toBe(id);
      expect(
        v1.NotificationPreferencesResponseSchema.parse({
          data: { remindersEnabled: true, locale: 'vi' },
        }).data.locale,
      ).toBe('vi');
      expect(
        v1.RegisterPushDeviceRequestSchema.parse({
          token: 'ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
          platform: 'ios',
        }).platform,
      ).toBe('ios');
    });

    it('rejects malformed notification IDs, timestamps, payloads, and list limits', () => {
      expect(
        v1.NotificationItemSchema.safeParse({
          ...common,
          id: 'not-a-uuid',
          kind: 'LEGACY_MESSAGE',
          payload: {},
        }).success,
      ).toBe(false);
      expect(
        v1.NotificationItemSchema.safeParse({
          ...common,
          createdAt: '2026-09-18T10:00:00+07:00',
          kind: 'LEGACY_MESSAGE',
          payload: {},
        }).success,
      ).toBe(false);
      expect(
        v1.NotificationItemSchema.safeParse({
          ...common,
          kind: 'REGISTRATION_OPENED',
          payload: {
            weekStart: '2026-09-21',
            weekEnd: '2026-09-27',
            unexpected: true,
          },
        }).success,
      ).toBe(false);
      expect(
        v1.NotificationItemSchema.safeParse({
          ...common,
          kind: 'PICKUP_REMINDER',
          payload: {
            mealDate: '2026-09-21',
            registrationIds: [registrationId],
            registrationCount: 2,
          },
        }).success,
      ).toBe(false);
      expect(v1.NotificationListQuerySchema.safeParse({ limit: 0 }).success).toBe(
        false,
      );
      expect(v1.NotificationListQuerySchema.safeParse({ limit: 51 }).success).toBe(
        false,
      );
      expect(
        v1.NotificationListQuerySchema.safeParse({
          cursor: 'not-a-uuid',
        }).success,
      ).toBe(false);
    });

    it('accepts only non-empty Expo push token forms', () => {
      expect(
        v1.ExpoPushTokenSchema.safeParse('ExpoPushToken[abc123]').success,
      ).toBe(true);
      expect(
        v1.ExpoPushTokenSchema.safeParse('ExponentPushToken[abc123]').success,
      ).toBe(true);
      for (const token of [
        'ExpoPushToken[]',
        'ExponentPushToken[]',
        'ExpoPushToken',
        'PushToken[abc123]',
      ]) {
        expect(v1.ExpoPushTokenSchema.safeParse(token).success).toBe(false);
      }
    });
  });
  describe('Email OTP, location, and exact pickup contracts', () => {
    it('accepts the exact OTP and evidence examples', () => {
      expect(v1.RequestOtpSchema.parse({
        email: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
      })).toEqual({
        email: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
      });
      expect(v1.PresenterLocationEvidenceSchema.parse({
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      })).toMatchObject({ accuracyMeters: 12 });
    });

    it('rejects invalid timestamps, coordinates, accuracy, and unknown fields', () => {
      expect(() => v1.PresenterLocationEvidenceSchema.parse({
        capturedAt: '2026-09-24T03:00:00.000+07:00',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      })).toThrow();
      expect(() => v1.PresenterLocationEvidenceSchema.parse({
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 91,
        longitude: 106.69,
        accuracyMeters: 12,
      })).toThrow();
      expect(() => v1.PresenterLocationEvidenceSchema.parse({
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 10.77,
        longitude: 181,
        accuracyMeters: 12,
      })).toThrow();
      expect(() => v1.PresenterLocationEvidenceSchema.parse({
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: -1,
        extra: true,
      })).toThrow();
      expect(() => v1.RequestOtpSchema.parse({
        email: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
        extra: true,
      })).toThrow();
    });
    it('keeps location and roster contracts strict', () => {
      const location = {
        locationId: 'location',
        shortCode: 'LOC-1',
        timeZone: 'Asia/Ho_Chi_Minh',
        geofenceRadiusMeters: 100,
        maxFixAgeSeconds: 30,
        maxAccuracyMeters: 50,
      };
      expect(v1.LocationPolicySchema.parse(location)).toEqual(location);
      expect(() => v1.LocationPolicySchema.parse({ ...location, geofenceRadiusMeters: 0 })).toThrow();
      expect(() => v1.LocationPolicySchema.parse({ ...location, unexpected: true })).toThrow();
      const roster = {
        email: 'employee@example.test',
        name: 'Employee',
        employeeCode: 'E-1',
        isActive: true,
        role: 'STAFF',
        serviceLocationCode: 'LOC-1',
        effectiveFrom: '2026-09-24T00:00:00.000Z',
        effectiveTo: null,
      };
      expect(v1.RosterImportRowSchema.parse(roster)).toEqual(roster);
      expect(() => v1.RosterImportRowSchema.parse({ ...roster, email: 'not-an-email' })).toThrow();
      expect(() => v1.RosterImportRowSchema.parse({ ...roster, unexpected: true })).toThrow();
    });

    it('keeps OTP responses free of clear codes and requires UTC expiry', () => {
      const response = {
        sessionToken: 'session',
        expiresAt: '2026-09-24T04:00:00.000Z',
        user: { id: 'user', email: 'employee@example.test', name: null },
      };
      expect(v1.VerifyOtpResponseSchema.parse(response)).toEqual(response);
      expect(() => v1.VerifyOtpResponseSchema.parse({ ...response, code: '123456' })).toThrow();
      expect(() => v1.VerifyOtpResponseSchema.parse({
        ...response,
        expiresAt: '2026-09-24T04:00:00.000+07:00',
      })).toThrow();
    });


    it('requires canonical sorted unique registration IDs for Generate QR', () => {
      const evidence = {
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      };
      expect(v1.GenerateQrSchema.parse({
        registrationIds: ['a', 'b'],
        presenterEvidence: evidence,
      }).registrationIds).toEqual(['a', 'b']);
      expect(() => v1.GenerateQrSchema.parse({
        registrationIds: ['a', 'a'],
        presenterEvidence: evidence,
      })).toThrow();
      expect(() => v1.GenerateQrSchema.parse({
        registrationIds: ['b', 'a'],
        presenterEvidence: evidence,
      })).toThrow();
      expect(() => v1.GenerateQrSchema.parse({
        registrationIds: ['a', ''],
        presenterEvidence: evidence,
      })).toThrow();
    });

    it('keeps resolve QR-only and confirm session-only', () => {
      expect(v1.ResolvePickupSchema.parse({ qr: 'signed-qr' })).toEqual({ qr: 'signed-qr' });
      expect(() => v1.ResolvePickupSchema.parse({ qr: 'signed-qr', presenterEvidence: {} })).toThrow();
      expect(v1.ConfirmPickupSchema.parse({
        pickupSessionId: 's',
        idempotencyKey: 'k',
      })).toEqual({
        pickupSessionId: 's',
        idempotencyKey: 'k',
      });
      expect(() => v1.ConfirmPickupSchema.parse({ pickupSessionId: '', idempotencyKey: 'k' })).toThrow();
      expect(() => v1.ErrorDetailSchema.parse({
        code: 'BAD_REQUEST',
        message: 'bad request',
        details: { reason: 'invalid input' },
        legacyField: 'preserved',
      })).not.toThrow();
      expect(v1.ErrorDetailSchema.parse({
        code: 'GPS_STALE',
        message: 'retry location',
        details: { action: 'RETRY' },
      }).details).toEqual({ action: 'RETRY' });
      expect(() => v1.ErrorDetailSchema.parse({
        code: 'GPS_STALE',
        message: 'retry location',
        details: { action: 'RETRY', latitude: 10.77 },
      })).toThrow();
      expect(() => v1.ErrorDetailSchema.parse({
        code: 'GPS_INACCURATE',
        message: 'refresh location',
        details: { action: 'REFRESH', distanceMeters: 2 },
      })).toThrow();
      expect(() => v1.ConfirmPickupSchema.parse({ pickupSessionId: 's', idempotencyKey: '' })).toThrow();
      expect(() => v1.ConfirmPickupSchema.parse({
        pickupSessionId: 's',
        idempotencyKey: 'k',
        registrationIds: ['r'],
      })).toThrow();
    });

    it('accepts safe GPS recovery details and canonical stable error codes', () => {
      expect(v1.GpsFailureDetailsSchema.parse({ action: 'RETRY' })).toEqual({ action: 'RETRY' });
      const verification: v1.ServingVerification = {
        presenterUserId: 'presenter',
        receiverType: 'SELF',
        locationId: 'location',
        gps: {
          result: 'VALID',
          capturedAt: '2026-09-24T03:00:00.000Z',
          accuracyMeters: 12,
        },
      };
      expect(verification.gps.result).toBe('VALID');
      expect(v1.GpsFailureDetailsSchema.parse({ action: 'REFRESH' })).toEqual({ action: 'REFRESH' });
      expect(() => v1.GpsFailureDetailsSchema.parse({ action: 'RETRY', latitude: 10.77 })).toThrow();
      expect(() => v1.GpsFailureDetailsSchema.parse({ action: 'RETRY', distanceMeters: 1 })).toThrow();
      expect(v1.PickupErrorCodeSchema.options).toEqual(expect.arrayContaining([
        'OTP_REQUEST_ACCEPTED',
        'OTP_INVALID_OR_EXPIRED',
        'SESSION_REVOKED',
        'GPS_RETRY_REQUIRED',
        'GPS_UNAVAILABLE',
        'GPS_STALE',
        'GPS_INACCURATE',
        'PICKUP_INTENT_REQUIRED',
        'PICKUP_INTENT_CONFLICT',
        'PICKUP_SESSION_EXPIRED',
        'IDEMPOTENCY_CONFLICT',
      ]));
      expect(v1.PickupErrorCodeSchema.options).not.toEqual(expect.arrayContaining([
        'EXACT_INTENT_REQUIRED',
        'GPS_FIX_TOO_OLD',
        'GPS_ACCURACY_TOO_LOW',
      ]));
    });
  });
});
