import { Test, TestingModule } from '@nestjs/testing';
import { PickupWorkerService } from './pickup-worker.service.js';
import { vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  pickupSession: {
    deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
  },
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
  };
});

describe('PickupWorkerService', () => {
  let service: PickupWorkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PickupWorkerService],
    }).compile();

    service = module.get<PickupWorkerService>(PickupWorkerService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delete expired sessions', async () => {
    await service.cleanupExpiredSessions();
    expect(mockPrisma.pickupSession.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lt: expect.any(Date),
        },
      },
    });
  });
});
