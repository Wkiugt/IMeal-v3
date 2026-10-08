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
    it('preserves the v1 namespace and restored error exports', () => {
      const code: v1.ErrorCode = 'BAD_REQUEST';
      const detail: v1.ErrorDetail = { code, message: 'Invalid request' };

      expect(v1.ErrorCodeSchema.safeParse(code).success).toBe(true);
      expect(v1.ErrorDetailSchema.safeParse(detail).success).toBe(true);
      expect(v1.ErrorCodeSchema.safeParse('METHOD_NOT_ALLOWED').success).toBe(false);
      expect(v1.ErrorDetailSchema.safeParse({ code: 'BAD_REQUEST' }).success).toBe(false);
      expect(v1.ErrorEnvelopeSchema.safeParse({ success: false, error: detail }).success).toBe(
        true,
      );
      expect(v1.GpsRecoveryActionSchema.safeParse('RETRY').success).toBe(true);
      expect(v1.GpsFailureDetailsSchema.safeParse({ action: 'RETRY' }).success).toBe(true);
    });

    it('accepts the legacy discriminated error envelope and rejects the raw API shape', () => {
      expect(
        v1.ErrorEnvelopeSchema.safeParse({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid request' },
          meta: { requestId: 'request-1' },
        }).success,
      ).toBe(true);
      expect(
        v1.ErrorEnvelopeSchema.safeParse({
          statusCode: 400,
          errorCode: 'BAD_REQUEST',
          message: 'Invalid request',
          requestId: 'request-1',
        }).success,
      ).toBe(false);
    });

    it('discriminates success and failure envelopes on success', () => {
      const schema = v1.EnvelopeSchema(TestDataSchema);

      expect(schema.safeParse({ success: true, data: { id: 1 } }).success).toBe(true);
      expect(
        schema.safeParse({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Missing resource' },
        }).success,
      ).toBe(true);
      expect(schema.safeParse({ success: false, data: { id: 1 } }).success).toBe(false);
    });

    it('keeps ApiErrorResponseSchema separate with 400-through-599 status bounds', () => {
      const response = {
        statusCode: 400,
        errorCode: 'BAD_REQUEST' as const,
        message: 'Invalid request',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(v1.ApiErrorResponseSchema.safeParse(response).success).toBe(true);
      expect(v1.ErrorEnvelopeSchema.safeParse(response).success).toBe(false);
      expect(
        v1.ApiErrorResponseSchema.safeParse({ ...response, statusCode: 399 }).success,
      ).toBe(false);
      expect(
        v1.ApiErrorResponseSchema.safeParse({ ...response, statusCode: 600 }).success,
      ).toBe(false);
    });

    it('preserves GPS recovery details and action types', () => {
      expect(v1.GpsRecoveryActionSchema.safeParse('RETRY').success).toBe(true);
      expect(v1.GpsRecoveryActionSchema.safeParse('REFRESH').success).toBe(true);
      expect(v1.GpsFailureDetailsSchema.safeParse({ action: 'RETRY' }).success).toBe(true);
      expect(v1.GpsFailureDetailsSchema.safeParse({ action: 'RECALIBRATE' }).success).toBe(
        false,
      );
    });


    it('validates the canonical API error response exactly', () => {
      const schema = v1.ApiErrorResponseSchema;
      const response = {
        statusCode: 400,
        errorCode: 'INVALID_EFFECTIVE_RANGE',
        message: 'The request could not be processed.',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      };
      const result = schema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(response);
      expect(schema.safeParse({ ...response, details: { field: 'email' } }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...response, error: { code: 'NOT_FOUND' } }).success).toBe(
        false,
      );
    });

    it('accepts intentional public domain codes but rejects arbitrary codes', () => {
      expect(
        v1.PublicErrorCodeSchema.safeParse('REGISTRATION_FAILED').success,
      ).toBe(true);
      expect(v1.PublicErrorCodeSchema.safeParse('P2002').success).toBe(false);
      expect(v1.PublicErrorCodeSchema.safeParse('SMTP_PROVIDER_ERROR').success).toBe(
        false,
      );
    });
    it.each([
      'METHOD_NOT_ALLOWED',
      'REQUEST_TIMEOUT',
      'GONE',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'UNPROCESSABLE_ENTITY',
      'NOT_IMPLEMENTED',
      'BAD_GATEWAY',
      'GATEWAY_TIMEOUT',
    ] as const)('accepts canonical HTTP error code %s', (code) => {
      expect(v1.PublicErrorCodeSchema.safeParse(code).success).toBe(true);
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

  describe('Employee activity', () => {
    const registrationBase = {
      id: 'registration-1',
      mealDate: '2026-09-30',
      status: 'SERVED' as const,
      mealChoice: 'REGULAR' as const,
      menuRevisionId: 'revision-1',
      menuNameSnapshot: 'Cơm gà',
      menuDescriptionSnapshot: null,
      menuImageSnapshot: null,
      serviceLocationId: 'location-1',
      serviceLocationAssignmentId: 'assignment-1',
      serviceLocationCode: 'LOC-A',
      serviceLocationName: 'Main Hall',
      serviceLocationAddress: '1 Main Street',
      serviceLocationEffectiveFrom: '2026-01-01T00:00:00.000Z',
      serviceLocationSnapshotAt: '2026-09-30T00:00:00.000Z',
      registeredAt: '2026-09-29T07:00:00.000Z',
      cancelledAt: null,
      noShowAt: null,
      servedAt: '2026-09-30T05:30:00.000Z',
      createdAt: '2026-09-29T07:00:00.000Z',
      updatedAt: '2026-09-30T05:30:00.000Z',
    };

    it('validates page pagination defaults and safe maximum', () => {
      expect(v1.PagePaginationRequestSchema.parse({})).toEqual({
        page: 1,
        limit: 20,
      });
      expect(
        v1.PagePaginationRequestSchema.safeParse({
          page: 21_474_837,
          limit: 100,
        }).success,
      ).toBe(true);
      expect(
        v1.PagePaginationRequestSchema.safeParse({
          page: 21_474_838,
          limit: 100,
        }).success,
      ).toBe(false);
      expect(
        v1.PagePaginationRequestSchema.safeParse({
          page: Number.MAX_SAFE_INTEGER + 1,
          limit: 20,
        }).success,
      ).toBe(false);
      expect(
        v1.PagePaginationRequestSchema.safeParse({ page: 1, limit: 101 })
          .success,
      ).toBe(false);
      expect(
        v1.PagePaginationRequestSchema.safeParse({
          page: 1,
          limit: 20,
          userId: 'not-accepted',
        }).success,
      ).toBe(false);
    });

    it('validates history snapshots, timestamps, and penalty summaries', () => {
      const result = v1.EmployeeRegistrationActivitySchema.safeParse({
        ...registrationBase,
        penalties: [
          {
            id: 'penalty-1',
            amount: 50000,
            status: 'PENDING',
            createdAt: '2026-10-01T06:45:00.000Z',
            paidAt: null,
            waivedAt: null,
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(
        v1.EmployeeRegistrationActivitySchema.safeParse({
          ...registrationBase,
          status: 'UNKNOWN',
          penalties: [],
        }).success,
      ).toBe(false);
      expect(
        v1.EmployeeRegistrationActivitySchema.safeParse({
          ...registrationBase,
          menuRevisionId: null,
          menuNameSnapshot: null,
          menuDescriptionSnapshot: null,
          menuImageSnapshot: null,
          serviceLocationId: null,
          serviceLocationAssignmentId: null,
          serviceLocationCode: null,
          serviceLocationName: null,
          serviceLocationAddress: null,
          serviceLocationEffectiveFrom: null,
          serviceLocationSnapshotAt: null,
          registeredAt: null,
          cancelledAt: null,
          noShowAt: null,
          servedAt: null,
          penalties: [],
        }).success,
      ).toBe(true);
    });

    it('validates stats defaults, period metadata, and zero counts', () => {
      expect(v1.RegistrationStatsQuerySchema.parse({})).toEqual({});
      expect(
        v1.RegistrationStatsQuerySchema.safeParse({ month: '2026-13' }).success,
      ).toBe(false);
      expect(
        v1.RegistrationStatsResponseSchema.safeParse({
          data: {
            period: {
              month: '2026-09',
              startDate: '2026-09-01',
              endDate: '2026-09-30',
            },
            booked: 0,
            enjoyed: 0,
          },
        }).success,
      ).toBe(true);
    });

    it('validates self penalty context without nested summaries', () => {
      const result = v1.SelfPenaltyListResponseSchema.safeParse({
        data: [
          {
            id: 'penalty-1',
            amount: 50000,
            reason: 'NO_SHOW_PENALTY_2026-09-30',
            status: 'WAIVED',
            mealDate: '2026-09-30',
            createdAt: '2026-10-01T06:45:00.000Z',
            paidAt: null,
            waivedAt: '2026-10-02T06:45:00.000Z',
            waiveReason: 'Approved leave',
            registration: {
              ...registrationBase,
              status: 'NO_SHOW',
              servedAt: null,
            },
          },
        ],
        meta: {
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
            hasNextPage: false,
          },
        },
      });
      expect(result.success).toBe(true);
      expect(
        v1.SelfPenaltySchema.safeParse({
          id: 'penalty-legacy',
          amount: 50000,
          reason: 'legacy',
          status: 'PENDING',
          mealDate: null,
          createdAt: '2026-10-01T06:45:00.000Z',
          paidAt: null,
          waivedAt: null,
          waiveReason: null,
          registration: null,
        }).success,
      ).toBe(true);
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
      expect(
        v1.PenaltyListResponseDtoSchema.safeParse(listResponse).success,
      ).toBe(true);
    });

    it('validates waive penalty DTO minimum 5 chars requirement', () => {
      expect(
        v1.WaivePenaltyDtoSchema.safeParse({ reason: 'Sick' }).success,
      ).toBe(false);
      expect(
        v1.WaivePenaltyDtoSchema.safeParse({ reason: 'Medical leave approved' })
          .success,
      ).toBe(true);
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
          registrations: [{ mealDate: '2026-09-05', status: 'ACTIVE' }],
        }).success,
      ).toBe(false);
    });

    it('validates ordered per-date success and failure results', () => {
      const result = v1.BatchRegistrationResponseSchema.safeParse([
        {
          date: '2026-09-05',
          success: false,
          code: 'CUTOFF_PASSED',
          reason: 'Cutoff time exceeded',
        },
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

    it('accepts weekly registration restriction failure and day reasons', () => {
      expect(
        v1.BatchRegistrationResponseSchema.safeParse([
          {
            date: '2026-09-07',
            success: false,
            code: 'REGISTRATION_WEEK_NOT_OPEN',
            reason: 'Registration week is not open',
          },
          {
            date: '2026-09-14',
            success: false,
            code: 'OUTSIDE_REGISTRATION_WINDOW',
            reason: 'Date is outside the registration window',
          },
        ]).success,
      ).toBe(true);
      expect(
        v1.RegistrationDayUnavailableReasonSchema.safeParse(
          'REGISTRATION_WEEK_NOT_OPEN',
        ).success,
      ).toBe(true);
      expect(
        v1.RegistrationDayUnavailableReasonSchema.safeParse(
          'OUTSIDE_REGISTRATION_WINDOW',
        ).success,
      ).toBe(true);
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

    it('requires the exact UTC next-week opening timestamp', () => {
      const window = {
        serverNow: '2026-09-05T10:00:00.000Z',
        cutoffAt: '2026-09-04T07:00:00.000Z',
        timeZone: 'Asia/Ho_Chi_Minh' as const,
        nextWeekOpenAt: '2026-09-05T10:00:00.000Z',
        days: Array.from({ length: 7 }, (_, index) => ({
          mealDate: `2026-09-${String(5 + index).padStart(2, '0')}`,
          cutoffAt: '2026-09-04T07:00:00.000Z',
          editable: true,
          lunarDate: {
            day: 1,
            month: 8,
            year: 2026,
            isLeapMonth: false,
          },
          availableMealChoices: ['REGULAR' as const],
        })),
      };

      expect(v1.RegistrationWindowSchema.safeParse(window).success).toBe(true);
      expect(
        v1.RegistrationWindowSchema.safeParse({
          ...window,
          nextWeekOpenAt: undefined,
        }).success,
      ).toBe(false);
      expect(
        v1.RegistrationWindowSchema.safeParse({
          ...window,
          nextWeekOpenAt: '2026-09-05T17:00:00+07:00',
        }).success,
      ).toBe(false);
      expect(
        v1.RegistrationWindowSchema.safeParse({
          ...window,
          nextWeekOpenAt: '2026-09-05T10:00:00.000Z',
          unknown: true,
        }).success,
      ).toBe(false);
    });

    it('validates a complete seven-day response with real menu, location, and lifecycle fields', () => {
      const mealDates = [
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ];
      const menuDays = mealDates.map((mealDate, index) => ({
        id: `menu-day-${index + 1}`,
        weeklyMenuId: 'week-1',
        date: mealDate,
        isHoliday: false,
        isEnabled: true,
        menuRevisionId: `revision-${index + 1}`,
        mealName: `Meal ${index + 1}`,
        description: `Description ${index + 1}`,
        imageUrl: `https://example.test/meal-${index + 1}.jpg`,
        createdAt: '2026-09-01T00:00:00.000Z',
      }));
      const registrations = [
        {
          id: 'registration-active',
          mealDate: mealDates[0],
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
          menuRevisionId: 'revision-1',
        },
        {
          id: 'registration-served',
          mealDate: mealDates[1],
          status: 'SERVED',
          mealChoice: 'REGULAR',
          menuRevisionId: 'revision-2',
        },
        {
          id: 'registration-no-show',
          mealDate: mealDates[2],
          status: 'NO_SHOW',
          mealChoice: 'REGULAR',
          menuRevisionId: 'revision-3',
        },
        {
          id: 'registration-cancelled',
          mealDate: mealDates[3],
          status: 'CANCELLED',
          mealChoice: 'VEGETARIAN',
          menuRevisionId: 'revision-4',
        },
      ];
      const locations = [
        {
          id: 'snapshot-location',
          shortCode: 'SNAP',
          displayName: 'Snapshot Hall',
          address: '1 Snapshot Street',
          source: 'REGISTRATION_SNAPSHOT',
        },
        {
          id: 'effective-location-1',
          shortCode: 'LOC-1',
          displayName: 'Location One',
          address: '1 Location Street',
          source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
        },
        {
          id: 'effective-location-2',
          shortCode: 'LOC-2',
          displayName: 'Location Two',
          address: '2 Location Street',
          source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
        },
        {
          id: 'effective-location-3',
          shortCode: 'LOC-3',
          displayName: 'Location Three',
          address: '3 Location Street',
          source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
        },
        null,
        {
          id: 'effective-location-6',
          shortCode: 'LOC-6',
          displayName: 'Location Six',
          address: '6 Location Street',
          source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
        },
        null,
      ];
      const days = mealDates.map((mealDate, index) => {
        const registration =
          registrations.find((candidate) => candidate.mealDate === mealDate) ??
          null;
        const isFinalized =
          registration?.status === 'SERVED' ||
          registration?.status === 'NO_SHOW';
        const isCancelled = registration?.status === 'CANCELLED';
        const unavailable =
          index === 6
            ? ['NO_PUBLISHED_MENU']
            : registration?.status === 'ACTIVE'
              ? ['ALREADY_ACTIVE']
              : isFinalized
                ? ['REGISTRATION_FINALIZED']
                : [];
        return {
          mealDate,
          menu: index === 6 ? null : menuDays[index],
          registration,
          location: locations[index],
          lunarDate: {
            day: index === 4 ? 15 : index === 5 ? 1 : index + 2,
            month: 8,
            year: 2026,
            isLeapMonth: index === 5,
          },
          availableMealChoices:
            index === 3 || index === 4
              ? ['REGULAR', 'VEGETARIAN']
              : ['REGULAR'],
          cutoffAt: `2026-09-${String(20 + index).padStart(2, '0')}T07:00:00.000Z`,
          canActivate: isCancelled || (!registration && index !== 6),
          canCancel: registration?.status === 'ACTIVE',
          canChangeMealChoice: registration?.status === 'ACTIVE',
          unavailableReasons: {
            activate: unavailable,
            cancel:
              registration?.status === 'ACTIVE'
                ? []
                : isFinalized
                  ? ['REGISTRATION_FINALIZED']
                  : ['NOT_ACTIVE'],
            changeMealChoice:
              registration?.status === 'ACTIVE' ? [] : ['NOT_ACTIVE'],
          },
        };
      });
      const registrationWindowDays = mealDates.map((mealDate, index) => ({
        mealDate,
        cutoffAt: `2026-09-${String(20 + index).padStart(2, '0')}T07:00:00.000Z`,
        editable: index > 0,
        lunarDate: days[index].lunarDate,
        availableMealChoices: days[index].availableMealChoices,
      }));

      const response = v1.WeekRegistrationResponseSchema.safeParse({
        menu: {
          id: 'week-1',
          startDate: '2026-09-21',
          endDate: '2026-09-27',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
          dailyMenus: menuDays.slice(0, 6),
        },
        registrations,
        days,
        registrationWindow: {
          serverNow: '2026-09-20T06:00:00.000Z',
          nextWeekOpenAt: '2026-09-19T10:00:00.000Z',
          cutoffAt: '2026-09-20T07:00:00.000Z',
          timeZone: 'Asia/Ho_Chi_Minh',
          days: registrationWindowDays,
        },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect(response.data.menu?.dailyMenus[0]).toMatchObject({
          mealName: 'Meal 1',
          menuRevisionId: 'revision-1',
        });
        expect(response.data.days[0]).toMatchObject({
          registration: { status: 'ACTIVE' },
          location: { source: 'REGISTRATION_SNAPSHOT' },
        });
        expect(response.data.days[1].registration?.status).toBe('SERVED');
        expect(response.data.days[2].registration?.status).toBe('NO_SHOW');
        expect(response.data.days[3].registration?.status).toBe('CANCELLED');
        expect(response.data.days[5].lunarDate).toMatchObject({
          day: 1,
          isLeapMonth: true,
        });
        expect(response.data.days[6]).toMatchObject({
          menu: null,
          unavailableReasons: { activate: ['NO_PUBLISHED_MENU'] },
        });
      }
    });

    it('rejects a day with an unknown action reason or extra presentation field', () => {
      const day = {
        mealDate: '2026-09-21',
        menu: null,
        registration: null,
        location: null,
        lunarDate: {
          day: 1,
          month: 8,
          year: 2026,
          isLeapMonth: false,
        },
        availableMealChoices: ['REGULAR'],
        cutoffAt: '2026-09-20T07:00:00.000Z',
        canActivate: false,
        canCancel: false,
        canChangeMealChoice: false,
        unavailableReasons: {
          activate: ['UNKNOWN'],
          cancel: ['NOT_ACTIVE'],
          changeMealChoice: ['NOT_ACTIVE'],
        },
      };

      expect(v1.WeekRegistrationDaySchema.safeParse(day).success).toBe(false);
      expect(
        v1.WeekRegistrationDaySchema.safeParse({
          ...day,
          unavailableReasons: {
            activate: ['NO_PUBLISHED_MENU'],
            cancel: ['NOT_ACTIVE'],
            changeMealChoice: ['NOT_ACTIVE'],
          },
          extra: true,
        }).success,
      ).toBe(false);
    });
    it('rejects non-UTC timestamps, non-seven-day arrays, and strict response extras', () => {
      const mealDates = [
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ];
      const validDay = (mealDate: string) => ({
        mealDate,
        menu: null,
        registration: null,
        location: null,
        lunarDate: {
          day: 1,
          month: 8,
          year: 2026,
          isLeapMonth: false,
        },
        availableMealChoices: ['REGULAR'],
        cutoffAt: '2026-09-20T07:00:00.000Z',
        canActivate: false,
        canCancel: false,
        canChangeMealChoice: false,
        unavailableReasons: {
          activate: ['NO_PUBLISHED_MENU'],
          cancel: ['NOT_ACTIVE'],
          changeMealChoice: ['NOT_ACTIVE'],
        },
      });
      const validWindowDay = (mealDate: string) => ({
        mealDate,
        cutoffAt: '2026-09-20T07:00:00.000Z',
        editable: false,
        lunarDate: {
          day: 1,
          month: 8,
          year: 2026,
          isLeapMonth: false,
        },
        availableMealChoices: ['REGULAR'],
      });
      const response = {
        menu: null,
        registrations: [],
        days: mealDates.map(validDay),
        registrationWindow: {
          serverNow: '2026-09-20T06:00:00.000Z',
          nextWeekOpenAt: '2026-09-19T10:00:00.000Z',
          cutoffAt: '2026-09-20T07:00:00.000Z',
          timeZone: 'Asia/Ho_Chi_Minh',
          days: mealDates.map(validWindowDay),
        },
      };

      expect(
        v1.WeekRegistrationResponseSchema.safeParse(response).success,
      ).toBe(true);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          days: response.days.slice(0, 6),
        }).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          registrationWindow: {
            ...response.registrationWindow,
            days: response.registrationWindow.days.slice(0, 6),
          },
        }).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          days: [
            {
              ...response.days[0],
              cutoffAt: '2026-09-20T14:00:00+07:00',
            },
            ...response.days.slice(1),
          ],
        }).success,
      ).toBe(false);
      expect(
        v1.WeekRegistrationResponseSchema.safeParse({
          ...response,
          registrationWindow: {
            ...response.registrationWindow,
            cutoffAt: '2026-09-20T14:00:00+07:00',
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
      expect(
        v1.NotificationListQuerySchema.safeParse({ limit: 0 }).success,
      ).toBe(false);
      expect(
        v1.NotificationListQuerySchema.safeParse({ limit: 51 }).success,
      ).toBe(false);
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
      expect(
        v1.RequestOtpSchema.parse({
          email: 'employee@example.test',
          purpose: 'SESSION_LOGIN',
        }),
      ).toEqual({
        email: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
      });
      expect(
        v1.PresenterLocationEvidenceSchema.parse({
          capturedAt: '2026-09-24T03:00:00.000Z',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: 12,
        }),
      ).toMatchObject({ accuracyMeters: 12 });
    });

    it('rejects invalid timestamps, coordinates, accuracy, and unknown fields', () => {
      expect(() =>
        v1.PresenterLocationEvidenceSchema.parse({
          capturedAt: '2026-09-24T03:00:00.000+07:00',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: 12,
        }),
      ).toThrow();
      expect(() =>
        v1.PresenterLocationEvidenceSchema.parse({
          capturedAt: '2026-09-24T03:00:00.000Z',
          latitude: 91,
          longitude: 106.69,
          accuracyMeters: 12,
        }),
      ).toThrow();
      expect(() =>
        v1.PresenterLocationEvidenceSchema.parse({
          capturedAt: '2026-09-24T03:00:00.000Z',
          latitude: 10.77,
          longitude: 181,
          accuracyMeters: 12,
        }),
      ).toThrow();
      expect(() =>
        v1.PresenterLocationEvidenceSchema.parse({
          capturedAt: '2026-09-24T03:00:00.000Z',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: -1,
          extra: true,
        }),
      ).toThrow();
      expect(() =>
        v1.RequestOtpSchema.parse({
          email: 'employee@example.test',
          purpose: 'SESSION_LOGIN',
          extra: true,
        }),
      ).toThrow();
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
      expect(() =>
        v1.LocationPolicySchema.parse({ ...location, geofenceRadiusMeters: 0 }),
      ).toThrow();
      expect(() =>
        v1.LocationPolicySchema.parse({ ...location, unexpected: true }),
      ).toThrow();
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
      expect(() =>
        v1.RosterImportRowSchema.parse({ ...roster, email: 'not-an-email' }),
      ).toThrow();
      expect(() =>
        v1.RosterImportRowSchema.parse({ ...roster, unexpected: true }),
      ).toThrow();
    });

    it('keeps OTP responses free of clear codes and requires UTC expiry', () => {
      const response = {
        sessionToken: 'session',
        expiresAt: '2026-09-24T04:00:00.000Z',
        user: { id: 'user', email: 'employee@example.test', name: null },
      };
      expect(v1.VerifyOtpResponseSchema.parse(response)).toEqual(response);
      expect(() =>
        v1.VerifyOtpResponseSchema.parse({ ...response, code: '123456' }),
      ).toThrow();
      expect(() =>
        v1.VerifyOtpResponseSchema.parse({
          ...response,
          expiresAt: '2026-09-24T04:00:00.000+07:00',
        }),
      ).toThrow();
    });



    it('accepts safe GPS recovery details and canonical stable error codes', () => {
      expect(v1.GpsFailureDetailsSchema.parse({ action: 'RETRY' })).toEqual({
        action: 'RETRY',
      });
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
      expect(v1.GpsFailureDetailsSchema.parse({ action: 'REFRESH' })).toEqual({
        action: 'REFRESH',
      });
      expect(() =>
        v1.GpsFailureDetailsSchema.parse({ action: 'RETRY', latitude: 10.77 }),
      ).toThrow();
      expect(() =>
        v1.GpsFailureDetailsSchema.parse({
          action: 'RETRY',
          distanceMeters: 1,
        }),
      ).toThrow();
      expect(v1.OperationalErrorCodeSchema.options).toEqual(
        expect.arrayContaining([
          'OTP_REQUEST_ACCEPTED',
          'OTP_INVALID_OR_EXPIRED',
          'SESSION_REVOKED',
          'GPS_RETRY_REQUIRED',
          'GPS_UNAVAILABLE',
          'GPS_STALE',
          'GPS_INACCURATE',
          'INVALID_QR',
          'INACTIVE_CHECKIN_SESSION',
          'IDEMPOTENCY_CONFLICT',
        ]),
      );
      expect(v1.OperationalErrorCodeSchema.options).not.toEqual(
        expect.arrayContaining([
          'PICKUP_INTENT_REQUIRED',
          'PICKUP_INTENT_CONFLICT',
          'PICKUP_SESSION_EXPIRED',
          'EXACT_INTENT_REQUIRED',
          'GPS_FIX_TOO_OLD',
          'GPS_ACCURACY_TOO_LOW',
        ]),
      );
    });
  describe('Self check-in contracts', () => {
    const location = {
      id: 'location-1',
      shortCode: 'LOC-A',
      displayName: 'Main Hall',
      servingPointName: 'Lunch counter',
      address: '1 Main Street',
    } as const;
    const window = {
      opensAt: '2026-09-30T03:30:00.000Z',
      closesAt: '2026-09-30T06:30:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
    } as const;

    it('requires GPS evidence when resolving a shared QR', () => {
      expect(
        v1.ResolveCheckInSchema.safeParse({
          qr: 'opaque-shared-qr',
        }).success,
      ).toBe(false);
      expect(
        v1.ResolveCheckInSchema.safeParse({
          qr: 'opaque-shared-qr',
          gps: {
            capturedAt: '2026-09-30T03:35:00.000Z',
            latitude: 10.77,
            longitude: 106.69,
            accuracyMeters: 12,
          },
        }).success,
      ).toBe(true);
    });

    it('requires the resolved intent nonce for confirmation', () => {
      const gps = {
        capturedAt: '2026-09-30T03:35:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      };
      expect(
        v1.ConfirmCheckInSchema.safeParse({
          sessionId: 'check-in-session-1',
          idempotencyKey: 'idempotency-1',
          gps,
        }).success,
      ).toBe(false);
      expect(
        v1.ConfirmCheckInSchema.safeParse({
          sessionId: 'check-in-session-1',
          intentNonce: 'opaque-resolve-intent',
          idempotencyKey: 'idempotency-1',
          gps,
        }).success,
      ).toBe(true);
    });

    it('accepts stable location QR and enforces aggregate counter invariants', () => {
      expect(
        v1.KitchenCheckInQrResponseSchema.safeParse({
          data: {
            qr: 'opaque-shared-qr',
            date: '2026-09-30',
            location,
            activeFrom: window.opensAt,
            expiresAt: window.closesAt,
          },
        }).success,
      ).toBe(true);
      expect(
        v1.KitchenCheckInDashboardSchema.safeParse({
          date: '2026-09-30',
          location,
          window,
          lastUpdated: '2026-09-30T04:00:00.000Z',
          counts: {
            registered: 4,
            checkedIn: 2,
            pending: 1,
            noShow: 1,
            regular: 3,
            vegetarian: 1,
          },
        }).success,
      ).toBe(true);
      expect(
        v1.KitchenCheckInDashboardSchema.safeParse({
          date: '2026-09-30',
          location,
          window,
          lastUpdated: '2026-09-30T04:00:00.000Z',
          counts: {
            registered: 4,
            checkedIn: 3,
            pending: 1,
            noShow: 1,
            regular: 3,
            vegetarian: 1,
          },
        }).success,
      ).toBe(false);
    });

    it('exposes only the requested stable check-in error codes', () => {
      expect(v1.CheckInErrorCodeSchema.options).toEqual(
        expect.arrayContaining([
          'INVALID_QR',
          'INACTIVE_CHECKIN_SESSION',
          'NO_REGISTRATION',
          'REGISTRATION_CANCELLED',
          'ALREADY_CHECKED_IN',
          'OUTSIDE_CHECKIN_WINDOW',
          'LOCATION_MISMATCH',
          'GPS_REQUIRED',
          'GPS_STALE',
          'GPS_INACCURATE',
          'OUTSIDE_GEOFENCE',
        ]),
      );
    });
  });
  });
  describe('Public error-code runtime set', () => {
    it('matches canonical code schemas with true-valued own keys only', () => {
      const keys = Object.keys(v1.PUBLIC_ERROR_CODES).sort();
      expect(keys).toEqual([...v1.PUBLIC_ERROR_CODE_VALUES].sort());
      for (const key of keys) {
        expect(v1.PUBLIC_ERROR_CODES[key]).toBe(true);
      }

      const canonicalSchemaCodes = [
        ...v1.ErrorCodeSchema.options,
        ...v1.OperationalErrorCodeSchema.options,
        ...v1.CheckInErrorCodeSchema.options,
        ...v1.RegistrationFailureCodeSchema.options,
      ];
      const providerOtpCodes = [
        'OTP_PROVIDER_UNAVAILABLE',
        'OTP_REQUEST_ACCEPTED',
        'OTP_INVALID_OR_EXPIRED',
        'OTP_RATE_LIMITED',
      ] as const;
      const menuRosterLocationCodes = [
        'MENU_NOT_FOUND',
        'INVALID_EFFECTIVE_RANGE',
        'ROSTER_BATCH_NOT_FOUND',
        'ROSTER_IMPORT_REJECTED',
        'UNKNOWN_SERVICE_LOCATION',
        'INVALID_LOCATION_POLICY',
        'LOCATION_COORDINATES_REQUIRED',
      ] as const;
      const adminCodes = [
        'ADMIN_MANAGED_ROLES_UNAVAILABLE',
        'ADMIN_SELF_DISABLE_FORBIDDEN',
        'ADMIN_LAST_ACTIVE_ADMIN',
      ] as const;
      const notificationCodes = [
        'INVALID_NOTIFICATION_CURSOR',
        'INVALID_NOTIFICATION_PREFERENCE',
        'INVALID_PUSH_TOKEN',
        'INVALID_NOTIFICATION_KIND',
        'NOTIFICATION_NOT_FOUND',
      ] as const;

      for (const code of [
        ...canonicalSchemaCodes,
        ...providerOtpCodes,
        ...menuRosterLocationCodes,
        ...adminCodes,
        ...notificationCodes,
      ]) {
        expect(Object.hasOwn(v1.PUBLIC_ERROR_CODES, code), code).toBe(true);
      }
      expect(Object.hasOwn(v1.PUBLIC_ERROR_CODES, 'toString')).toBe(false);
      expect(Object.hasOwn(v1.PUBLIC_ERROR_CODES, 'password=secret')).toBe(
        false,
      );
    });
  });
});
