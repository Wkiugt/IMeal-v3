import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationsService } from './registrations.service.js';

const prismaMock = {
  appSetting: { findUnique: vi.fn() },
  weeklyMenu: { findFirst: vi.fn() },
  registration: { findMany: vi.fn() },
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
    prismaMock.weeklyMenu.findFirst.mockResolvedValue(null);
    prismaMock.registration.findMany.mockResolvedValue([]);
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

  it('returns server-authoritative editability for each day of the week', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const service = new RegistrationsService();

    const response = await service.getWeekData('user-1', '2026-09-05');

    expect(response.registrationWindow.timeZone).toBe('Asia/Ho_Chi_Minh');
    expect(response.registrationWindow.serverNow).toBe(
      '2026-09-04T07:00:00.000Z',
    );
    expect(response.registrationWindow.days).toHaveLength(7);
    expect(response.registrationWindow.days[0]).toMatchObject({
      mealDate: '2026-09-05',
      cutoffAt: '2026-09-04T07:00:00.000Z',
      editable: false,
    });
    expect(response.registrationWindow.days[1]).toMatchObject({
      mealDate: '2026-09-06',
      editable: true,
    });
    expect(
      response.registrationWindow.days.every(
        (day) => day.cutoffAt.endsWith('.000Z'),
      ),
    ).toBe(true);
  });
});
