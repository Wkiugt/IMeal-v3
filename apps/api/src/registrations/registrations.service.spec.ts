import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v1 } from '@imeal/contracts';
import { RegistrationsService } from './registrations.service.js';

const txMock = {
  registration: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  outboxEvent: { create: vi.fn() },
};

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
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(txMock),
    );
    txMock.registration.update.mockResolvedValue({});
    txMock.registration.create.mockResolvedValue({});
    txMock.outboxEvent.create.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects registration at the exact previous-day cutoff', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-05',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-05',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('publishes seven authoritative days with lunar choices and UTC dates', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.registration.findMany.mockResolvedValue([
      {
        id: 'registration-1',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ]);
    const service = new RegistrationsService();

    const response = await service.getWeekData('user-1', '2026-09-21');

    expect(v1.WeekRegistrationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(response).toMatchObject({
      menu: null,
      registrations: [
        {
          id: 'registration-1',
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'VEGETARIAN',
        },
      ],
      registrationWindow: {
        serverNow: '2026-09-04T07:00:00.000Z',
        cutoffAt: '2026-09-20T07:00:00.000Z',
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });
    expect(response.registrationWindow.days).toHaveLength(7);
    expect(response.registrationWindow.days[0]).toMatchObject({
      mealDate: '2026-09-21',
      cutoffAt: '2026-09-20T07:00:00.000Z',
      editable: true,
      lunarDate: { day: 11, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR'],
    });
    expect(response.registrationWindow.days[4]).toMatchObject({
      mealDate: '2026-09-25',
      lunarDate: { day: 15, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR', 'VEGETARIAN'],
    });
    expect(response.registrationWindow.days[5].availableMealChoices).toEqual([
      'REGULAR',
    ]);
    expect(
      response.registrationWindow.days.every((day) =>
        day.cutoffAt.endsWith('.000Z'),
      ),
    ).toBe(true);
    expect(response.registrations[0].mealDate).not.toBeInstanceOf(Date);
  });

  it('serializes menu dates before strict week response parsing', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: new Date('2026-09-21T00:00:00.000Z'),
          isHoliday: false,
          isEnabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });
    const service = new RegistrationsService();

    const response = await service.getWeekData('user-1', '2026-09-21');

    expect(response.menu).toEqual({
      id: 'week-1',
      startDate: '2026-09-21',
      endDate: '2026-09-27',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: '2026-09-21',
          isHoliday: false,
          isEnabled: true,
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('returns a typed bad request for a valid date outside lunar support', async () => {
    const service = new RegistrationsService();

    await expect(service.getWeekData('user-1', '2200-01-01')).rejects.toMatchObject(
      {
        status: 400,
        response: {
          code: 'INVALID_MEAL_DATE',
        },
      },
    );
    expect(prismaMock.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('returns ordered partial results and rejects vegetarian meals on ordinary days', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    const service = new RegistrationsService();

    const response = await service.batchRegister('user-1', [
      {
        mealDate: '2026-09-24',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
      {
        mealDate: '2026-09-25',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ]);

    expect(response).toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'MEAL_CHOICE_UNAVAILABLE',
        reason: 'Meal choice is unavailable for this date',
      },
      { date: '2026-09-25', success: true },
    ]);
    expect(txMock.registration.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
        version: 1,
      },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('creates a regular registration with version one', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        version: 1,
      },
    });
  });

  it('does not write when an active registration keeps the same choice', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
    expect(txMock.registration.create).not.toHaveBeenCalled();
  });

  it('updates an active registration choice and increments its version', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'VEGETARIAN',
      delegations: [],
    });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-25', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: { status: 'ACTIVE', mealChoice: 'REGULAR', version: { increment: 1 } },
    });
  });

  it('reactivates a cancelled registration with the requested choice', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'VEGETARIAN',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-25', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: {
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
        version: { increment: 1 },
      },
    });
  });

  it('cancels active registrations and emits delegation cascade outbox events', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      delegations: [{ id: 'delegation-1' }],
    });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        aggregateType: 'REGISTRATION',
        aggregateId: 'registration-1',
        eventType: 'REGISTRATION_CANCELLED',
        payload: JSON.stringify({ registrationId: 'registration-1' }),
      },
    });
  });

  it('makes cancellation of missing or already cancelled registrations idempotent', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'registration-1',
        status: 'CANCELLED',
        mealChoice: 'REGULAR',
        delegations: [],
      });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
        { mealDate: '2026-09-25', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([
      { date: '2026-09-24', success: true },
      { date: '2026-09-25', success: true },
    ]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
  });

  it.each(['SERVED', 'NO_SHOW'])(
    'does not mutate a finalized %s registration before cutoff',
    async (status) => {
      vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
      txMock.registration.findUnique.mockResolvedValue({
        id: 'registration-1',
        status,
        mealChoice: 'REGULAR',
        delegations: [],
      });
      const service = new RegistrationsService();

      await expect(
        service.batchRegister('user-1', [
          {
            mealDate: '2026-09-24',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ]),
      ).resolves.toEqual([
        {
          date: '2026-09-24',
          success: false,
          code: 'REGISTRATION_FINALIZED',
          reason: 'Registration is finalized',
        },
      ]);
      expect(txMock.registration.update).not.toHaveBeenCalled();
    },
  );

  it('gives cutoff precedence over finalized status and no-op state', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'SERVED',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-05',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-05',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns INVALID_MEAL_DATE for an unsupported batch date', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2200-01-01',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2200-01-01',
        success: false,
        code: 'INVALID_MEAL_DATE',
        reason: expect.stringContaining('between 1200 and 2199'),
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns REGISTRATION_FAILED when an item transaction fails', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockRejectedValue(new Error('database down'));
    const service = new RegistrationsService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'database down',
      },
    ]);
  });

  it('uses a BadRequestException for malformed week starts', async () => {
    const service = new RegistrationsService();

    await expect(service.getWeekData('user-1', 'not-a-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
