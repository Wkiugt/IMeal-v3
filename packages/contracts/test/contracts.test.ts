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
        createdAt: '2026-09-03T10:00:00.000Z',
        updatedAt: '2026-09-03T10:00:00.000Z',
      };
      const result = v1.PenaltyItemDtoSchema.safeParse(penalty);
      expect(result.success).toBe(true);
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
});

