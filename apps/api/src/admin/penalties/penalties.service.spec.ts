import { Test, TestingModule } from '@nestjs/testing';
import { PenaltiesService } from './penalties.service.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = {
  penalty: {
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (cb) => {
    return cb(mockTx);
  }),
};

const mockTx = {
  penalty: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
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

describe('PenaltiesService', () => {
  let service: PenaltiesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PenaltiesService],
    }).compile();

    service = module.get<PenaltiesService>(PenaltiesService);
  });

  describe('getPenalties', () => {
    it('should return paginated penalties list with metrics', async () => {
      const mockItems = [
        {
          id: 'pen-1',
          userId: 'user-1',
          amount: 50000,
          reason: 'NO_SHOW_PENALTY_2026-09-01',
          status: 'PENDING',
          paidAt: null,
          waivedAt: null,
          waiveReason: null,
          waivedByUserId: null,
          createdAt: new Date('2026-09-01T12:00:00.000Z'),
          updatedAt: new Date('2026-09-01T12:00:00.000Z'),
          user: {
            id: 'user-1',
            name: 'Minh Anh',
            email: 'minh.anh@example.com',
          },
        },
      ];

      mockPrisma.penalty.findMany.mockResolvedValue(mockItems);
      mockPrisma.penalty.count.mockResolvedValue(1);
      mockPrisma.penalty.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: 50000 },
          _count: { _all: 1 },
        }) // PENDING
        .mockResolvedValueOnce({
          _sum: { amount: 30000 },
          _count: { _all: 1 },
        }) // PAID
        .mockResolvedValueOnce({
          _sum: { amount: 20000 },
          _count: { _all: 1 },
        }) // WAIVED
        .mockResolvedValueOnce({
          _sum: { amount: 100000 },
          _count: { _all: 3 },
        }); // TOTAL

      const result = await service.getPenalties({
        status: 'PENDING',
        page: 1,
        limit: 20,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].userName).toBe('Minh Anh');
      expect(result.items[0].status).toBe('PENDING');
      expect(result.metrics.totalInvoiced).toBe(100000);
      expect(result.metrics.outstandingAmount).toBe(50000);
      expect(result.metrics.pendingCount).toBe(1);
      expect(result.metrics.paidCount).toBe(1);
      expect(result.metrics.waivedCount).toBe(1);
    });

    it('should handle search and date range filters', async () => {
      mockPrisma.penalty.findMany.mockResolvedValue([]);
      mockPrisma.penalty.count.mockResolvedValue(0);
      mockPrisma.penalty.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
        _count: { _all: 0 },
      });

      const result = await service.getPenalties({
        search: 'Minh',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
      });

      expect(result.items).toEqual([]);
      expect(mockPrisma.penalty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  describe('markAsPaid', () => {
    it('should successfully mark a PENDING penalty as PAID and create audit log', async () => {
      const mockPenalty = {
        id: 'pen-1',
        userId: 'user-1',
        amount: 50000,
        status: 'PENDING',
        reason: 'NO_SHOW_PENALTY',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        updatedAt: new Date('2026-09-01T10:00:00.000Z'),
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        waivedByUserId: null,
        user: { id: 'user-1', name: 'Minh Anh', email: 'minh@example.com' },
      };

      const mockUpdated = {
        ...mockPenalty,
        status: 'PAID',
        paidAt: new Date('2026-09-03T10:00:00.000Z'),
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
      };

      mockTx.penalty.findUnique.mockResolvedValue(mockPenalty);
      mockTx.penalty.update.mockResolvedValue(mockUpdated);
      mockTx.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.markAsPaid('pen-1', 'admin-user-1');

      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBeDefined();
      expect(mockTx.penalty.update).toHaveBeenCalledWith({
        where: { id: 'pen-1' },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'PENALTY_PAID',
          userId: 'admin-user-1',
        }),
      });
    });

    it('should throw NotFoundException if penalty not found', async () => {
      mockTx.penalty.findUnique.mockResolvedValue(null);

      await expect(service.markAsPaid('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if penalty is already PAID', async () => {
      mockTx.penalty.findUnique.mockResolvedValue({
        id: 'pen-1',
        status: 'PAID',
      });

      await expect(service.markAsPaid('pen-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if penalty is already WAIVED', async () => {
      mockTx.penalty.findUnique.mockResolvedValue({
        id: 'pen-1',
        status: 'WAIVED',
      });

      await expect(service.markAsPaid('pen-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('waivePenalty', () => {
    it('should throw BadRequestException if reason is less than 5 characters', async () => {
      await expect(service.waivePenalty('pen-1', 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if reason is empty', async () => {
      await expect(service.waivePenalty('pen-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should successfully waive a PENDING penalty and create audit log', async () => {
      const mockPenalty = {
        id: 'pen-1',
        userId: 'user-1',
        amount: 50000,
        status: 'PENDING',
        reason: 'NO_SHOW_PENALTY',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        updatedAt: new Date('2026-09-01T10:00:00.000Z'),
        paidAt: null,
        waivedAt: null,
        waiveReason: null,
        waivedByUserId: null,
        user: { id: 'user-1', name: 'Minh Anh', email: 'minh@example.com' },
      };

      const mockUpdated = {
        ...mockPenalty,
        status: 'WAIVED',
        waivedAt: new Date('2026-09-03T10:00:00.000Z'),
        waiveReason: 'Excused due to medical appointment',
        waivedByUserId: 'admin-1',
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
      };

      mockTx.penalty.findUnique.mockResolvedValue(mockPenalty);
      mockTx.penalty.update.mockResolvedValue(mockUpdated);
      mockTx.auditLog.create.mockResolvedValue({ id: 'audit-2' });

      const result = await service.waivePenalty(
        'pen-1',
        'Excused due to medical appointment',
        'admin-1',
      );

      expect(result.status).toBe('WAIVED');
      expect(result.waiveReason).toBe('Excused due to medical appointment');
      expect(result.waivedByUserId).toBe('admin-1');
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'PENALTY_WAIVED',
          userId: 'admin-1',
        }),
      });
    });

    it('should throw NotFoundException if penalty not found', async () => {
      mockTx.penalty.findUnique.mockResolvedValue(null);

      await expect(
        service.waivePenalty('not-found', 'Medical excuse provided'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if penalty is already WAIVED or PAID', async () => {
      mockTx.penalty.findUnique.mockResolvedValue({
        id: 'pen-1',
        status: 'PAID',
      });

      await expect(
        service.waivePenalty('pen-1', 'Medical excuse provided'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
