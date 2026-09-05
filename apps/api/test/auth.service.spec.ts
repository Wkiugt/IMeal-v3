import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/auth/auth.service.js';
import type { Mock } from 'vitest';
type MockFunction = Mock;

interface AuthPrismaMock {
  $transaction: MockFunction;
  $queryRaw: MockFunction;
  user: {
    findUnique: MockFunction;
    upsert: MockFunction;
  };
  role: {
    upsert: MockFunction;
  };
  userRole: {
    upsert: MockFunction;
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: AuthPrismaMock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ is_active: true }]),
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'entra-id-123',
            email: 'test@entra.com',
            name: 'Test Entra',
            userRoles: [
              {
                role: {
                  name: 'staff',
                  rolePermissions: [],
                },
              },
            ],
            userPermissions: [],
          }),
        upsert: vi.fn().mockResolvedValue({
          id: 'entra-id-123',
          email: 'test@entra.com',
          name: 'Test Entra',
        }),
      },
      role: {
        upsert: vi.fn().mockResolvedValue({ id: 'staff-role', name: 'staff' }),
      },
      userRole: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: AuthPrismaMock) => unknown) => callback(prisma),
    );
    Reflect.set(service, 'prisma', prisma);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('provisions a new identity with staff only', async () => {
    const principal = await service.provisionUser({
      userId: 'entra-id-123',
      email: 'TEST@entra.com',
      name: 'Test Entra',
      tenantId: 'tenant-id',
    });

    expect(principal.roles).toEqual(['staff']);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'entra-id-123' },
        create: {
          id: 'entra-id-123',
          email: 'test@entra.com',
          name: 'Test Entra',
        },
      }),
    );
    expect(prisma.role.upsert).toHaveBeenCalledWith({
      where: { name: 'staff' },
      update: {},
      create: { name: 'staff' },
    });
    expect(prisma.userRole.upsert).toHaveBeenCalledWith({
      where: {
        userId_roleId: {
          userId: 'entra-id-123',
          roleId: 'staff-role',
        },
      },
      update: {},
      create: {
        userId: 'entra-id-123',
        roleId: 'staff-role',
      },
    });
  });
});
