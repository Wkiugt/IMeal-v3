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

    return await prisma.registration.upsert({
      where: {
        userId_mealDate: { userId, mealDate: targetDate },
      },
      update: {
        status: 'ACTIVE',
      },
      create: {
        userId,
        mealDate: targetDate,
        status: 'ACTIVE',
      },
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
      await tx.registration.update({
        where: { id: registrationId },
        data: { status: 'SERVED' },
      });

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

        await tx.registration.update({
          where: { id: registrationId },
          data: { status: 'SERVED' },
        });
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
