import { Test, TestingModule } from '@nestjs/testing';
import { CutoffWorkerService } from './cutoff-worker.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTx = {
  jobRun: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

const mockPrisma = {
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

describe('CutoffWorkerService', () => {
  let service: CutoffWorkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CutoffWorkerService],
    }).compile();

    service = module.get<CutoffWorkerService>(CutoffWorkerService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleCutoffLock', () => {
    it('should skip if job already ran', async () => {
      mockTx.jobRun.findFirst.mockResolvedValueOnce({ id: 'job1' });

      await service.handleCutoffLock();

      expect(mockTx.jobRun.findFirst).toHaveBeenCalled();
      expect(mockTx.jobRun.create).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });

    it('should lock day and record job if not already ran', async () => {
      mockTx.jobRun.findFirst.mockResolvedValueOnce(null);

      await service.handleCutoffLock();

      expect(mockTx.jobRun.create).toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'cutoff_lock' }),
        }),
      );
    });
  });
});
