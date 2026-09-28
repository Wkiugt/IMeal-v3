import { describe, expect, it, vi } from 'vitest';
import { AllowlistController } from './allowlist.controller.js';

const prisma = {
  otpAllowlist: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return prisma;
    }
  },
}));

describe('AllowlistController validation', () => {
  it.each([
    ['blank email', { email: '   ' }],
    ['invalid email', { email: 'not-an-email' }],
  ])('rejects %s at the admin boundary', async (_label, override) => {
    const controller = new AllowlistController(prisma as never);

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
});
