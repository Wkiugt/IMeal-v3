import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { NotificationsService } from '../notifications/notifications.service.js';
import { displayNotificationName } from '../notifications/notification-copy.js';

type CreateDelegationRequest = v1.CreateDelegationRequest;
type DelegationResponse = v1.DelegationResponse;

function mealDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function response(delegation: {
  id: string;
  registrationId: string;
  delegateUserId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): DelegationResponse {
  return {
    id: delegation.id,
    registrationId: delegation.registrationId,
    delegateUserId: delegation.delegateUserId,
    status: delegation.status as DelegationResponse['status'],
    createdAt: delegation.createdAt.toISOString(),
    updatedAt: delegation.updatedAt.toISOString(),
  };
}

@Injectable()
export class DelegationsService {
  private readonly prisma: PrismaClient;

  constructor(private readonly notificationsService: NotificationsService) {
    this.prisma = new PrismaClient();
  }

  async getDelegations(
    userId: string,
    type: 'incoming' | 'outgoing',
  ): Promise<DelegationResponse[]> {
    const delegations = await this.prisma.pickupDelegation.findMany({
      where:
        type === 'incoming'
          ? { delegateUserId: userId }
          : { registration: { userId } },
      orderBy: { createdAt: 'desc' },
    });

    return delegations.map((delegation) =>
      v1.DelegationResponseSchema.parse(response(delegation)),
    );
  }

  async createDelegation(
    ownerUserId: string,
    data: CreateDelegationRequest,
  ): Promise<DelegationResponse> {
    if (ownerUserId === data.delegateUserId) {
      throw new BadRequestException('Cannot delegate to yourself.');
    }

    const delegation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${data.registrationId} FOR UPDATE`;
      const registration = await tx.registration.findUnique({
        where: { id: data.registrationId },
        include: { user: true },
      });

      if (!registration) {
        throw new NotFoundException('Registration not found.');
      }
      if (registration.userId !== ownerUserId) {
        throw new ForbiddenException(
          'You can only delegate your own registrations.',
        );
      }
      if (registration.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Only active registrations can be delegated.',
        );
      }

      const serving = await tx.mealServing.findUnique({
        where: { registrationId: data.registrationId },
      });
      if (serving) {
        throw new BadRequestException(
          'Cannot delegate a meal that has already been served.',
        );
      }

      const activeDelegation = await tx.pickupDelegation.findFirst({
        where: {
          registrationId: data.registrationId,
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
      });
      if (activeDelegation) {
        throw new BadRequestException(
          'There is already an active delegation for this registration.',
        );
      }

      const newDelegation = await tx.pickupDelegation.create({
        data: {
          registrationId: data.registrationId,
          delegateUserId: data.delegateUserId,
          status: 'PENDING',
        },
      });

      await this.notificationsService.publish(tx, {
        userId: data.delegateUserId,
        kind: 'DELEGATION_REQUESTED',
        payload: {
          delegationId: newDelegation.id,
          registrationId: registration.id,
          mealDate: mealDate(registration.mealDate),
          counterpartName: displayNotificationName(registration.user),
        },
        dedupeKey: `delegation-requested:${data.delegateUserId}:${newDelegation.id}`,
      });

      return newDelegation;
    });

    return response(delegation);
  }

  async acceptDelegation(
    delegateUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const delegationRef = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        select: { registrationId: true },
      });
      if (!delegationRef) {
        throw new NotFoundException('Delegation not found.');
      }

      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${delegationRef.registrationId} FOR UPDATE`;
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: {
          registration: { include: { user: true } },
          delegateUser: true,
        },
      });

      if (!delegation) {
        throw new NotFoundException('Delegation not found.');
      }
      if (delegation.delegateUserId !== delegateUserId) {
        throw new ForbiddenException(
          'You are not the target delegate for this request.',
        );
      }
      if (delegation.status !== 'PENDING') {
        throw new BadRequestException(
          'Only pending delegations can be accepted.',
        );
      }

      const serving = await tx.mealServing.findUnique({
        where: { registrationId: delegation.registrationId },
      });
      if (serving) {
        throw new BadRequestException(
          'Cannot accept delegation for a meal that has already been served.',
        );
      }

      const changed = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'ACCEPTED' },
      });

      await this.notificationsService.publish(tx, {
        userId: delegation.registration.userId,
        kind: 'DELEGATION_ACCEPTED',
        payload: {
          delegationId: delegation.id,
          registrationId: delegation.registrationId,
          mealDate: mealDate(delegation.registration.mealDate),
          counterpartName: displayNotificationName(delegation.delegateUser),
        },
        dedupeKey: `delegation-accepted:${delegation.registration.userId}:${delegation.id}`,
      });

      return changed;
    });

    return response(updated);
  }

  async declineDelegation(
    delegateUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const delegationRef = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        select: { registrationId: true },
      });
      if (!delegationRef) {
        throw new NotFoundException('Delegation not found.');
      }

      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${delegationRef.registrationId} FOR UPDATE`;
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: {
          registration: { include: { user: true } },
          delegateUser: true,
        },
      });

      if (!delegation) {
        throw new NotFoundException('Delegation not found.');
      }
      if (delegation.delegateUserId !== delegateUserId) {
        throw new ForbiddenException(
          'You are not the target delegate for this request.',
        );
      }
      if (delegation.status !== 'PENDING') {
        throw new BadRequestException(
          'Only pending delegations can be declined.',
        );
      }

      const serving = await tx.mealServing.findUnique({
        where: { registrationId: delegation.registrationId },
      });
      if (serving) {
        throw new BadRequestException(
          'Cannot decline delegation for a meal that has already been served.',
        );
      }

      const changed = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'DECLINED' },
      });

      await this.notificationsService.publish(tx, {
        userId: delegation.registration.userId,
        kind: 'DELEGATION_DECLINED',
        payload: {
          delegationId: delegation.id,
          registrationId: delegation.registrationId,
          mealDate: mealDate(delegation.registration.mealDate),
          counterpartName: displayNotificationName(delegation.delegateUser),
        },
        dedupeKey: `delegation-declined:${delegation.registration.userId}:${delegation.id}`,
      });

      return changed;
    });

    return response(updated);
  }

  async revokeDelegation(
    ownerUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const delegationRef = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        select: { registrationId: true },
      });
      if (!delegationRef) {
        throw new NotFoundException('Delegation not found.');
      }

      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${delegationRef.registrationId} FOR UPDATE`;
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: {
          registration: { include: { user: true } },
          delegateUser: true,
        },
      });

      if (!delegation) {
        throw new NotFoundException('Delegation not found.');
      }
      if (delegation.registration.userId !== ownerUserId) {
        throw new ForbiddenException(
          'Only the registration owner can revoke the delegation.',
        );
      }
      if (!['PENDING', 'ACCEPTED'].includes(delegation.status)) {
        throw new BadRequestException(
          'Only pending or accepted delegations can be revoked.',
        );
      }

      const serving = await tx.mealServing.findUnique({
        where: { registrationId: delegation.registrationId },
      });
      if (serving) {
        throw new BadRequestException(
          'Cannot revoke delegation for a meal that has already been served.',
        );
      }

      const changed = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'REVOKED' },
      });

      await this.notificationsService.publish(tx, {
        userId: delegation.delegateUserId,
        kind: 'DELEGATION_REVOKED',
        payload: {
          delegationId: delegation.id,
          registrationId: delegation.registrationId,
          mealDate: mealDate(delegation.registration.mealDate),
          counterpartName: displayNotificationName(delegation.registration.user),
          reason: 'OWNER_REVOKED',
        },
        dedupeKey: `delegation-revoked:${delegation.delegateUserId}:${delegation.id}`,
      });

      return changed;
    });

    return response(updated);
  }
}
