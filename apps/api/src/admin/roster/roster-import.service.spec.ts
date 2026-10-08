import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  RosterImportService,
  type RosterImportBatchInput,
} from './roster-import.service.js';
import { LocationsService } from '../../locations/locations.service.js';

const NOW = new Date('2026-09-24T03:00:00.000Z');
const LOCATION = {
  id: 'location-1',
  shortCode: 'LOC-A',
  displayName: 'Approved location',
  servingPointName: 'Approved serving point',
  address: 'Approved address',
  building: 'Building',
  floor: '1',
  roomOrCounter: 'Counter',
  localContact: 'Contact',
  timeZone: 'Asia/Ho_Chi_Minh',
  isActive: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
};

const prisma = {
  location: { findFirst: vi.fn() },
  employeeLocationAssignment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  rosterImportBatch: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  rosterImportRow: { create: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};


const locationsService = {
  resolveEffectiveLocation: vi.fn(),
};

describe('RosterImportService', () => {
  let service: RosterImportService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new RosterImportService(
      locationsService as unknown as LocationsService,
      prisma as never,
    );
    locationsService.resolveEffectiveLocation.mockResolvedValue({
      ...LOCATION,
      locationPolicy: null,
    });
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  it('normalizes approved fields and reports every invalid row without committing', async () => {
    const input: RosterImportBatchInput = {
      source: 'approved-import.csv',
      rows: [
        {
          email: ' Employee@Example.test ',
          name: 'Employee',
          employeeCode: 'EMP-1',
          isActive: true,
          role: 'staff',
          serviceLocationCode: 'LOC-A',
          effectiveFrom: '2026-09-24T00:00:00.000Z',
          effectiveTo: null,
        },
        {
          email: 'second@example.test',
          name: 'Second',
          employeeCode: 'EMP-1',
          isActive: false,
          role: 'kitchen',
          serviceLocationCode: 'UNKNOWN',
          effectiveFrom: '2026-09-25T00:00:00.000Z',
          effectiveTo: '2026-09-24T00:00:00.000Z',
        },
        {
          email: 'third@example.test',
          name: 'Third',
          employeeCode: 'EMP-3',
          isActive: true,
          role: 'staff',
          serviceLocationCode: 'UNKNOWN',
          effectiveFrom: '2026-09-25T00:00:00.000Z',
          effectiveTo: null,
        },
        {
          email: 'fourth@example.test',
          name: 'Fourth',
          employeeCode: 'EMP-4',
          isActive: true,
          role: 'staff',
          serviceLocationCode: 'LOC-A',
          effectiveFrom: '2026-09-26T00:00:00.000Z',
          effectiveTo: '2026-09-25T00:00:00.000Z',
        },
        {
          email: 'fifth@example.test',
          name: 'Fifth',
          employeeCode: 'EMP-5',
          isActive: false,
          role: 'kitchen',
          serviceLocationCode: 'LOC-A',
          effectiveFrom: '2026-09-27T00:00:00.000Z',
          effectiveTo: null,
        },
      ],
    };
    locationsService.resolveEffectiveLocation.mockImplementation(
      async (code: string) => {
        if (code === 'UNKNOWN') {
          throw new Error('UNKNOWN_SERVICE_LOCATION');
        }
        return { ...LOCATION, locationPolicy: null };
      },
    );

    const result = await service.preview(input, NOW);

    expect(result.rows[0]).toMatchObject({
      normalizedEmail: 'employee@example.test',
      employeeCode: 'EMP-1',
      serviceLocationCode: 'LOC-A',
      reason: 'DUPLICATE_EMPLOYEE_CODE',
    });
    expect(result.rows.map((row) => row.reason)).toEqual(
      expect.arrayContaining([
        'UNKNOWN_SERVICE_LOCATION',
        'DUPLICATE_EMPLOYEE_CODE',
        'INVALID_EFFECTIVE_RANGE',
        'INACTIVE_CAPABILITY',
      ]),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts an exact normalized assignment replay as an idempotent preview', async () => {
    prisma.employeeLocationAssignment.findMany.mockResolvedValue([
      {
        employeeCode: 'EMP-1',
        normalizedEmail: 'employee@example.test',
        serviceLocationCode: 'LOC-A',
        effectiveFrom: new Date('2026-09-24T00:00:00.000Z'),
        effectiveTo: null,
      },
    ]);

    const result = await service.preview(
      {
        source: 'replayed-import.csv',
        rows: [
          {
            email: ' Employee@Example.test ',
            name: 'Employee',
            employeeCode: 'EMP-1',
            isActive: true,
            role: 'staff',
            serviceLocationCode: 'LOC-A',
            effectiveFrom: '2026-09-24T00:00:00.000Z',
            effectiveTo: null,
          },
        ],
      },
      NOW,
    );

    expect(result.valid).toBe(true);
    expect(result.rows[0].reason).toBeUndefined();
  });

  it('stages the batch and every preview row in one transaction', async () => {
    const writes: string[] = [];
    prisma.rosterImportBatch.create.mockImplementation(async () => {
      writes.push('batch');
      return { id: 'batch-1' };
    });
    prisma.rosterImportRow.create.mockImplementation(async () => {
      writes.push('row');
      throw new Error('staging failed');
    });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => {
        try {
          return await callback(prisma);
        } catch (error: unknown) {
          writes.length = 0;
          throw error;
        }
      },
    );

    await expect(
      service.preview({
        source: 'failing-import.csv',
        rows: [
          {
            email: 'employee@example.test',
            name: 'Employee',
            employeeCode: 'EMP-1',
            isActive: true,
            role: 'staff',
            serviceLocationCode: 'LOC-A',
            effectiveFrom: '2026-09-24T00:00:00.000Z',
            effectiveTo: null,
          },
        ],
      }),
    ).rejects.toThrow('staging failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it('commits all rows atomically and is idempotent by normalized email', async () => {
    const input: RosterImportBatchInput = {
      source: 'approved-import.csv',
      rows: [
        {
          email: ' Employee@Example.test ',
          name: 'Employee',
          employeeCode: 'EMP-1',
          isActive: true,
          role: 'staff',
          serviceLocationCode: 'LOC-A',
          effectiveFrom: '2026-09-24T00:00:00.000Z',
          effectiveTo: null,
        },
      ],
    };
    const batch = await service.preview(input, NOW);
    prisma.rosterImportBatch.create.mockResolvedValue({ id: 'batch-1' });
    prisma.rosterImportBatch.findUnique
      .mockResolvedValueOnce({
        id: 'batch-1',
        source: input.source,
        rows: [
          {
            ...batch.rows[0],
            id: 'row-1',
            outcome: 'PENDING',
            assignmentId: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'batch-1',
        source: input.source,
        rows: [
          {
            ...batch.rows[0],
            id: 'row-1',
            outcome: 'ACCEPTED',
            assignmentId: 'assignment-1',
          },
        ],
      });
    prisma.employeeLocationAssignment.create.mockResolvedValue({
      id: 'assignment-1',
    });
    prisma.rosterImportRow.create.mockResolvedValue({ id: 'row-1' });
    prisma.rosterImportRow.update.mockResolvedValue({});

    const first = await service.commit('batch-1', 'admin-1');
    const replay = await service.commit('batch-1', 'admin-1');

    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    expect(prisma.employeeLocationAssignment.create).toHaveBeenCalledTimes(1);
    expect(prisma.rosterImportBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ auditEventId: expect.any(String) }),
      }),
    );
    expect(prisma.rosterImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'row-1' },
        data: expect.objectContaining({ auditEventId: expect.any(String) }),
      }),
    );
  });
});
