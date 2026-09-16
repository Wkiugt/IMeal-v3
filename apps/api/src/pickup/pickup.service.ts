import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import * as crypto from 'crypto';
import { KitchenEventsService } from '../kitchen/kitchen-events.service.js';
import {
  getBusinessDate,
  isWithinServingWindow,
  parseMealDate,
} from '../common/business-time.js';

const PICKUP_AVAILABILITY_DETAILS = {
  availableFrom: '10:30',
  availableUntil: '13:30',
  timeZone: 'Asia/Ho_Chi_Minh',
} as const;

const PICKUP_WINDOW_CLOSED_MESSAGE =
  'Meal pickup is only available from 10:30 through 13:30 Vietnam time.';
const PICKUP_NOT_READY_MESSAGE =
  'Meal pickup is not currently available. Please wait for the kitchen signal.';

function toMealDateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

interface LockedRegistration {
  id: string;
  status: string;
  user_id: string;
}
export interface PickupSessionRecord {
  id: string;
  userId: string;
  registrationIds: string[];
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class PickupService {
  private prisma: PrismaClient;

  constructor(
    @Optional() private readonly kitchenEventsService?: KitchenEventsService,
  ) {
    this.prisma = new PrismaClient();
  }

  private getTodayDate(now: Date = new Date()) {
    return parseMealDate(getBusinessDate(now));
  }

  async checkServingWindow(mealType: string = 'LUNCH', now: Date = new Date()) {
    if (!isWithinServingWindow(now)) {
      throw new ForbiddenException({
        code: 'PICKUP_WINDOW_CLOSED',
        message: PICKUP_WINDOW_CLOSED_MESSAGE,
        details: PICKUP_AVAILABILITY_DETAILS,
      });
    }

    const today = this.getTodayDate(now);
    const dateKey = getBusinessDate(now);
    const kitchenSignal = await this.prisma.appSetting.findUnique({
      where: { key: `isServingReady:${dateKey}` },
    });
    if (kitchenSignal?.value === 'true') {
      return;
    }

    const mealDay = await this.prisma.mealDay.findFirst({
      where: {
        dailyMenu: { date: today },
        mealType,
      },
    });
    if (mealDay?.isServingReady) {
      return;
    }

    throw new ForbiddenException({
      code: 'PICKUP_NOT_READY',
      message: PICKUP_NOT_READY_MESSAGE,
      details: PICKUP_AVAILABILITY_DETAILS,
    });
  }


  async getPickupOptions(userId: string): Promise<v1.PickupOptionsResponse> {
    await this.checkServingWindow();

    const today = this.getTodayDate();

    // 1. Own eligible registration
    const ownRegistration = await this.prisma.registration.findUnique({
      where: { userId_mealDate: { userId, mealDate: today } },
      select: {
        id: true,
        status: true,
        mealDate: true,
        mealChoice: true,
        mealServing: true,
      },
    });

    // 2. Accepted delegations for today
    const delegations = await this.prisma.pickupDelegation.findMany({
      where: {
        delegateUserId: userId,
        status: 'ACCEPTED',
        registration: {
          mealDate: today,
          status: 'ACTIVE',
          mealServing: null,
        },
      },
      include: {
        registration: {
          select: {
            id: true,
            mealDate: true,
            mealChoice: true,
            user: true,
          },
        },
      },
    });

    const options: v1.PickupOption[] = [];

    if (
      ownRegistration &&
      ownRegistration.status === 'ACTIVE' &&
      !ownRegistration.mealServing
    ) {
      options.push({
        type: 'OWN',
        registrationId: ownRegistration.id,
        mealDate: toMealDateKey(ownRegistration.mealDate),
        mealChoice: ownRegistration.mealChoice,
      });
    }

    for (const del of delegations) {
      options.push({
        type: 'DELEGATED',
        registrationId: del.registrationId,
        delegationId: del.id,
        mealDate: toMealDateKey(del.registration.mealDate),
        mealChoice: del.registration.mealChoice,
        owner: {
          id: del.registration.user.id,
          name:
            del.registration.user.name ||
            del.registration.user.email ||
            'N/A',
          email: del.registration.user.email,
        },
      });
    }

    return v1.PickupOptionsResponseSchema.parse({ options });
  }

  private getSigningKey(userId: string): Buffer {
    const masterSecret = process.env.QR_SIGNING_SECRET;
    if (!masterSecret) {
      throw new Error('QR_SIGNING_SECRET is required');
    }
    return crypto.createHmac('sha256', masterSecret).update(userId).digest();
  }

  generateSignedQr(userId: string, registrationIds: string[] = []) {
    const mealDate = getBusinessDate();
    const exp = Math.floor(Date.now() / 1000) + 5;
    const nonce = crypto.randomBytes(16).toString('hex');
    const intent =
      registrationIds.length > 0
        ? registrationIds.slice().sort().join(',')
        : 'all';
    const payload = `imeal:v2:${userId}:${mealDate}:${intent}:${exp}:${nonce}`;
    const sig = crypto
      .createHmac('sha256', this.getSigningKey(userId))
      .update(payload)
      .digest('hex');
    return {
      qr: `${payload}:${sig}`,
      exp,
      ttl: 5,
    };
  }

  async generateQr(userId: string, registrationIds: string[] = []) {
    await this.checkServingWindow();
    return this.generateSignedQr(userId, registrationIds);
  }

  async verifyQr(qrString: string) {
    if (!qrString) {
      throw new BadRequestException('QR string is required');
    }

    const parts = qrString.split(':');
    if (parts.length !== 8) {
      throw new BadRequestException('Invalid QR format');
    }

    const [imeal, version, userId, mealDate, pickupIntent, expStr, nonce, sig] =
      parts;
    if (
      imeal !== 'imeal' ||
      version !== 'v2' ||
      !userId ||
      !mealDate ||
      !pickupIntent ||
      !nonce ||
      !sig
    ) {
      throw new BadRequestException('Invalid QR format');
    }

    if (mealDate !== getBusinessDate()) {
      throw new ForbiddenException('QR code is not for today');
    }

    const exp = Number(expStr);
    if (!Number.isSafeInteger(exp)) {
      throw new BadRequestException('Invalid QR expiration');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > exp + 2) {
      throw new ForbiddenException('QR code has expired');
    }
    if (exp - nowSec > 7) {
      throw new ForbiddenException('Invalid QR code expiration');
    }

    const payload = `imeal:v2:${userId}:${mealDate}:${pickupIntent}:${expStr}:${nonce}`;
    const expectedSig = crypto
      .createHmac('sha256', this.getSigningKey(userId))
      .update(payload)
      .digest('hex');
    const providedSignature = Buffer.from(sig, 'hex');
    const expectedSignature = Buffer.from(expectedSig, 'hex');
    if (
      providedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(providedSignature, expectedSignature)
    ) {
      throw new ForbiddenException('Invalid QR signature');
    }

    const optionsResult = await this.getPickupOptions(userId);
    let options = optionsResult.options;
    if (pickupIntent !== 'all') {
      const allowedIds = new Set(
        pickupIntent
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      );
      options = options.filter((option) =>
        allowedIds.has(option.registrationId),
      );
    }

    return {
      valid: true,
      userId,
      qrHash: crypto.createHash('sha256').update(qrString).digest('hex'),
      pickupOptions: options,
    };
  }

  async resolvePickup(qrInput: string | { qr?: string; qrPayload?: string }) {
    const qrString =
      typeof qrInput === 'string'
        ? qrInput
        : qrInput?.qr || qrInput?.qrPayload || '';
    const verification = await this.verifyQr(qrString);
    const { userId, pickupOptions, qrHash } = verification;

    if (pickupOptions.length === 0) {
      throw new BadRequestException('No eligible pickup items found.');
    }

    const registrationIds = pickupOptions.map(
      (option) => option.registrationId,
    );
    const expiresAt = new Date(Date.now() + 30 * 1000);
    const sessionId = crypto.randomUUID();
    const sessions = await this.prisma.$queryRaw<PickupSessionRecord[]>`
      INSERT INTO "pickup_sessions"
        ("id", "user_id", "registration_ids", "expires_at", "qr_hash")
      VALUES
        (${sessionId}, ${userId}, ${registrationIds}::text[], ${expiresAt}, ${qrHash})
      ON CONFLICT ("qr_hash") DO NOTHING
      RETURNING
        "id",
        "user_id" AS "userId",
        "registration_ids" AS "registrationIds",
        "expires_at" AS "expiresAt",
        "created_at" AS "createdAt"
    `;
    const session = sessions[0];
    if (!session) {
      throw new ForbiddenException('QR code has already been used');
    }

    return v1.ResolveServingResponseSchema.parse({
      session: {
        ...session,
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
      },
      items: pickupOptions,
      pickupSessionToken: session.id,
      intent: {
        userId,
        items: pickupOptions.map((option) => ({
          id: option.registrationId,
          itemName:
            option.type === 'OWN'
              ? 'Cơm trưa (Bản thân)'
              : `Cơm trưa (${option.owner?.name || 'Ủy quyền'})`,
          quantity: 1,
          mealChoice: option.mealChoice,
        })),
        totalCount: pickupOptions.length,
        isProxy: pickupOptions.some((option) => option.type === 'DELEGATED'),
      },
    });
  }

  async confirmPickup(
    body: {
      pickupSessionId?: string;
      pickupSessionToken?: string;
      registrationIds?: string[];
      idempotencyKey?: string;
    },
    callerUserId: string,
  ) {
    const pickupSessionId = body.pickupSessionId || body.pickupSessionToken;
    if (!pickupSessionId) {
      throw new BadRequestException('Pickup session ID or token is required');
    }

    let registrationIds = body.registrationIds;
    if (!registrationIds || registrationIds.length === 0) {
      const session = await this.prisma.pickupSession.findUnique({
        where: { id: pickupSessionId },
      });
      if (!session) {
        throw new BadRequestException('Invalid pickup session');
      }
      registrationIds = session.registrationIds;
    }

    const idempotencyKey = body.idempotencyKey || `idem-${pickupSessionId}`;

    // 1. Check idempotency first (outside transaction, to avoid lock contention if already succeeded)
    const existingReq = await this.prisma.servingConfirmRequest.findUnique({
      where: {
        callerUserId_idempotencyKey: {
          callerUserId,
          idempotencyKey,
        },
      },
    });

    if (existingReq) {
      if (existingReq.status === 'SUCCESS') {
        const servings = await this.prisma.mealServing.findMany({
          where: { registrationId: { in: registrationIds } },
        });
        const sortedServings = registrationIds
          .map((id) => servings.find((s) => s.registrationId === id))
          .filter((s): s is NonNullable<typeof s> => !!s);
        return {
          success: true,
          servedCount: sortedServings.length,
          servings: sortedServings.map((s) => ({
            id: s.id,
            registrationId: s.registrationId,
            servedAt: s.servedAt,
          })),
        };
      }
      throw new BadRequestException(
        `Previous request failed with status: ${existingReq.status}`,
      );
    }

    // 2. Validate Session
    const session = await this.prisma.pickupSession.findUnique({
      where: { id: pickupSessionId },
    });

    if (!session) {
      throw new BadRequestException('Invalid pickup session');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'PICKUP_SESSION_EXPIRED',
        message: 'Pickup session has expired',
      });
    }

    for (const regId of registrationIds) {
      if (!session.registrationIds.includes(regId)) {
        throw new BadRequestException(
          `Registration ${regId} is not in this pickup session`,
        );
      }
    }

    await this.checkServingWindow();
    const confirmationTime = new Date();
    const confirmationDate = this.getTodayDate(confirmationTime);
    const confirmationDateKey = getBusinessDate(confirmationTime);

    // 3. Transaction
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const kitchenSignal = await tx.appSetting.findUnique({
            where: { key: `isServingReady:${confirmationDateKey}` },
          });
          const mealDay =
            kitchenSignal?.value === 'true'
              ? null
              : await tx.mealDay.findFirst({
                  where: {
                    dailyMenu: { date: confirmationDate },
                    mealType: 'LUNCH',
                  },
                });

          if (kitchenSignal?.value !== 'true' && !mealDay?.isServingReady) {
            throw new Error(
              'Meal pickup is not currently available. Kitchen signal is off.',
            );
          }

          // Row-level lock Registrations & PickupDelegations
          if (registrationIds.length === 0) {
            throw new Error('No registration IDs provided');
          }

          const regs = await tx.$queryRaw<LockedRegistration[]>`
            SELECT id, status, "user_id"
            FROM registrations
            WHERE id IN (${Prisma.join(registrationIds)})
            ORDER BY id
            FOR UPDATE
          `;

          if (regs.length !== registrationIds.length) {
            throw new Error('Some registrations not found');
          }

          const delegations = await tx.$queryRaw<any[]>`
            SELECT id, status
            FROM pickup_delegations
            WHERE registration_id IN (${Prisma.join(registrationIds)})
            ORDER BY id
            FOR UPDATE
          `;

          // Re-validate rules
          const existingServings = await tx.mealServing.findMany({
            where: { registrationId: { in: registrationIds } },
          });

          if (existingServings.length > 0) {
            // Check if this is a concurrent idempotency success
            const req = await tx.servingConfirmRequest.findUnique({
              where: {
                callerUserId_idempotencyKey: { callerUserId, idempotencyKey },
              },
            });
            if (req && req.status === 'SUCCESS') {
              const sortedExisting = registrationIds
                .map((id) =>
                  existingServings.find((s) => s.registrationId === id),
                )
                .filter((s): s is NonNullable<typeof s> => !!s);
              return sortedExisting;
            }
            throw new Error('One or more meals have already been served');
          }

          for (const r of regs) {
            if (r.status !== 'ACTIVE') {
              throw new Error(`Registration ${r.id} is not ACTIVE`);
            }
          }

          // Insert ServingConfirmRequest
          await tx.servingConfirmRequest.create({
            data: {
              callerUserId,
              idempotencyKey,
              status: 'SUCCESS',
            },
          });

          // Update PickupDelegation status (if any were ACCEPTED)
          if (delegations.length > 0) {
            const acceptedDelegationIds = delegations
              .filter((d) => d.status === 'ACCEPTED')
              .map((d) => d.id);

            if (acceptedDelegationIds.length > 0) {
              await tx.pickupDelegation.updateMany({
                where: { id: { in: acceptedDelegationIds } },
                data: { status: 'COMPLETED' },
              });
            }
          }

          // Insert MealServing and MealEvent
          const servings = [];
          for (const regId of registrationIds) {
            const serving = await tx.mealServing.create({
              data: {
                registrationId: regId,
              },
            });
            servings.push(serving);

            await tx.mealEvent.create({
              data: {
                mealServingId: serving.id,
                eventType: 'PICKUP_CONFIRMED',
              },
            });
          }

          // Close PickupSession (set expiresAt to now)
          await tx.pickupSession.update({
            where: { id: pickupSessionId },
            data: { expiresAt: new Date() },
          });

          return servings;
        },
        { isolationLevel: 'ReadCommitted' },
      );

      // Emit realtime serving event to Kitchen Dashboard
      if (this.kitchenEventsService) {
        this.kitchenEventsService.emitEvent({
          eventType: 'SERVING_CONFIRMED',
          mealDate: this.getTodayDate().toISOString().split('T')[0],
          payload: {
            servedCount: result.length,
            servings: result.map((s) => ({
              id: s.id,
              registrationId: s.registrationId,
              servedAt: s.servedAt,
            })),
          },
        });
      }

      return {
        success: true,
        servedCount: result.length,
        servings: result.map((s) => ({
          id: s.id,
          registrationId: s.registrationId,
          servedAt: s.servedAt,
        })),
      };
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Transaction failed',
      );
    }
  }
}
