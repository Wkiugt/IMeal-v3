import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma.service.js';
import { EmployeePenaltiesService } from './employee-penalties.service.js';

const prismaMock = {
  penalty: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
};

function createService(): EmployeePenaltiesService {
  return new EmployeePenaltiesService(prismaMock as unknown as PrismaService);
}

function makeRegistration(userId: string, status = 'ACTIVE') {
  return {
    userId,
    id: `${userId}-registration`,
    mealDate: new Date('2026-09-30T00:00:00.000Z'),
    status,
    mealChoice: 'REGULAR',
    menuRevisionId: 'revision-1',
    menuNameSnapshot: 'Lunch',
    menuDescriptionSnapshot: null,
    menuImageSnapshot: null,
    serviceLocationId: 'location-1',
    serviceLocationAssignmentId: 'assignment-1',
    serviceLocationCode: 'LOC-A',
    serviceLocationName: 'Main Hall',
    serviceLocationAddress: '1 Main Street',
    serviceLocationEffectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    serviceLocationSnapshotAt: new Date('2026-09-30T00:00:00.000Z'),
    registeredAt: new Date('2026-09-29T00:00:00.000Z'),
    cancelledAt: null,
    noShowAt: null,
    createdAt: new Date('2026-09-29T00:00:00.000Z'),
    updatedAt: new Date('2026-09-30T05:30:00.000Z'),
    mealServing: { servedAt: new Date('2026-09-30T05:30:00.000Z') },
  };
}

describe('EmployeePenaltiesService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns only the owner penalties in deterministic newest order and hides malformed context', async () => {
    const rows = [
      {
        id: 'penalty-new',
        userId: 'owner-1',
        amount: 50000,
        reason: 'NO_SHOW_NEW',
        status: 'PENDING',
        mealDate: new Date('2026-09-30T00:00:00.000Z'),
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        registration: makeRegistration('owner-1'),
      },
      {
        id: 'penalty-malformed',
        userId: 'owner-1',
        amount: 50000,
        reason: 'NO_SHOW_OLD',
        status: 'PAID',
        mealDate: new Date('2026-09-29T00:00:00.000Z'),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        paidAt: new Date('2026-10-03T00:00:00.000Z'),
        waivedAt: null,
        waiveReason: null,
        registration: makeRegistration('other-user'),
      },
      {
        id: 'penalty-foreign',
        userId: 'other-user',
        amount: 50000,
        reason: 'FOREIGN',
        status: 'PENDING',
        mealDate: new Date('2026-09-28T00:00:00.000Z'),
        createdAt: new Date('2026-10-04T00:00:00.000Z'),
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        registration: makeRegistration('other-user'),
      },
    ];
    prismaMock.penalty.findMany.mockImplementation(
      async ({ where, skip, take }) =>
        rows
          .filter(
            (row) =>
              row.userId === where.userId &&
              (!where.status || row.status === where.status),
          )
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              right.id.localeCompare(left.id),
          )
          .slice(skip, skip + take),
    );
    prismaMock.penalty.count.mockImplementation(
      async ({ where }) =>
        rows.filter(
          (row) =>
            row.userId === where.userId &&
            (!where.status || row.status === where.status),
        ).length,
    );

    const result = await createService().getList('owner-1', {
      page: 1,
      limit: 20,
    });

    expect(result.data.map((item) => item.id)).toEqual([
      'penalty-new',
      'penalty-malformed',
    ]);
    expect(result.data[0]?.registration?.status).toBe('SERVED');
    expect(result.data[0]?.registration?.servedAt).toBe(
      '2026-09-30T05:30:00.000Z',
    );
    expect(result.data[1]?.registration).toBeNull();
    expect(result.meta.pagination.total).toBe(2);

    await expect(
      createService().getList('owner-1', {
        page: 1,
        limit: 20,
        status: 'PENDING',
      }),
    ).resolves.toMatchObject({
      data: [{ id: 'penalty-new' }],
      meta: { pagination: { total: 1 } },
    });
  });

  it('returns the same not found error for nonexistent and wrong-owner detail', async () => {
    prismaMock.penalty.findFirst.mockResolvedValue(null);
    const service = createService();

    const foreignError = await service
      .getDetail('owner-1', 'foreign-penalty')
      .catch((error: unknown) => error);
    const missingError = await service
      .getDetail('owner-1', 'missing-penalty')
      .catch((error: unknown) => error);

    expect(foreignError).toBeInstanceOf(NotFoundException);
    expect(missingError).toBeInstanceOf(NotFoundException);
    expect((foreignError as NotFoundException).getResponse()).toEqual(
      (missingError as NotFoundException).getResponse(),
    );
  });
});
