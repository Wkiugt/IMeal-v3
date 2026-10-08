import { describe, expect, it, vi } from 'vitest';
import { AdminAuditService } from './admin-audit.service.js';

function prisma() {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe('AdminAuditService', () => {
  it('redacts OTP, tokens, GPS, and raw QR before returning persisted rows', async () => {
    const client = prisma();
    client.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        userId: 'admin-1',
        action: 'OTP_REQUEST_ACCEPTED',
        targetUserId: 'user-1',
        result: 'ACCEPTED',
        resourceType: null,
        createdAt: new Date('2026-10-06T00:00:00.000Z'),
        details: JSON.stringify({
          result: 'ACCEPTED',
          requestId: 'request-1',
          otp: '123456',
          sessionToken: 'raw-session',
          latitude: 10.1,
          qrPayload: 'raw-qr',
          subjectHash: 'abc',
        }),
      },
    ]);
    client.auditLog.count.mockResolvedValue(1);
    const service = new AdminAuditService(client as never);

    const page = await service.list({ page: 1, limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      result: 'ACCEPTED',
      redacted: true,
    });
    expect(JSON.stringify(page)).not.toMatch(/123456|raw-session|raw-qr|10\.1|subjectHash/i);
    expect(page.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
    });
  });

  it('filters target and result on indexed columns with a strict details fallback', async () => {
    const client = prisma();
    const service = new AdminAuditService(client as never);

    await service.list({
      page: 2,
      limit: 10,
      action: 'USER_DISABLED',
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      result: 'DISABLED',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-06T00:00:00.000Z',
    });

    expect(client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: {
          AND: expect.arrayContaining([
            { action: 'USER_DISABLED' },
            { userId: 'admin-1' },
            {
              OR: [
                { targetUserId: 'user-1' },
                {
                  AND: [
                    { targetUserId: null },
                    { details: { contains: '"targetUserId":"user-1"' } },
                  ],
                },
              ],
            },
            {
              OR: [
                { result: 'DISABLED' },
                {
                  AND: [
                    { result: null },
                    { details: { contains: '"result":"DISABLED"' } },
                  ],
                },
              ],
            },
          ]),
        },
      }),
    );
  });
});
