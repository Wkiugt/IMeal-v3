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
          OR: normalizedEmail
            ? [{ userId }, { normalizedEmail }]
            : [{ userId }],
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

  static async cancelRegistration(registrationId: string, currentTime: Date) {
    const result = await prisma.$transaction(async (tx) =>
      this.transitionRegistrationToCancelled(tx, registrationId, currentTime, {
        actorUserId: undefined,
        cancelReason: 'REGISTRATION_CANCELLED',
        enforceCutoff: true,
        skipFinalized: false,
      }),
    );
    if (!result) {
      throw new Error('Cannot cancel this registration');
    }
    return result;
  }

  private static async transitionRegistrationToCancelled(
    tx: Prisma.TransactionClient,
    registrationId: string,
    currentTime: Date,
    options: {
      actorUserId: string | undefined;
      cancelReason: 'REGISTRATION_CANCELLED' | 'ACCOUNT_DISABLED';
      enforceCutoff: boolean;
      skipFinalized: boolean;
    },
  ) {
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE`;
    const currentReg = await tx.registration.findUnique({
      where: { id: registrationId },
      include: {
        user: { select: { name: true, email: true } },
        mealServing: { select: { id: true } },
        penalties: { select: { id: true } },
      },
    });
    if (!currentReg) {
      if (options.skipFinalized) return null;
      throw new Error('Not found');
    }
    if (
      currentReg.status !== 'ACTIVE' ||
      currentReg.mealServing ||
      currentReg.penalties.length > 0
    ) {
      if (options.skipFinalized) return null;
      throw new Error('Cannot cancel this registration');
    }
    if (
      options.enforceCutoff &&
      !this.isAllowed(currentReg.mealDate, currentTime)
    ) {
      throw new Error('Cutoff time has passed for this meal date.');
    }

    const actorUserId = options.actorUserId ?? currentReg.userId;
    const updatedReg = await tx.registration.update({
      where: { id: registrationId },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        cancelledAt: currentTime,
        cancelReason: options.cancelReason,
        cancelledByUserId: actorUserId,
      },
    });

    const activeDelegations = await tx.pickupDelegation.findMany({
      where: {
        registrationId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      orderBy: { id: 'asc' },
      select: { id: true, delegateUserId: true },
    });
    const counterpartName =
      currentReg.user.name?.trim() ||
      currentReg.user.email?.trim() ||
      'nhân viên';
    for (const delegation of activeDelegations) {
      await tx.pickupDelegation.update({
        where: { id: delegation.id },
        data: { status: 'REVOKED' },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'delegation_revoked',
          details: `Delegation ${delegation.id} revoked because registration ${registrationId} was cancelled with reason ${options.cancelReason}`,
        },
      });

      const mealDate = currentReg.mealDate.toISOString().slice(0, 10);
      const notification = await tx.notification.upsert({
        where: {
          dedupeKey: `delegation-revoked:${delegation.delegateUserId}:${delegation.id}`,
        },
        update: {},
        create: {
          userId: delegation.delegateUserId,
          kind: 'DELEGATION_REVOKED',
          payload: {
            delegationId: delegation.id,
            registrationId,
            mealDate,
            counterpartName,
            reason: options.cancelReason,
          },
          titleVi: 'Ủy quyền đã thu hồi',
          bodyVi: `Yêu cầu nhận hộ từ ${counterpartName} cho ngày ${mealDate} đã được thu hồi.`,
          titleEn: 'Pickup delegation revoked',
          bodyEn: `The pickup request from ${counterpartName} for ${mealDate} was revoked.`,
          dedupeKey: `delegation-revoked:${delegation.delegateUserId}:${delegation.id}`,
        },
      });
      await tx.outboxEvent.upsert({
        where: { dedupeKey: `notification-delivery:${notification.id}` },
        update: {},
        create: {
          aggregateType: 'NOTIFICATION',
          aggregateId: notification.id,
          eventType: 'NOTIFICATION_CREATED',
          payload: JSON.stringify({ notificationId: notification.id }),
          dedupeKey: `notification-delivery:${notification.id}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action:
          options.cancelReason === 'ACCOUNT_DISABLED'
            ? 'registration_account_disabled'
            : 'registration_cancelled',
        details: `Registration ${registrationId} cancelled with reason ${options.cancelReason}`,
      },
    });
    return updatedReg;
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
