import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationsService } from './registrations.service.js';

const prismaMock = {
  appSetting: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return prismaMock;
    }
  },
}));

describe('RegistrationsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    prismaMock.appSetting.findUnique.mockResolvedValue({ value: '14:00' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects registration at the exact previous-day cutoff', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-05', status: 'ACTIVE' },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-05',
        success: false,
        reason: 'Cutoff time exceeded',
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
