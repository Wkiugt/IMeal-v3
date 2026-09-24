import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { v1 } from '@imeal/contracts';
type RosterImportRow = v1.RosterImportRow;
function emailHash(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}
import type {
  LocationsService,
  ResolvedLocation,
} from '../../locations/locations.service.js';

export type RosterImportBatchInput = {
  source: string;
  rows: RosterImportRow[];
};

export type RosterImportReason =
  | 'INVALID_ROW'
  | 'UNKNOWN_SERVICE_LOCATION'
  | 'DUPLICATE_EMPLOYEE_CODE'
  | 'INVALID_EFFECTIVE_RANGE'
  | 'INACTIVE_CAPABILITY';

export type RosterPreviewRow = RosterImportRow & {
  rowNumber: number;
  normalizedEmail: string;
  employeeCode: string;
  role: string;
  serviceLocationCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  locationId?: string;
  reason?: RosterImportReason;
};

export type RosterPreview = {
  batchId?: string;
  source: string;
  rows: RosterPreviewRow[];
  valid: boolean;
  acceptedCount: number;
  rejectedCount: number;
};

export type RosterImportResult = {
  batchId: string;
  rows: Array<{
    rowNumber: number;
    normalizedEmail: string;
    assignmentId: string;
    outcome: 'ACCEPTED';
  }>;
  acceptedCount: number;
  idempotent: boolean;
};

type NormalizedRow = Omit<RosterPreviewRow, 'reason'> & {
  location: ResolvedLocation;
  reason: RosterImportReason[];
};

const DISABLED_CAPABILITIES = new Set(['', 'NONE', 'INACTIVE', 'DISABLED']);

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim();
}

function normalizeEmail(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeCode(value: string): string {
  return normalizeText(value).toUpperCase();
}

function parseUtcDate(value: string): Date | null {
  if (!value.endsWith('Z')) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function hasOnlyRosterFields(row: unknown): row is RosterImportRow {
  if (!row || typeof row !== 'object') return false;
  const allowed = new Set([
    'email',
    'name',
    'employeeCode',
    'isActive',
    'role',
    'serviceLocationCode',
    'effectiveFrom',
    'effectiveTo',
  ]);
  return Object.keys(row).every((key) => allowed.has(key));
}

function locationReason(error: unknown): RosterImportReason {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'code' in error.response &&
    error.response.code === 'UNKNOWN_SERVICE_LOCATION'
  ) {
    return 'UNKNOWN_SERVICE_LOCATION';
  }
  return 'UNKNOWN_SERVICE_LOCATION';
}

@Injectable()
export class RosterImportService {
  private readonly prisma: PrismaClient;

  constructor(private readonly locationsService: LocationsService) {
    this.prisma = new PrismaClient();
  }

  async preview(
    input: RosterImportBatchInput,
    at: Date = new Date(),
  ): Promise<RosterPreview> {
    if (
      !input ||
      typeof input.source !== 'string' ||
      !input.source.trim() ||
      !Array.isArray(input.rows) ||
      input.rows.length === 0
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Roster import source and rows are required.',
      });
    }
    const rows: RosterPreviewRow[] = [];
    const employeeCodes = new Map<string, number[]>();

    for (let index = 0; index < input.rows.length; index += 1) {
      const sourceRow = input.rows[index];
      const normalized = this.normalizeRow(sourceRow, index + 1);
      const reasons = normalized.reason ? [...normalized.reason] : [];
      let location: ResolvedLocation | null = null;

      if (
        normalized.serviceLocationCode &&
        !reasons.includes('UNKNOWN_SERVICE_LOCATION')
      ) {
        try {
          location = await this.locationsService.resolveEffectiveLocation(
            normalized.serviceLocationCode,
            normalized.effectiveFromDate ?? at,
          );
          normalized.locationId = location.id;
        } catch (error: unknown) {
          reasons.push(locationReason(error));
        }
      }

      if (
        normalized.isActive === false &&
        !DISABLED_CAPABILITIES.has(normalized.role.toUpperCase())
      ) {
        reasons.push('INACTIVE_CAPABILITY');
      }

      const codeRows = employeeCodes.get(normalized.employeeCode) ?? [];
      codeRows.push(index);
      employeeCodes.set(normalized.employeeCode, codeRows);

      rows.push({
        ...this.publicRow(normalized),
        reason: selectReason(reasons),
      });
    }

    for (const indexes of employeeCodes.values()) {
      if (indexes.length < 2) continue;
      for (const index of indexes) {
        rows[index].reason = selectReason([
          ...(rows[index].reason ? [rows[index].reason] : []),
          'DUPLICATE_EMPLOYEE_CODE',
        ]);
      }
    }

    const duplicateCodes = Array.from(employeeCodes.keys());
    if (duplicateCodes.length > 0) {
      const existing = await this.prisma.employeeLocationAssignment.findMany({
        where: { employeeCode: { in: duplicateCodes }, isActive: true },
        select: {
          employeeCode: true,
          normalizedEmail: true,
          serviceLocationCode: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      });
      for (const row of rows) {
        const conflicting = existing.some(
          (assignment) =>
            assignment.employeeCode === row.employeeCode &&
            assignment.normalizedEmail !== row.normalizedEmail,
        );
        if (conflicting) {
          row.reason = selectReason([
            ...(row.reason ? [row.reason] : []),
            'DUPLICATE_EMPLOYEE_CODE',
          ]);
        }
      }
    }

    const rejectedCount = rows.filter((row) => row.reason !== undefined).length;
    const valid = rejectedCount === 0;
    if (!valid) {
      return {
        source: normalizeText(input.source),
        rows,
        valid: false,
        acceptedCount: 0,
        rejectedCount,
      };
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const createdBatch = await tx.rosterImportBatch.create({
        data: { source: normalizeText(input.source) },
      });
      const batchId = createdBatch?.id ?? randomUUID();
      for (const row of rows) {
        await tx.rosterImportRow.create({
          data: {
            batchId,
            normalizedEmail: row.normalizedEmail,
            employeeName: row.name,
            employeeCode: row.employeeCode,
            isActive: row.isActive,
            role: row.role,
            serviceLocationCode: row.serviceLocationCode,
            effectiveFrom: new Date(row.effectiveFrom),
            effectiveTo: row.effectiveTo ? new Date(row.effectiveTo) : null,
          },
        });
      }
      return createdBatch;
    });
    const batchId = batch?.id ?? randomUUID();

    return {
      batchId,
      source: normalizeText(input.source),
      rows,
      valid: true,
      acceptedCount: rows.length,
      rejectedCount: 0,
    };
  }

  async commit(batchId: string, actorId: string): Promise<RosterImportResult> {
    if (!batchId.trim() || !actorId.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Batch and actor are required.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.rosterImportBatch.findUnique({
        where: { id: batchId },
        include: { rows: true },
      });
      if (!batch) {
        throw new NotFoundException({
          code: 'ROSTER_BATCH_NOT_FOUND',
          message: 'Roster import batch was not found.',
        });
      }

      const rows = batch.rows;
      if (rows.length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Roster import batch is empty.',
        });
      }
      if (rows.every((row) => row.outcome === 'ACCEPTED')) {
        return {
          batchId,
          rows: rows.map((row, index) => ({
            rowNumber: index + 1,
            normalizedEmail: row.normalizedEmail,
            assignmentId: row.assignmentId ?? '',
            outcome: 'ACCEPTED' as const,
          })),
          acceptedCount: rows.length,
          idempotent: true,
        };
      }
      if (rows.some((row) => row.outcome === 'REJECTED')) {
        throw new BadRequestException({
          code: 'ROSTER_IMPORT_REJECTED',
          message: 'Roster import contains rejected rows.',
        });
      }

      const batchAudit = await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'ROSTER_IMPORT_COMMITTED',
          details: JSON.stringify({ batchId }),
        },
      });
      const batchAuditId = batchAudit?.id ?? randomUUID();
      let idempotent = true;

      const duplicateCodes = await tx.employeeLocationAssignment.findMany({
        where: {
          employeeCode: { in: rows.map((row) => row.employeeCode) },
          isActive: true,
        },
        select: { id: true, employeeCode: true, normalizedEmail: true },
      });
      const duplicateByCode = new Map(
        duplicateCodes.map((assignment) => [
          assignment.employeeCode,
          assignment,
        ]),
      );

      const resultRows: RosterImportResult['rows'] = [];
      for (const [index, row] of rows.entries()) {
        const duplicate = duplicateByCode.get(row.employeeCode);
        if (duplicate && duplicate.normalizedEmail !== row.normalizedEmail) {
          throw new BadRequestException({
            code: 'ROSTER_IMPORT_REJECTED',
            message: 'Employee code is already assigned.',
          });
        }
        const location = await this.locationsService.resolveEffectiveLocation(
          row.serviceLocationCode,
          row.effectiveFrom,
        );
        const user = await tx.user.findUnique({
          where: { email: row.normalizedEmail },
          select: { id: true },
        });
        const audit = await tx.auditLog.create({
          data: {
            userId: actorId,
            action: 'ROSTER_ASSIGNMENT_IMPORTED',
            details: JSON.stringify({
              batchId,
              emailHash: emailHash(row.normalizedEmail),
              employeeCode: row.employeeCode,
              locationId: location.id,
            }),
          },
        });

        const existing = await tx.employeeLocationAssignment.findFirst({
          where: {
            normalizedEmail: row.normalizedEmail,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: row.effectiveTo,
          },
        });
        let assignment;
        const assignmentData = {
          userId: user?.id ?? null,
          normalizedEmail: row.normalizedEmail,
          employeeName: row.employeeName,
          employeeCode: row.employeeCode,
          isActive: row.isActive,
          role: row.role,
          serviceLocationCode: row.serviceLocationCode,
          locationId: location.id,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          rosterImportBatchId: batchId,
          auditEventId: audit?.id ?? randomUUID(),
        };
        if (
          existing &&
          existing.employeeCode === row.employeeCode &&
          existing.serviceLocationCode === row.serviceLocationCode &&
          existing.locationId === location.id &&
          existing.isActive === row.isActive &&
          existing.role === row.role
        ) {
          assignment = existing;
        } else if (existing) {
          assignment = await tx.employeeLocationAssignment.update({
            where: { id: existing.id },
            data: assignmentData,
          });
          idempotent = false;
        } else {
          const prior = await tx.employeeLocationAssignment.findFirst({
            where: { normalizedEmail: row.normalizedEmail, isActive: true },
          });
          if (prior && prior.effectiveFrom < row.effectiveFrom) {
            await tx.employeeLocationAssignment.update({
              where: { id: prior.id },
              data: { isActive: false, effectiveTo: row.effectiveFrom },
            });
          }
          assignment = await tx.employeeLocationAssignment.create({
            data: assignmentData,
          });
          idempotent = false;
        }

        await tx.rosterImportRow.update({
          where: { id: row.id },
          data: {
            outcome: 'ACCEPTED',
            assignmentId: assignment.id,
            auditEventId: audit?.id ?? randomUUID(),
          },
        });
        resultRows.push({
          rowNumber: index + 1,
          normalizedEmail: row.normalizedEmail,
          assignmentId: assignment.id,
          outcome: 'ACCEPTED',
        });
      }
      await tx.rosterImportBatch.update({
        where: { id: batchId },
        data: {
          importedByUserId: actorId,
          importedAt: new Date(),
          auditEventId: batchAuditId,
        },
      });
      return {
        batchId,
        rows: resultRows,
        acceptedCount: resultRows.length,
        idempotent,
      };
    });
  }

  private normalizeRow(
    row: unknown,
    rowNumber: number,
  ): NormalizedRow & { effectiveFromDate: Date | null } {
    const fallback = {
      rowNumber,
      email: '',
      name: '',
      employeeCode: '',
      isActive: false,
      role: '',
      serviceLocationCode: '',
      effectiveFrom: '',
      effectiveTo: null,
      normalizedEmail: '',
      locationId: undefined,
      effectiveFromDate: null,
      reason: ['INVALID_ROW'] as RosterImportReason[],
      location: null as unknown as ResolvedLocation,
    };
    if (!hasOnlyRosterFields(row)) return fallback;

    const normalized = {
      rowNumber,
      email: normalizeEmail(row.email),
      name: normalizeText(row.name),
      employeeCode: normalizeCode(row.employeeCode),
      isActive: row.isActive,
      role: normalizeCode(row.role),
      serviceLocationCode: normalizeCode(row.serviceLocationCode),
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      normalizedEmail: normalizeEmail(row.email),
      locationId: undefined as string | undefined,
      effectiveFromDate: parseUtcDate(row.effectiveFrom),
      reason: [] as RosterImportReason[],
      location: null as unknown as ResolvedLocation,
    };

    const parsed = v1.RosterImportRowSchema.safeParse({
      email: normalized.email,
      name: normalized.name,
      employeeCode: normalized.employeeCode,
      isActive: normalized.isActive,
      role: normalized.role,
      serviceLocationCode: normalized.serviceLocationCode,
      effectiveFrom: normalized.effectiveFrom,
      effectiveTo: normalized.effectiveTo,
    });
    if (!parsed.success || !normalized.effectiveFromDate) {
      normalized.reason.push('INVALID_ROW');
      return normalized;
    }
    const effectiveToDate = normalized.effectiveTo
      ? parseUtcDate(normalized.effectiveTo)
      : null;
    if (normalized.effectiveTo && !effectiveToDate) {
      normalized.reason.push('INVALID_EFFECTIVE_RANGE');
    } else if (
      effectiveToDate &&
      effectiveToDate <= normalized.effectiveFromDate
    ) {
      normalized.reason.push('INVALID_EFFECTIVE_RANGE');
    }
    return normalized;
  }

  private publicRow(
    row: NormalizedRow & { effectiveFromDate: Date | null },
  ): RosterPreviewRow {
    return {
      rowNumber: row.rowNumber,
      email: row.email,
      name: row.name,
      employeeCode: row.employeeCode,
      isActive: row.isActive,
      role: row.role,
      serviceLocationCode: row.serviceLocationCode,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      normalizedEmail: row.normalizedEmail,
      locationId: row.locationId,
      reason: selectReason(row.reason),
    };
  }
}

const REASON_PRIORITY: RosterImportReason[] = [
  'DUPLICATE_EMPLOYEE_CODE',
  'UNKNOWN_SERVICE_LOCATION',
  'INVALID_EFFECTIVE_RANGE',
  'INACTIVE_CAPABILITY',
  'INVALID_ROW',
];

function selectReason(
  reasons: RosterImportReason[] | RosterImportReason,
): RosterImportReason | undefined {
  const values = Array.isArray(reasons) ? reasons : [reasons];
  return REASON_PRIORITY.find((reason) => values.includes(reason));
}
