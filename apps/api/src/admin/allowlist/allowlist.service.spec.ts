import { describe, expect, it, vi } from 'vitest';
import { AllowlistService } from './allowlist.service.js';

const input = {
  emails: ['  Alice@Example.test ', 'alice@example.test', 'NEW@example.test'],
  state: 'ACTIVE' as const,
  effectiveFrom: '2026-10-01T00:00:00.000Z',
  effectiveTo: null,
  reason: 'migration',
};

function createPrisma() {
  const tx = {
    user: { findMany: vi.fn() },
    otpAllowlist: { findMany: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
}

describe('AllowlistService bulk upsert', () => {
  it('rejects an invalid row before opening a transaction', async () => {
    const { prisma } = createPrisma();
    const service = new AllowlistService(prisma as never);

    await expect(
      service.bulkUpsert(
        { ...input, emails: ['valid@example.test', 'not-an-email'] },
        'admin-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('normalizes and deduplicates rows, links users, and returns aggregate outcomes', async () => {
    const { prisma, tx } = createPrisma();
    tx.user.findMany.mockResolvedValue([
      { id: 'user-alice', email: 'alice@example.test' },
      { id: 'user-new', email: 'new@example.test' },
    ]);
    tx.otpAllowlist.findMany.mockResolvedValue([
      {
        id: 'allow-alice',
        normalizedEmail: 'alice@example.test',
        userId: null,
      },
    ]);
    tx.otpAllowlist.upsert
      .mockResolvedValueOnce({ id: 'allow-alice' })
      .mockResolvedValueOnce({ id: 'allow-new' });

    const service = new AllowlistService(prisma as never);
    const result = await service.bulkUpsert(input, 'admin-1');

    expect(result).toEqual({
      acceptedCount: 2,
      createdCount: 1,
      updatedCount: 1,
      linkedCount: 2,
      unlinkedCount: 0,
      duplicateCount: 1,
      items: [
        {
          normalizedEmail: 'alice@example.test',
          outcome: 'UPDATED',
          userLink: 'LINKED',
        },
        {
          normalizedEmail: 'new@example.test',
          outcome: 'CREATED',
          userLink: 'LINKED',
        },
      ],
    });
    expect(tx.otpAllowlist.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          normalizedEmail_purpose: {
            normalizedEmail: 'alice@example.test',
            purpose: 'SESSION_LOGIN',
          },
        },
        update: expect.objectContaining({ userId: 'user-alice' }),
      }),
    );
    expect(tx.otpAllowlist.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          normalizedEmail: 'new@example.test',
          userId: 'user-new',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'ALLOWLIST_BULK_UPSERTED',
        details: JSON.stringify({
          acceptedCount: 2,
          createdCount: 1,
          updatedCount: 1,
          linkedCount: 2,
          unlinkedCount: 0,
          duplicateCount: 1,
        }),
      },
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      'alice@example.test',
    );
  });

  it('preserves an existing user link and marks unmatched new rows unlinked', async () => {
    const { prisma, tx } = createPrisma();
    tx.user.findMany.mockResolvedValue([]);
    tx.otpAllowlist.findMany.mockResolvedValue([
      {
        id: 'allow-existing',
        normalizedEmail: 'existing@example.test',
        userId: 'already-linked',
      },
    ]);
    tx.otpAllowlist.upsert.mockResolvedValue({ id: 'allow-existing' });

    const service = new AllowlistService(prisma as never);
    const result = await service.bulkUpsert(
      { ...input, emails: ['existing@example.test', 'unlinked@example.test'] },
      'admin-1',
    );

    expect(result).toMatchObject({
      linkedCount: 1,
      unlinkedCount: 1,
      createdCount: 1,
      updatedCount: 1,
    });
    expect(result.items).toEqual([
      {
        normalizedEmail: 'existing@example.test',
        outcome: 'UPDATED',
        userLink: 'LINKED',
      },
      {
        normalizedEmail: 'unlinked@example.test',
        outcome: 'CREATED',
        userLink: 'UNLINKED',
      },
    ]);
    expect(tx.otpAllowlist.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: expect.objectContaining({ userId: 'already-linked' }),
      }),
    );
  });

  it('matches canonical user emails and leaves canonical collisions unlinked', async () => {
    const { prisma, tx } = createPrisma();
    tx.user.findMany.mockResolvedValue([
      { id: 'user-canonical', email: '  Employee@EXAMPLE.test ' },
      { id: 'user-collision', email: 'employee@example.test' },
      { id: 'user-other', email: 'Ｎｅｗ@example.test' },
    ]);
    tx.otpAllowlist.findMany.mockResolvedValue([]);
    tx.otpAllowlist.upsert.mockResolvedValue({ id: 'allow-1' });

    const service = new AllowlistService(prisma as never);
    const result = await service.bulkUpsert(
      { ...input, emails: ['employee@example.test', 'new@example.test'] },
      'admin-1',
    );

    expect(result.items).toEqual([
      {
        normalizedEmail: 'employee@example.test',
        outcome: 'CREATED',
        userLink: 'UNLINKED',
      },
      {
        normalizedEmail: 'new@example.test',
        outcome: 'CREATED',
        userLink: 'LINKED',
      },
    ]);
    expect(tx.otpAllowlist.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          normalizedEmail: 'employee@example.test',
          userId: null,
        }),
      }),
    );
    expect(tx.otpAllowlist.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          normalizedEmail: 'new@example.test',
          userId: 'user-other',
        }),
      }),
    );
  });
});
