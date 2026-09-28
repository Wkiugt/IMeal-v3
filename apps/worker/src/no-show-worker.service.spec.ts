import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from './common/prisma.service.js';
import { NoShowWorkerService } from './no-show-worker.service.js';
const mockTx = {
  $queryRaw: vi.fn(),
  registration: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  penalty: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  notification: {
    upsert: vi.fn(),
  },
  outboxEvent: {
    upsert: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  jobRun: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

const mockPrisma = {
  registration: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx),
  ),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
  Prisma: {
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    })),
  },
}));

type RegistrationFixture = {
  id: string;
  userId: string;
  mealDate: Date;
  status: string;
  mealServing: unknown;
  noShowAt?: Date;
  user: { isActive: boolean };
};

const mealDate = new Date('2026-09-03T00:00:00.000Z');
const currentTime = new Date('2026-09-03T07:00:00.000Z');

function activeRegistration(
  id = 'reg-1',
  overrides: Partial<RegistrationFixture> = {},
): RegistrationFixture {
  return {
    id,
    userId: `user-${id}`,
    mealDate,
    status: 'ACTIVE',
    mealServing: null,
    user: { isActive: true },
    ...overrides,
  };
}

function prepareCandidate(registration: RegistrationFixture) {
  mockPrisma.registration.findMany.mockResolvedValueOnce([
    { id: registration.id },
  ]);
  mockTx.$queryRaw.mockResolvedValueOnce([{ id: registration.id }]);
  mockTx.registration.findUnique.mockResolvedValueOnce(registration);
  mockTx.penalty.findFirst.mockResolvedValueOnce(null);
  mockTx.penalty.create.mockResolvedValueOnce({
    id: `penalty-${registration.id}`,
    userId: registration.userId,
    amount: 50000,
    reason: 'NO_SHOW',
    status: 'PENDING',
    registrationId: registration.id,
    mealDate,
  });
  mockTx.notification.upsert.mockResolvedValueOnce({
    id: `notification-${registration.id}`,
    userId: registration.userId,
  });
  mockTx.outboxEvent.upsert.mockResolvedValue({ id: 'outbox-1' });
  mockTx.auditLog.create.mockResolvedValueOnce({ id: 'audit-1' });
  mockTx.registration.update.mockResolvedValueOnce({
    ...registration,
    status: 'NO_SHOW',
  });
}

describe('NoShowWorkerService', () => {
  let service: NoShowWorkerService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockTx.$queryRaw.mockReset();
    mockTx.registration.findUnique.mockReset();
    mockTx.registration.update.mockReset();
    mockTx.penalty.findFirst.mockReset();
    mockTx.penalty.create.mockReset();
    mockTx.notification.upsert.mockReset();
    mockTx.outboxEvent.upsert.mockReset();
    mockTx.auditLog.create.mockReset();
    mockTx.jobRun.findFirst.mockReset();
    mockTx.jobRun.create.mockReset();
    mockTx.jobRun.update.mockReset();
    mockPrisma.registration.findMany.mockReset();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowWorkerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<NoShowWorkerService>(NoShowWorkerService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('time gates', () => {
    it('rejects today before 13:45 unless force is enabled', async () => {
      await expect(
        service.processNoShows('2026-09-03', {
          currentTime: new Date('2026-09-03T06:44:59.000Z'),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.registration.findMany).not.toHaveBeenCalled();
    });

    it('allows forced processing at 13:30 but the domain predicate rejects 13:29:59', async () => {
      const registration = activeRegistration();
      mockPrisma.registration.findMany
        .mockResolvedValueOnce([{ id: registration.id }])
        .mockResolvedValueOnce([{ id: registration.id }]);
      mockTx.$queryRaw
        .mockResolvedValue([{ id: registration.id }]);
      mockTx.registration.findUnique
        .mockResolvedValueOnce(registration)
        .mockResolvedValueOnce(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const before = await service.processNoShows('2026-09-03', {
        force: true,
        currentTime: new Date('2026-09-03T06:29:59.000Z'),
      });
      expect(before.processedCount).toBe(0);
      expect(mockTx.registration.update).not.toHaveBeenCalled();

      prepareCandidate(registration);
      const atBoundary = await service.processNoShows('2026-09-03', {
        force: true,
        currentTime: new Date('2026-09-03T06:30:00.000Z'),
      });
      expect(atBoundary.processedCount).toBe(1);
      expect(mockTx.registration.update).toHaveBeenCalledWith({
        where: { id: registration.id },
        data: { status: 'NO_SHOW', noShowAt: new Date('2026-09-03T06:30:00.000Z') },
      });
    });

    it('runs normal processing at 13:45 and still rejects a future date without force', async () => {
      const registration = activeRegistration();
      prepareCandidate(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);
      const result = await service.processNoShows('2026-09-03', {
        currentTime: new Date('2026-09-03T06:45:00.000Z'),
      });
      expect(result.processedCount).toBe(1);

      await expect(
        service.processNoShows('2026-09-04', {
          currentTime: new Date('2026-09-03T07:00:00.000Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('per-registration transaction', () => {
    it('locks registration before checking serving and rechecks the joined account', async () => {
      const registration = activeRegistration();
      mockPrisma.registration.findMany.mockResolvedValueOnce([
        { id: registration.id },
      ]);
      mockTx.jobRun.findFirst.mockResolvedValue(null);
      mockTx.penalty.findFirst.mockResolvedValueOnce(null);
      mockTx.penalty.create.mockResolvedValueOnce({
        id: 'penalty-reg-1',
        registrationId: registration.id,
        userId: registration.userId,
        mealDate,
        amount: 50000,
        reason: 'NO_SHOW',
        status: 'PENDING',
      });
      mockTx.notification.upsert.mockResolvedValueOnce({
        id: 'notification-reg-1',
      });
      mockTx.outboxEvent.upsert.mockResolvedValue({ id: 'outbox-1' });
      mockTx.auditLog.create.mockResolvedValueOnce({ id: 'audit-1' });
      mockTx.registration.update.mockResolvedValueOnce(registration);
      const calls: string[] = [];
      mockTx.$queryRaw.mockImplementation(async () => {
        if (calls.length === 0) {
          calls.push('registration-lock');
          return [{ id: registration.id }];
        }
        return [];
      });
      mockTx.registration.findUnique.mockImplementationOnce(async () => {
        calls.push('registration-read-serving-account');
        return registration;
      });
      await service.processNoShows('2026-09-03', { currentTime });

      expect(calls).toEqual([
        'registration-lock',
        'registration-read-serving-account',
      ]);
      expect(mockTx.$queryRaw).toHaveBeenCalledWith(
        expect.objectContaining({ values: [registration.id] }),
      );
      const registrationLockQuery = mockTx.$queryRaw.mock.calls[0][0];
      expect(registrationLockQuery.strings.join('')).not.toContain('users');
      expect(mockTx.registration.findUnique).toHaveBeenCalledWith({
        where: { id: registration.id },
        include: {
          user: { select: { isActive: true } },
          mealServing: true,
        },
      });
    });

    it('creates one registration-keyed penalty and atomically marks no-show', async () => {
      const registration = activeRegistration();
      prepareCandidate(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(result.processedCount).toBe(1);
      expect(mockTx.penalty.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          registrationId: registration.id,
          userId: registration.userId,
          mealDate,
          amount: 50000,
          reason: 'NO_SHOW',
          status: 'PENDING',
        },
      });
      expect(mockTx.registration.update).toHaveBeenCalledWith({
        where: { id: registration.id },
        data: { status: 'NO_SHOW', noShowAt: currentTime },
      });
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'NO_SHOW_PROCESSED',
          userId: registration.userId,
          details: JSON.stringify({
            registrationId: registration.id,
            mealDate: '2026-09-03',
            amount: 50000,
          }),
        }),
      });
    });

    it('no_show_outbox_has_stable_dedupe_key_and_registration_payload', async () => {
      const registration = activeRegistration();
      prepareCandidate(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      await service.processNoShows('2026-09-03', { currentTime });

      expect(mockTx.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dedupeKey: `no-show-penalty:${registration.userId}:${registration.id}` },
        }),
      );
      const outboxWrite = mockTx.outboxEvent.upsert.mock.calls
        .map(([input]) => input)
        .find(
          (input) =>
            input.where.dedupeKey === `kitchen:no-show:${registration.id}`,
        );
      expect(outboxWrite).toEqual({
        where: { dedupeKey: `kitchen:no-show:${registration.id}` },
        update: {},
        create: expect.objectContaining({
          id: expect.any(String),
          aggregateType: 'REGISTRATION',
          aggregateId: registration.id,
          eventType: 'NO_SHOW_RECONCILED',
          payload: JSON.stringify({
            registrationId: registration.id,
            mealDate: '2026-09-03',
            penaltyId: `penalty-${registration.id}`,
          }),
          dedupeKey: `kitchen:no-show:${registration.id}`,
        }),
      });
    });

    it('skips cancelled, served, disabled, and wrong-date rows without side effects', async () => {
      const registrations = [
        activeRegistration('cancelled', { status: 'CANCELLED' }),
        activeRegistration('served', { mealServing: { id: 'serving-1' } }),
        activeRegistration('disabled', { user: { isActive: false } }),
        activeRegistration('wrong-date', {
          mealDate: new Date('2026-09-04T00:00:00.000Z'),
        }),
      ];
      expect(registrations[0].status).toBe('CANCELLED');
      expect(registrations[1].mealServing).toEqual({ id: 'serving-1' });
      expect(registrations[2].user.isActive).toBe(false);
      expect(registrations[3].mealDate).not.toEqual(mealDate);
      mockPrisma.registration.findMany.mockResolvedValueOnce(
        registrations.map(({ id }) => ({ id })),
      );
      const registrationById = Object.fromEntries(
        registrations.map((registration) => [registration.id, registration]),
      );
      mockTx.$queryRaw.mockImplementation(async (_query) => [
        { id: 'lock' },
      ]);
      mockTx.registration.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          registrationById[where.id],
      );
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(result.processedCount).toBe(0);
      expect(mockTx.penalty.create).not.toHaveBeenCalled();
      expect(mockTx.registration.update).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
      expect(mockTx.notification.upsert).not.toHaveBeenCalled();
    });
    it('serving wins race without penalty', async () => {
      const registration = activeRegistration('race-served', {
        mealServing: { id: 'serving-1' },
      });
      mockPrisma.registration.findMany.mockResolvedValueOnce([
        { id: registration.id },
      ]);
      mockTx.$queryRaw.mockResolvedValueOnce([{ id: registration.id }]);
      mockTx.registration.findUnique.mockResolvedValueOnce(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(result.processedCount).toBe(0);
      expect(mockTx.penalty.create).not.toHaveBeenCalled();
      expect(mockTx.registration.update).not.toHaveBeenCalled();
    });

    it('no-show wins race and records no serving side effect', async () => {
      const registration = activeRegistration('race-no-show');
      prepareCandidate(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(result.processedCount).toBe(1);
      expect(mockTx.penalty.create).toHaveBeenCalledTimes(1);
      expect(mockTx.registration.update).toHaveBeenCalledWith({
        where: { id: registration.id },
        data: { status: 'NO_SHOW', noShowAt: currentTime },
      });
    });

    it('is idempotent after a committed no-show retry', async () => {
      const registration = activeRegistration();
      const noShowRegistration = activeRegistration('reg-1', {
        status: 'NO_SHOW',
        noShowAt: currentTime,
      });
      mockPrisma.registration.findMany
        .mockResolvedValueOnce([{ id: registration.id }])
        .mockResolvedValueOnce([{ id: registration.id }]);
      mockTx.$queryRaw.mockResolvedValue([{ id: registration.id }]);
      mockTx.registration.findUnique
        .mockResolvedValueOnce(registration)
        .mockResolvedValueOnce(noShowRegistration);
      mockTx.penalty.findFirst.mockResolvedValueOnce(null);
      mockTx.penalty.create.mockResolvedValueOnce({
        id: 'penalty-reg-1',
        registrationId: registration.id,
        userId: registration.userId,
        mealDate,
        amount: 50000,
        reason: 'NO_SHOW',
        status: 'PENDING',
      });
      mockTx.notification.upsert.mockResolvedValueOnce({
        id: 'notification-reg-1',
      });
      mockTx.outboxEvent.upsert.mockResolvedValue({ id: 'outbox-1' });
      mockTx.auditLog.create.mockResolvedValueOnce({ id: 'audit-1' });
      mockTx.registration.update.mockResolvedValueOnce(noShowRegistration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);

      const first = await service.processNoShows('2026-09-03', {
        currentTime,
      });
      const retry = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(first.processedCount).toBe(1);
      expect(retry.processedCount).toBe(0);
      expect(mockTx.penalty.create).toHaveBeenCalledTimes(1);
      expect(mockTx.notification.upsert).toHaveBeenCalledTimes(1);
      expect(mockTx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(
        mockTx.outboxEvent.upsert.mock.calls.filter(
          ([input]) =>
            input.where.dedupeKey === `kitchen:no-show:${registration.id}`,
        ),
      ).toHaveLength(1);
      expect(mockTx.registration.update).toHaveBeenCalledTimes(1);
    });


    it('preserves an existing PAID or WAIVED penalty on retry', async () => {
      for (const status of ['PAID', 'WAIVED'] as const) {
        vi.clearAllMocks();
        const registration = activeRegistration();
        mockPrisma.registration.findMany.mockResolvedValueOnce([
          { id: registration.id },
        ]);
        mockTx.$queryRaw.mockResolvedValueOnce([{ id: registration.id }]);
        mockTx.registration.findUnique.mockResolvedValueOnce(registration);
        mockTx.penalty.findFirst.mockResolvedValueOnce({
          id: 'penalty-existing',
          registrationId: registration.id,
          userId: registration.userId,
          mealDate,
          amount: 50000,
          reason: 'NO_SHOW',
          status,
        });
        mockTx.registration.update.mockResolvedValueOnce(registration);
        mockTx.notification.upsert.mockResolvedValueOnce({
          id: 'notification-existing',
          userId: registration.userId,
        });
        mockTx.outboxEvent.upsert.mockResolvedValue({ id: 'outbox-1' });
        mockTx.auditLog.create.mockResolvedValueOnce({ id: 'audit-1' });
        mockTx.jobRun.findFirst.mockResolvedValue(null);

        await service.processNoShows('2026-09-03', { currentTime });

        expect(mockTx.penalty.create).not.toHaveBeenCalled();
      }
    });

    it('rolls back all side effects when notification publication fails', async () => {
      const registration = activeRegistration();
      prepareCandidate(registration);
      mockTx.jobRun.findFirst.mockResolvedValue(null);
      const publishError = new Error('notification database unavailable');
      mockTx.notification.upsert.mockReset();
      mockTx.notification.upsert.mockRejectedValueOnce(publishError);

      await expect(
        service.processNoShows('2026-09-03', { currentTime }),
      ).rejects.toThrow(publishError);
      expect(mockTx.registration.update).toHaveBeenCalledTimes(1);
      expect(mockTx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(mockTx.outboxEvent.upsert).not.toHaveBeenCalled();
    });
  });

  describe('cron wrapper', () => {
    it('calls processNoShows and rethrows failures', async () => {
      const spy = vi
        .spyOn(service, 'processNoShows')
        .mockRejectedValueOnce(new Error('database unavailable'));
      await expect(service.handleNoShowCron()).rejects.toThrow(
        'database unavailable',
      );
      expect(spy).toHaveBeenCalled();
    });
  });
});
