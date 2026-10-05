import { Prisma } from '../src/prisma.js';
import { prisma } from '../src/db.js';
import { RegistrationService } from '../src/RegistrationService.js';

/**
 * Compatibility-only database fixtures for historical domain tests.
 *
 * These writes intentionally model pre-Phase-0 rows and MUST NOT be used by
 * application runtime code. Production registration, cancellation, serving,
 * and no-show writes belong to the API/worker transactions.
 */
export class LegacyRegistrationFixtureService {
  static async registerMeal(
    userId: string,
    targetDate: Date,
    currentTime: Date,
  ) {
    if (!RegistrationService.isAllowed(targetDate, currentTime)) {
      throw new Error('Cutoff time has passed for this meal date.');
    }

    const dailyMenu = await prisma.dailyMenu.findFirst({
      where: { date: targetDate },
    });

    if (!dailyMenu || dailyMenu.isHoliday || !dailyMenu.isEnabled) {
      throw new Error('Menu is not available for this date.');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const normalizedEmail = user?.email
        .normalize('NFKC')
        .trim()
        .toLowerCase();
      const assignment = await tx.employeeLocationAssignment.findFirst({
        where: RegistrationService.buildEffectiveAssignmentWhere(
          userId,
          normalizedEmail,
          targetDate,
        ),
        include: { location: true },
        orderBy: { effectiveFrom: 'desc' },
      });
      const existing = await tx.registration.findUnique({
        where: {
          userId_mealDate: { userId, mealDate: targetDate },
        },
      });
      const locationSnapshot = assignment
        ? RegistrationService.buildLocationSnapshot(assignment, currentTime)
        : undefined;

      if (existing) {
        const updateData: {
          status: 'ACTIVE';
          serviceLocationId?: string;
          serviceLocationAssignmentId?: string;
          serviceLocationCode?: string;
          serviceLocationName?: string;
          serviceLocationAddress?: string;
          serviceLocationEffectiveFrom?: Date;
          serviceLocationSnapshotAt?: Date;
        } = { status: 'ACTIVE' };
        if (!existing.serviceLocationSnapshotAt && locationSnapshot) {
          Object.assign(updateData, locationSnapshot);
        }
        return tx.registration.update({
          where: { id: existing.id },
          data: updateData,
        });
      }

      return tx.registration.create({
        data: {
          userId,
          mealDate: targetDate,
          status: 'ACTIVE',
          ...locationSnapshot,
        },
      });
    });
  }


  static async applyNoShowPenalty(
    userId: string,
    idempotencyKey: string,
    currentTime: Date,
    amount = 50000,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const existing = await tx.penalty.findFirst({
      where: { userId, reason: idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    return tx.penalty.create({
      data: {
        userId,
        amount,
        reason: idempotencyKey,
        createdAt: currentTime,
      },
    });
  }

  static async serveMeal(
    registrationId: string,
    pickerUserId: string,
    idempotencyKey?: string,
  ) {
    return prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existingReq = await tx.servingConfirmRequest.findUnique({
          where: {
            callerUserId_idempotencyKey: {
              callerUserId: pickerUserId,
              idempotencyKey,
            },
          },
        });
        if (existingReq) {
          if (existingReq.status === 'SUCCESS') {
            const serving = await tx.mealServing.findUnique({
              where: { registrationId },
            });
            if (serving) return serving;
          }
          throw new Error('Previous request failed or is still processing');
        }
        await tx.servingConfirmRequest.create({
          data: {
            callerUserId: pickerUserId,
            idempotencyKey,
            status: 'PROCESSING',
          },
        });
      }

      const currentReg = await tx.registration.findUnique({
        where: { id: registrationId },
        select: {
          userId: true,
          status: true,
          mealServing: { select: { id: true } },
        },
      });
      if (currentReg?.status === 'SERVED' || currentReg?.mealServing) {
        throw new Error('Already served');
      }

      if (currentReg?.userId !== pickerUserId) {
        throw new Error('Not eligible to serve');
      }

      let serving;
      try {
        serving = await tx.mealServing.create({ data: { registrationId } });
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new Error('Already served');
        }
        throw error;
      }

      if (idempotencyKey) {
        await tx.servingConfirmRequest.update({
          where: {
            callerUserId_idempotencyKey: {
              callerUserId: pickerUserId,
              idempotencyKey,
            },
          },
          data: { status: 'SUCCESS' },
        });
      }

      return serving;
    });
  }

  static async batchServeMeals(
    registrationIds: string[],
    pickerUserId: string,
    idempotencyKey?: string,
  ) {
    return prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existingReq = await tx.servingConfirmRequest.findUnique({
          where: {
            callerUserId_idempotencyKey: {
              callerUserId: pickerUserId,
              idempotencyKey,
            },
          },
        });
        if (existingReq) {
          if (existingReq.status === 'SUCCESS') return true;
          throw new Error('Previous request failed or is still processing');
        }
        await tx.servingConfirmRequest.create({
          data: {
            callerUserId: pickerUserId,
            idempotencyKey,
            status: 'PROCESSING',
          },
        });
      }

      for (const registrationId of registrationIds) {
        const currentReg = await tx.registration.findUnique({
          where: { id: registrationId },
          select: {
            userId: true,
            status: true,
            mealServing: { select: { id: true } },
          },
        });
        if (currentReg?.status === 'SERVED' || currentReg?.mealServing) {
          throw new Error(`Already served ${registrationId}`);
        }

        if (currentReg?.userId !== pickerUserId) {
          throw new Error(`Not eligible to serve ${registrationId}`);
        }

        try {
          await tx.mealServing.create({ data: { registrationId } });
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new Error(`Already served ${registrationId}`);
          }
          throw error;
        }
      }

      if (idempotencyKey) {
        await tx.servingConfirmRequest.update({
          where: {
            callerUserId_idempotencyKey: {
              callerUserId: pickerUserId,
              idempotencyKey,
            },
          },
          data: { status: 'SUCCESS' },
        });
      }
      return true;
    });
  }
}
