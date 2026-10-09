import { describe, expect, it, vi } from 'vitest';
import { AllowlistController } from './allowlist.controller.js';

const prisma = {
  otpAllowlist: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};

describe('AllowlistController validation', () => {
  it.each([
    ['blank email', { email: '   ' }],
    ['invalid email', { email: 'not-an-email' }],
  ])('rejects %s at the admin boundary', async (_label, override) => {
    const controller = new AllowlistController(
      prisma as never,
      { bulkUpsert: vi.fn() } as never,
    );

    await expect(
      controller.create(
        {
          ...({
            email: 'employee@example.test',
            ...(override as Record<string, unknown>),
          } as Record<string, unknown>),
          state: 'ACTIVE',
          effectiveFrom: '2026-09-24T00:00:00.000Z',
        },
        { id: 'admin-1' } as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('delegates bulk requests to the injected service with the exact body and actor id', async () => {
    const body = {
      emails: [' Employee@Example.test '],
      state: 'ACTIVE',
      effectiveFrom: '2026-10-01T00:00:00.000Z',
      effectiveTo: null,
      reason: 'migration',
    };
    const response = {
      acceptedCount: 1,
      createdCount: 1,
      updatedCount: 0,
      linkedCount: 1,
      unlinkedCount: 0,
      duplicateCount: 0,
      items: [
        {
          normalizedEmail: 'employee@example.test',
          outcome: 'CREATED',
          userLink: 'LINKED',
        },
      ],
    };
    const allowlistService = {
      bulkUpsert: vi.fn().mockResolvedValue(response),
    };
    const controller = new AllowlistController(
      prisma as never,
      allowlistService as never,
    );

    await expect(
      controller.bulk(body, { id: 'admin-1' } as never),
    ).resolves.toEqual(response);
    expect(allowlistService.bulkUpsert).toHaveBeenCalledOnce();
    expect(allowlistService.bulkUpsert).toHaveBeenCalledWith(body, 'admin-1');
  });
});
