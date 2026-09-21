import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoShowWorkerService } from './no-show-worker.service.js';

const mockTx = {
  registration: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  penalty: {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'penalty-1' }),
  },
  notification: {
    upsert: vi.fn().mockResolvedValue({
      id: 'notification-1',
      userId: 'user-1',
    }),
  },
  outboxEvent: {
    upsert: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
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
  $transaction: vi.fn(async (cb) => {
    return cb(mockTx);
  }),
};

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
  };
});

describe('NoShowWorkerService', () => {
  let service: NoShowWorkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NoShowWorkerService],
    }).compile();

    service = module.get<NoShowWorkerService>(NoShowWorkerService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Time constraints and options', () => {
    it('should throw BadRequestException if targetDate is today and VN time < 13:45 without force', async () => {
      // 06:44:00 UTC = 13:44:00 VN time
      const currentTime = new Date('2026-09-03T06:44:00.000Z');

      await expect(
        service.processNoShows('2026-09-03', { currentTime }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.registration.findMany).not.toHaveBeenCalled();
    });

    it('should proceed if targetDate is today and VN time < 13:45 when force is true', async () => {
      const currentTime = new Date('2026-09-03T06:44:00.000Z');
      mockPrisma.registration.findMany.mockResolvedValueOnce([]);
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
        force: true,
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.registration.findMany).toHaveBeenCalled();
    });

    it('should proceed if targetDate is today and VN time >= 13:45 without force', async () => {
      // 06:45:00 UTC = 13:45:00 VN time
      const currentTime = new Date('2026-09-03T06:45:00.000Z');
      mockPrisma.registration.findMany.mockResolvedValueOnce([]);
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows('2026-09-03', {
        currentTime,
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.registration.findMany).toHaveBeenCalledWith({
        where: {
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
          mealServing: null,
        },
      });
    });

    it('should proceed for a past date without force', async () => {
      // Current VN time is morning of 2026-09-03, but targetDate is yesterday 2026-09-02
      const currentTime = new Date('2026-09-03T03:00:00.000Z');
      mockPrisma.registration.findMany.mockResolvedValueOnce([]);
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows('2026-09-02', {
        currentTime,
      });

      expect(result.success).toBe(true);
      expect(result.dateStr).toBe('2026-09-02');
    });

    it('should throw BadRequestException for future meal date without force', async () => {
      const currentTime = new Date('2026-09-03T07:00:00.000Z'); // 14:00 VN time

      await expect(
        service.processNoShows('2026-09-04', { currentTime }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if targetDateStr has invalid format', async () => {
      await expect(
        service.processNoShows('invalid-date-format'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processNoShows execution & idempotency', () => {
    const targetDateStr = '2026-09-03';
    const currentTime = new Date('2026-09-03T07:00:00.000Z'); // 14:00 VN time

    it('should process candidates: update registration, create penalty, create notification, audit log, and job run', async () => {
      const candidates = [
        {
          id: 'reg-1',
          userId: 'user-1',
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
        {
          id: 'reg-2',
          userId: 'user-2',
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      ];

      mockPrisma.registration.findMany.mockResolvedValueOnce(candidates);

      // Re-verification in tx
      mockTx.registration.findUnique
        .mockResolvedValueOnce({
          id: 'reg-1',
          status: 'ACTIVE',
          mealServing: null,
        })
        .mockResolvedValueOnce({
          id: 'reg-2',
          status: 'ACTIVE',
          mealServing: null,
        });

      // No existing penalties
      mockTx.penalty.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      // No existing job run
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows(targetDateStr, {
        currentTime,
      });

      expect(result.success).toBe(true);
      expect(result.processedCount).toBe(2);
      expect(result.candidateCount).toBe(2);

      // Verify registration status updated to NO_SHOW
      expect(mockTx.registration.update).toHaveBeenCalledTimes(2);
      expect(mockTx.registration.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { status: 'NO_SHOW' },
      });
      expect(mockTx.registration.update).toHaveBeenCalledWith({
        where: { id: 'reg-2' },
        data: { status: 'NO_SHOW' },
      });

      // Verify Penalty: 50,000 VND and reason format
      expect(mockTx.penalty.create).toHaveBeenCalledTimes(2);
      expect(mockTx.penalty.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          userId: 'user-1',
          amount: 50000,
          reason: 'NO_SHOW_PENALTY_2026-09-03_reg-1',
        },
      });
      expect(mockTx.penalty.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          userId: 'user-2',
          amount: 50000,
          reason: 'NO_SHOW_PENALTY_2026-09-03_reg-2',
        },
      });

      // Verify structured Notification and delivery outbox
      expect(mockTx.notification.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { dedupeKey: 'no-show-penalty:user-1:reg-1' },
          update: {},
          create: expect.objectContaining({
            id: expect.any(String),
            userId: 'user-1',
            kind: 'NO_SHOW_PENALTY_CREATED',
            payload: {
              penaltyId: 'penalty-1',
              registrationId: 'reg-1',
              mealDate: '2026-09-03',
              amount: 50000,
            },
            titleVi: 'Phạt không nhận suất',
            bodyVi: 'Bạn bị phạt 50.000đ do không nhận suất ngày 3/9/2026.',
            titleEn: 'No-show penalty',
            bodyEn:
              'A VND 50,000 penalty was added because your meal for 9/3/2026 was not collected.',
            dedupeKey: 'no-show-penalty:user-1:reg-1',
          }),
        }),
      );
      expect(mockTx.notification.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { dedupeKey: 'no-show-penalty:user-2:reg-2' },
          create: expect.objectContaining({
            id: expect.any(String),
            userId: 'user-2',
            payload: expect.objectContaining({
              registrationId: 'reg-2',
            }),
          }),
        }),
      );
      expect(mockTx.outboxEvent.upsert).toHaveBeenCalledTimes(2);

      // Verify AuditLog
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          action: 'NO_SHOW_PROCESSED',
          userId: 'user-1',
          details: JSON.stringify({
            registrationId: 'reg-1',
            mealDate: '2026-09-03',
            amount: 50000,
          }),
        },
      });

      // Verify JobRun created
      expect(mockTx.jobRun.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          jobName: 'no_show_worker_2026-09-03',
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      });
    });

    it('should be idempotent: skip penalty creation if penalty already exists', async () => {
      const candidates = [
        {
          id: 'reg-1',
          userId: 'user-1',
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      ];

      mockPrisma.registration.findMany.mockResolvedValueOnce(candidates);
      mockTx.registration.findUnique.mockResolvedValueOnce({
        id: 'reg-1',
        status: 'ACTIVE',
        mealServing: null,
      });

      // Existing penalty already found!
      mockTx.penalty.findFirst.mockResolvedValueOnce({
        id: 'pen-1',
        userId: 'user-1',
        amount: 50000,
        reason: 'NO_SHOW_PENALTY_2026-09-03_reg-1',
      });

      // Existing job run already found!
      mockTx.jobRun.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        jobName: 'no_show_worker_2026-09-03',
        status: 'COMPLETED',
      });

      const result = await service.processNoShows(targetDateStr, {
        currentTime,
      });

      expect(result.processedCount).toBe(1);
      expect(mockTx.penalty.create).not.toHaveBeenCalled();
      expect(mockTx.jobRun.create).not.toHaveBeenCalled();
      expect(mockTx.jobRun.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      });
    });

    it('should skip registration if re-verification shows it is no longer ACTIVE or already served', async () => {
      const candidates = [
        {
          id: 'reg-1',
          userId: 'user-1',
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
        {
          id: 'reg-2',
          userId: 'user-2',
          mealDate: new Date('2026-09-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      ];

      mockPrisma.registration.findMany.mockResolvedValueOnce(candidates);

      // reg-1 was cancelled concurrently
      mockTx.registration.findUnique.mockResolvedValueOnce({
        id: 'reg-1',
        status: 'CANCELLED',
        mealServing: null,
      });
      // reg-2 was served concurrently
      mockTx.registration.findUnique.mockResolvedValueOnce({
        id: 'reg-2',
        status: 'ACTIVE',
        mealServing: { id: 'serving-1' },
      });

      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows(targetDateStr, {
        currentTime,
      });

      expect(result.processedCount).toBe(0);
      expect(mockTx.notification.upsert).not.toHaveBeenCalled();
      expect(mockTx.penalty.create).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
      expect(mockTx.jobRun.create).toHaveBeenCalled();
    });

    it('should complete job run when candidate list is empty', async () => {
      mockPrisma.registration.findMany.mockResolvedValueOnce([]);
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      const result = await service.processNoShows(targetDateStr, {
        currentTime,
      });

      expect(result.processedCount).toBe(0);
      expect(mockTx.jobRun.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          jobName: 'no_show_worker_2026-09-03',
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      });
    });
  });

  describe('handleNoShowCron', () => {
    it('should call processNoShows on cron invocation', async () => {
      const spy = vi.spyOn(service, 'processNoShows').mockResolvedValueOnce({
        success: true,
        dateStr: '2026-09-03',
        processedCount: 0,
        candidateCount: 0,
      });

      await service.handleNoShowCron();

      expect(spy).toHaveBeenCalled();
    });

    it('should rethrow errors from handleNoShowCron', async () => {
      vi.spyOn(service, 'processNoShows').mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(service.handleNoShowCron()).rejects.toThrow(
        'Database error',
      );
    });
  });
});
