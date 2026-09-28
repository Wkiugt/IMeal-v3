import { toZonedTime } from 'date-fns-tz';
import { Prisma } from '@prisma/client';
import { prisma } from './db';

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

export class RegistrationService {
  static isAllowed(targetDate: Date, currentTime: Date): boolean {
    const vnCurrent = toZonedTime(currentTime, VN_TIMEZONE);
    const vnTarget = toZonedTime(targetDate, VN_TIMEZONE);

    const currentDate = new Date(
      vnCurrent.getFullYear(),
      vnCurrent.getMonth(),
      vnCurrent.getDate(),
    );
    const mealDate = new Date(
      vnTarget.getFullYear(),
      vnTarget.getMonth(),
      vnTarget.getDate(),
    );

    const diffDays = Math.floor(
      (mealDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays > 1) return true;
    if (diffDays < 1) return false;

    if (vnCurrent.getHours() >= 14) {
      return false;
    }

    return true;
  }

  static buildLocationSnapshot(
    assignment: {
      id: string;
      serviceLocationCode: string;
      effectiveFrom: Date;
      location: {
        id: string;
        displayName: string;
        address: string;
      };
    },
    snapshotAt: Date,
  ) {
    return {
      serviceLocationId: assignment.location.id,
      serviceLocationAssignmentId: assignment.id,
      serviceLocationCode: assignment.serviceLocationCode,
      serviceLocationName: assignment.location.displayName,
      serviceLocationAddress: assignment.location.address,
      serviceLocationEffectiveFrom: new Date(assignment.effectiveFrom),
      serviceLocationSnapshotAt: new Date(snapshotAt),
    };
  }

  static buildEffectiveAssignmentWhere(
    userId: string,
    normalizedEmail: string | undefined,
    targetDate: Date,
  ) {
    return {
      isActive: true,
      AND: [
        {
          OR: normalizedEmail ? [{ userId }, { normalizedEmail }] : [{ userId }],
        },
        { effectiveFrom: { lte: targetDate } },
        {
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: targetDate } }],
        },
      ],
      location: {
        is: {
          isActive: true,
          effectiveFrom: { lte: targetDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: targetDate } }],
        },
      },
    };
  }

  static async registerMeal(
    userId: string,
    targetDate: Date,
    currentTime: Date,
  ) {
    if (!this.isAllowed(targetDate, currentTime)) {
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
        where: this.buildEffectiveAssignmentWhere(
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
        ? this.buildLocationSnapshot(assignment, currentTime)
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

  static async cancelRegistration(registrationId: string, currentTime: Date) {
    const reg = await prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!reg) throw new Error('Not found');

    if (!this.isAllowed(reg.mealDate, currentTime)) {
      throw new Error('Cutoff time has passed for this meal date.');
    }

    return await prisma.$transaction(async (tx) => {
      const currentReg = await tx.registration.findUnique({
        where: { id: registrationId },
      });
      if (!currentReg || currentReg.status !== 'ACTIVE') {
        throw new Error('Cannot cancel this registration');
      }

      const updatedReg = await tx.registration.update({
        where: { id: registrationId },
        data: { status: 'CANCELLED' },
      });

      await tx.pickupDelegation.updateMany({
        where: { registrationId, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'REVOKED' },
      });

      return updatedReg;
    });
  }

  static async delegatePickup(
    registrationId: string,
    delegateUserId: string,
    currentTime: Date,
  ) {
    const reg = await prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!reg) throw new Error('Not found');
    if (reg.status !== 'ACTIVE')
      throw new Error('Can only delegate registered meals');

    if (!this.isAllowed(reg.mealDate, currentTime)) {
      throw new Error('Cutoff time has passed for this meal date.');
    }

    return await prisma.$transaction(async (tx) => {
      await tx.pickupDelegation.updateMany({
        where: { registrationId, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'REVOKED' },
      });
      return await tx.pickupDelegation.create({
        data: {
          registrationId,
          delegateUserId,
          status: 'PENDING',
        },
      });
    });
  }

  static async disableUserAccount(userId: string, currentTime: Date) {
    const futureRegistrations = await prisma.registration.findMany({
      where: {
        userId,
        mealDate: { gt: currentTime },
        status: 'ACTIVE',
      },
    });

    for (const reg of futureRegistrations) {
      if (this.isAllowed(reg.mealDate, currentTime)) {
        await this.cancelRegistration(reg.id, currentTime);
      }
    }
  }

  static async applyNoShowPenalty(
    userId: string,
    idempotencyKey: string,
    currentTime: Date,
    amount: number = 50000,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const existing = await tx.penalty.findFirst({
      where: { userId, reason: idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    return await tx.penalty.create({
      data: {
        userId,
        amount,
        reason: idempotencyKey,
        createdAt: currentTime,
      },
    });
  }

  static async canServe(
    registrationId: string,
    pickerUserId: string,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const reg = await tx.registration.findUnique({
      where: { id: registrationId },
      include: {
        delegations: { where: { status: 'ACCEPTED' } },
        mealServing: true,
      },
    });

    if (!reg || reg.status !== 'ACTIVE' || reg.mealServing) return false;
    if (reg.userId === pickerUserId) return true;

    if (
      reg.delegations.length > 0 &&
      reg.delegations[0].delegateUserId === pickerUserId
    ) {
      return true;
    }

    return false;
  }

  static async serveMeal(
    registrationId: string,
    pickerUserId: string,
    idempotencyKey?: string,
  ) {
    return await prisma.$transaction(async (tx) => {
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
        select: { status: true, mealServing: { select: { id: true } } },
      });
      if (currentReg?.status === 'SERVED' || currentReg?.mealServing) {
        throw new Error('Already served');
      }

      const can = await this.canServe(registrationId, pickerUserId, tx);
      if (!can) {
        throw new Error('Not eligible to serve');
      }

      let serving;
      try {
        serving = await tx.mealServing.create({
          data: { registrationId },
        });
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
    return await prisma.$transaction(async (tx) => {
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
            return true;
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

      for (const registrationId of registrationIds) {
        const currentReg = await tx.registration.findUnique({
          where: { id: registrationId },
          select: { status: true, mealServing: { select: { id: true } } },
        });
        if (currentReg?.status === 'SERVED' || currentReg?.mealServing) {
          throw new Error(`Already served ${registrationId}`);
        }

        const can = await this.canServe(registrationId, pickerUserId, tx);
        if (!can) {
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

  static async getMenuRevision(registrationId: string) {
    const reg = await prisma.registration.findUnique({
      where: { id: registrationId },
    });

    if (!reg) throw new Error('Not found');
    if (reg.status === 'CANCELLED') {
      return 'IMMUTABLE_REVISION_MOCK';
    }

    return 'APPROVED_PRE_CUTOFF_REVISION_MOCK';
  }
}
