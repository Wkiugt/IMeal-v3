import { Test, TestingModule } from '@nestjs/testing';
import { DelegationsService } from './delegations.service.js';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('DelegationsService', () => {
  let service: DelegationsService;
  let prismaMock: any;
  let pushServiceMock: any;

  beforeEach(async () => {
    prismaMock = {
      $queryRaw: vi.fn(),
      $transaction: vi.fn().mockImplementation((cb) => cb(prismaMock)),
      registration: {
        findUnique: vi.fn(),
      },
      mealServing: {
        findUnique: vi.fn(),
      },
      pickupDelegation: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      notification: {
        create: vi.fn(),
      },
    };

    const notificationsServiceMock = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationsService,
        {
          provide: NotificationsService,
          useValue: notificationsServiceMock,
        },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<DelegationsService>(DelegationsService);
    // Replace the internal prisma client with our mock
    (service as any).prisma = prismaMock;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('lists only incoming delegations for the authenticated user', async () => {
    const createdAt = new Date('2026-09-04T03:00:00.000Z');
    prismaMock.pickupDelegation.findMany.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        registrationId: '22222222-2222-4222-8222-222222222222',
        delegateUserId: '33333333-3333-4333-8333-333333333333',
        status: 'PENDING',
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await service.getDelegations(
      '33333333-3333-4333-8333-333333333333',
      'incoming',
    );

    expect(prismaMock.pickupDelegation.findMany).toHaveBeenCalledWith({
      where: { delegateUserId: '33333333-3333-4333-8333-333333333333' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        registrationId: '22222222-2222-4222-8222-222222222222',
        delegateUserId: '33333333-3333-4333-8333-333333333333',
        status: 'PENDING',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      },
    ]);
  });

  describe('createDelegation', () => {
    it('should throw BadRequestException if delegating to self', async () => {
      await expect(
        service.createDelegation('userA', {
          registrationId: 'reg1',
          delegateUserId: 'userA',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create delegation if valid', async () => {
      prismaMock.registration.findUnique.mockResolvedValue({
        userId: 'owner1',
        id: 'reg1',
        status: 'ACTIVE',
        mealDate: new Date('2026-09-08T00:00:00.000Z'),
      });
      prismaMock.mealServing.findUnique.mockResolvedValue(null);
      prismaMock.pickupDelegation.findFirst.mockResolvedValue(null);
      prismaMock.pickupDelegation.create.mockResolvedValue({
        id: 'del1',
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.createDelegation('owner1', {
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
      });
      expect(res.id).toBe('del1');
      expect(prismaMock.pickupDelegation.create).toHaveBeenCalled();
    });

    it('should prevent multiple active delegations for same registration', async () => {
      prismaMock.registration.findUnique.mockResolvedValue({
        userId: 'owner1',
        id: 'reg1',
        status: 'ACTIVE',
      });
      prismaMock.mealServing.findUnique.mockResolvedValue(null);
      // Simulate existing active delegation
      prismaMock.pickupDelegation.findFirst.mockResolvedValue({
        id: 'delExisting',
      });

      await expect(
        service.createDelegation('owner1', {
          registrationId: 'reg1',
          delegateUserId: 'delegate1',
        }),
      ).rejects.toThrow(
        'There is already an active delegation for this registration.',
      );
    });

    it('should prevent delegation if already served', async () => {
      prismaMock.registration.findUnique.mockResolvedValue({
        userId: 'owner1',
        id: 'reg1',
        status: 'ACTIVE',
      });
      // Simulate meal already served
      prismaMock.mealServing.findUnique.mockResolvedValue({ id: 'serving1' });

      await expect(
        service.createDelegation('owner1', {
          registrationId: 'reg1',
          delegateUserId: 'delegate1',
        }),
      ).rejects.toThrow('Cannot delegate a meal that has already been served.');
    });
  });

  describe('acceptDelegation', () => {
    it('should successfully accept if pending and target delegate', async () => {
      prismaMock.pickupDelegation.findUnique.mockResolvedValue({
        id: 'del1',
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
        status: 'PENDING',
        registration: {
          userId: 'owner1',
          mealDate: new Date('2026-09-08T00:00:00.000Z'),
        },
      });
      prismaMock.mealServing.findUnique.mockResolvedValue(null);
      prismaMock.pickupDelegation.update.mockResolvedValue({
        id: 'del1',
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
        status: 'ACCEPTED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.acceptDelegation('delegate1', 'del1');
      expect(res.status).toBe('ACCEPTED');
    });

    it('should reject if not target delegate', async () => {
      prismaMock.pickupDelegation.findUnique.mockResolvedValue({
        id: 'del1',
        delegateUserId: 'delegate1',
        status: 'PENDING',
      });
      await expect(
        service.acceptDelegation('otherUser', 'del1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if not PENDING', async () => {
      prismaMock.pickupDelegation.findUnique.mockResolvedValue({
        id: 'del1',
        delegateUserId: 'delegate1',
        status: 'ACCEPTED',
      });
      await expect(
        service.acceptDelegation('delegate1', 'del1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('revokeDelegation', () => {
    it('should revoke successfully by owner', async () => {
      prismaMock.pickupDelegation.findUnique.mockResolvedValue({
        id: 'del1',
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
        status: 'PENDING',
        registration: {
          userId: 'owner1',
          mealDate: new Date('2026-09-08T00:00:00.000Z'),
        },
      });
      prismaMock.mealServing.findUnique.mockResolvedValue(null);
      prismaMock.pickupDelegation.update.mockResolvedValue({
        id: 'del1',
        registrationId: 'reg1',
        delegateUserId: 'delegate1',
        status: 'REVOKED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.revokeDelegation('owner1', 'del1');
      expect(res.status).toBe('REVOKED');
    });

    it('should reject if not owner', async () => {
      prismaMock.pickupDelegation.findUnique.mockResolvedValue({
        id: 'del1',
        status: 'PENDING',
        registration: { userId: 'owner1' },
      });
      await expect(
        service.revokeDelegation('otherUser', 'del1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
