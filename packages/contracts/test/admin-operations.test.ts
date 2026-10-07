import { describe, expect, it } from 'vitest';
import { v1 } from '../src';

const pagination = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
};

describe('admin oversight contracts', () => {
  it('defaults audit pagination and rejects unsafe filters', () => {
    expect(v1.AdminAuditQuerySchema.parse({}).page).toBe(1);
    expect(v1.AdminAuditQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(v1.AdminAuditQuerySchema.safeParse({ result: 'accepted' }).success).toBe(
      false,
    );
    expect(
      v1.AdminAuditQuerySchema.safeParse({ actorUserId: 'actor id' }).success,
    ).toBe(false);
  });

  it('accepts a redacted audit page and rejects secret-shaped extras', () => {
    const parsed = v1.AdminAuditListResponseSchema.parse({
      items: [
        {
          id: 'audit-1',
          action: 'USER_DISABLED',
          actorUserId: 'admin-1',
          targetUserId: 'user-1',
          result: 'DISABLED',
          resourceType: 'user',
          createdAt: '2026-10-06T00:00:00.000Z',
          details: { targetUserId: 'user-1', revokedSessionCount: 2 },
          redacted: true,
        },
      ],
      pagination,
    });
    expect(parsed.items[0]?.redacted).toBe(true);
    expect(
      v1.AdminAuditEntrySchema.safeParse({
        ...parsed.items[0],
        otp: '123456',
      }).success,
    ).toBe(false);
  });

  it('models serving audit without raw QR or GPS fields', () => {
    const parsed = v1.AdminServingAuditResponseSchema.parse({
      items: [
        {
          servingId: 'serving-1',
          servedAt: '2026-10-06T04:00:00.000Z',
          mealDate: '2026-10-06',
          registrationId: 'registration-1',
          registrationStatus: 'SERVED',
          ownerUserId: 'user-1',
          ownerName: 'Employee',
          employeeCode: 'E-1',
          locationId: 'location-1',
          locationShortCode: 'HQ',
          locationName: 'Headquarters',
          menuRevisionId: 'revision-1',
          menuName: 'Com tam',
          menuDescription: null,
          checkInSessionId: 'checkin-1',
          authenticatedActorUserId: 'user-1',
          presenterUserId: 'user-1',
          receiverType: 'SELF',
          delegationId: null,
          pickupSessionId: null,
          historicalProxy: false,
        },
      ],
      pagination,
    });
    expect(parsed.items[0]?.authenticatedActorUserId).toBe('user-1');
    expect(
      v1.AdminServingAuditItemSchema.safeParse({
        ...parsed.items[0],
        qrPayload: 'raw-qr',
        latitude: 10,
      }).success,
    ).toBe(false);
  });

  it('requires jobs health to declare that retry is unavailable', () => {
    const parsed = v1.AdminJobsResponseSchema.parse({
      api: {
        status: 'ok',
        release: 'release-1',
        checks: {
          environment: 'ok',
          database: 'ok',
          migration: 'ok',
          draining: 'ok',
        },
      },
      worker: { status: 'not_configured', release: null, checks: null },
      knownFamilies: [
        { family: 'no_show', persisted: true },
        { family: 'otp_delivery', persisted: false },
      ],
      items: [],
      pagination: { ...pagination, total: 0, totalPages: 0 },
      retryAvailable: false,
    });
    expect(parsed.retryAvailable).toBe(false);
    expect(
      v1.AdminJobsResponseSchema.safeParse({ ...parsed, retryAvailable: true }).success,
    ).toBe(false);
  });
});
