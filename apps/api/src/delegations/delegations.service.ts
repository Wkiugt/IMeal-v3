import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { PushTransportService } from '../notifications/push-transport.service.js';
type CreateDelegationRequest = v1.CreateDelegationRequest;
type DelegationResponse = v1.DelegationResponse;

@Injectable()
export class DelegationsService {
  private prisma: PrismaClient;

  constructor(private readonly pushService: PushTransportService) {
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
      v1.DelegationResponseSchema.parse({
        id: delegation.id,
        registrationId: delegation.registrationId,
        delegateUserId: delegation.delegateUserId,
        status: delegation.status,
        createdAt: delegation.createdAt.toISOString(),
        updatedAt: delegation.updatedAt.toISOString(),
      }),
    );
  }

  async createDelegation(
    ownerUserId: string,
    data: CreateDelegationRequest,
  ): Promise<DelegationResponse> {
    if (ownerUserId === data.delegateUserId) {
      throw new BadRequestException('Cannot delegate to yourself.');
    }

    // Wrap in transaction
    const delegation = await this.prisma.$transaction(async (tx) => {
      // 1. Verify Registration and Ownership
      const registration = await tx.registration.findUnique({
        where: { id: data.registrationId },
      });

      if (!registration) {
        throw new NotFoundException('Registration not found.');
      }

      if (registration.userId !== ownerUserId) {
        throw new ForbiddenException(
          'You can only delegate your own registrations.',
        );
      }

      // 2. Service Lock check: check if meal has been served
      const serving = await tx.mealServing.findUnique({
        where: { registrationId: data.registrationId },
      });

      if (serving) {
        throw new BadRequestException(
          'Cannot delegate a meal that has already been served.',
        );
      }

      // 3. One Active Delegation Rule
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

      // 5. Create Delegation
      const newDelegation = await tx.pickupDelegation.create({
        data: {
          registrationId: data.registrationId,
          delegateUserId: data.delegateUserId,
          status: 'PENDING',
        },
      });

      // Also create a DB notification
      await tx.notification.create({
        data: {
          userId: data.delegateUserId,
          content: 'You have a new meal pickup delegation request.',
        },
      });

      return newDelegation;
    });

    // Send push notification
    await this.pushService
      .sendPushNotification(
        delegation.delegateUserId,
        'New Delegation Request',
        'You have a new meal pickup delegation request.',
      )
      .catch(console.error);

    return {
      id: delegation.id,
      registrationId: delegation.registrationId,
      delegateUserId: delegation.delegateUserId,
      status: delegation.status as any,
      createdAt: delegation.createdAt.toISOString(),
      updatedAt: delegation.updatedAt.toISOString(),
    };
  }

  async acceptDelegation(
    delegateUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const { updated, ownerId } = await this.prisma.$transaction(async (tx) => {
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: { registration: true },
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

      const updated = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'ACCEPTED' },
      });

      await tx.notification.create({
        data: {
          userId: delegation.registration.userId,
          content: 'Your meal pickup delegation was accepted.',
        },
      });

      return { updated, ownerId: delegation.registration.userId };
    });

    await this.pushService
      .sendPushNotification(
        ownerId,
        'Delegation Accepted',
        'Your meal pickup delegation was accepted.',
      )
      .catch(console.error);

    return {
      id: updated.id,
      registrationId: updated.registrationId,
      delegateUserId: updated.delegateUserId,
      status: updated.status as any,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async declineDelegation(
    delegateUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const { updated, ownerId } = await this.prisma.$transaction(async (tx) => {
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: { registration: true },
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

      const updated = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'DECLINED' },
      });

      await tx.notification.create({
        data: {
          userId: delegation.registration.userId,
          content: 'Your meal pickup delegation was declined.',
        },
      });

      return { updated, ownerId: delegation.registration.userId };
    });

    await this.pushService
      .sendPushNotification(
        ownerId,
        'Delegation Declined',
        'Your meal pickup delegation was declined.',
      )
      .catch(console.error);

    return {
      id: updated.id,
      registrationId: updated.registrationId,
      delegateUserId: updated.delegateUserId,
      status: updated.status as any,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async revokeDelegation(
    ownerUserId: string,
    delegationId: string,
  ): Promise<DelegationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const delegation = await tx.pickupDelegation.findUnique({
        where: { id: delegationId },
        include: { registration: true },
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

      const updatedDelegation = await tx.pickupDelegation.update({
        where: { id: delegationId },
        data: { status: 'REVOKED' },
      });

      await tx.notification.create({
        data: {
          userId: delegation.delegateUserId,
          content: 'A meal pickup delegation assigned to you was revoked.',
        },
      });

      return updatedDelegation;
    });

    await this.pushService
      .sendPushNotification(
        updated.delegateUserId,
        'Delegation Revoked',
        'A meal pickup delegation assigned to you was revoked.',
      )
      .catch(console.error);

    return {
      id: updated.id,
      registrationId: updated.registrationId,
      delegateUserId: updated.delegateUserId,
      status: updated.status as any,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
