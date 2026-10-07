import { describe, expect, it, vi } from 'vitest';
import { AdminServingAuditService } from './admin-serving.service.js';

describe('AdminServingAuditService', () => {
  it('maps self check-in and historical proxy evidence without raw QR or GPS', async () => {
    const servedAt = new Date('2026-10-06T04:00:00.000Z');
    const mealDate = new Date('2026-10-06T00:00:00.000Z');
    const prisma = {
      mealServing: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'serving-1',
            servedAt,
            mealDate,
            registrationId: 'registration-1',
            ownerUserId: 'user-1',
            ownerNameSnapshot: 'Employee',
            presenterUserId: 'user-1',
            receiverType: 'SELF',
            locationId: 'location-1',
            locationShortCode: 'HQ',
            locationNameSnapshot: 'Headquarters',
            menuRevisionId: 'revision-1',
            menuNameSnapshot: 'Com tam',
            menuDescriptionSnapshot: null,
            checkInSessionId: 'checkin-1',
            delegationId: null,
            pickupSessionId: null,
            registration: {
              status: 'SERVED',
              employeeCodeSnapshot: 'E-1',
              ownerNameSnapshot: 'Employee',
              userId: 'user-1',
              serviceLocationAssignment: null,
              user: { name: 'Employee' },
            },
            ownerUser: { name: 'Employee' },
            presenterUser: { name: 'Employee' },
          },
          {
            id: 'serving-2',
            servedAt,
            mealDate,
            registrationId: 'registration-2',
            ownerUserId: 'owner-2',
            ownerNameSnapshot: 'Owner',
            presenterUserId: 'presenter-2',
            receiverType: 'PROXY',
            locationId: 'location-1',
            locationShortCode: 'HQ',
            locationNameSnapshot: 'Headquarters',
            menuRevisionId: null,
            menuNameSnapshot: null,
            menuDescriptionSnapshot: null,
            checkInSessionId: null,
            delegationId: 'delegation-1',
            pickupSessionId: 'pickup-1',
            registration: {
              status: 'SERVED',
              employeeCodeSnapshot: null,
              ownerNameSnapshot: 'Owner',
              userId: 'owner-2',
              serviceLocationAssignment: { employeeCode: 'E-2' },
              user: { name: 'Owner' },
            },
            ownerUser: { name: 'Owner' },
            presenterUser: { name: 'Presenter' },
          },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
      servingConfirmRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'confirm-1',
            callerUserId: 'user-1',
            resultServingIds: ['serving-1'],
          },
        ]),
      },
    };
    const service = new AdminServingAuditService(prisma as never);

    const page = await service.list({ page: 1, limit: 20 });

    expect(page.items[0]).toMatchObject({
      servingId: 'serving-1',
      employeeCode: 'E-1',
      authenticatedActorUserId: 'user-1',
      presenterUserId: 'user-1',
      receiverType: 'SELF',
      historicalProxy: false,
      checkInSessionId: 'checkin-1',
    });
    expect(page.items[1]).toMatchObject({
      servingId: 'serving-2',
      employeeCode: 'E-2',
      authenticatedActorUserId: null,
      receiverType: 'PROXY',
      delegationId: 'delegation-1',
      historicalProxy: true,
    });
    expect(JSON.stringify(page)).not.toMatch(/qr|latitude|longitude|otp|token|secret/i);
    expect(prisma.servingConfirmRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, callerUserId: true, resultServingIds: true },
      }),
    );
  });
});
