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
import { NotificationsService } from '../notifications/notifications.service.js';
import { displayNotificationName } from '../notifications/notification-copy.js';
import {
  getBusinessDate,
  isWithinServingWindow,
  parseMealDate,
} from '../common/business-time.js';
import {
  LocationsService,
  type GpsVerificationResult,
  type ResolvedLocation,
} from '../locations/locations.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

const QR_TTL_SECONDS = 5;
const QR_CLOCK_SKEW_SECONDS = 2;
const PICKUP_SESSION_TTL_SECONDS = 30;
const VERIFICATION_RETENTION_DAYS = 365;

const PICKUP_AVAILABILITY_DETAILS = {
  availableFrom: '10:30',
  availableUntil: '13:30',
  timeZone: 'Asia/Ho_Chi_Minh',
} as const;

const PICKUP_WINDOW_CLOSED_MESSAGE =
  'Meal pickup is only available from 10:30 through 13:30 Vietnam time.';
const PICKUP_NOT_READY_MESSAGE =
  'Meal pickup is not currently available. Please wait for the kitchen signal.';

function pickupError(
  code: v1.PickupErrorCode,
  message: string,
  details?: Record<string, unknown>,
): BadRequestException {
  return new BadRequestException({ code, message, ...(details ? { details } : {}) });
}

function pickupForbiddenError(
  code: v1.PickupErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ForbiddenException {
  return new ForbiddenException({ code, message, ...(details ? { details } : {}) });
}

function canonicalRegistrationIds(
  registrationIds: string[] | undefined,
): string[] {
  if (!Array.isArray(registrationIds) || registrationIds.length === 0) {
    throw pickupError(
      'PICKUP_INTENT_REQUIRED',
      'Select at least one meal before presenting a QR code.',
    );
  }
  const normalized = registrationIds.map((id) => id.trim());
  if (normalized.some((id) => id.length === 0)) {
    throw pickupError(
      'PICKUP_INTENT_CONFLICT',
      'Pickup intent contains an invalid registration.',
    );
  }
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw pickupError(
      'PICKUP_INTENT_CONFLICT',
      'Pickup intent contains duplicate registrations.',
    );
  }
  return [...normalized].sort();
}

function exactRegistrationSet(
  expected: string[],
  actual: string[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((registrationId, index) => registrationId === actual[index])
  );
}

function safeDate(value: Date | string): Date {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) {
    throw pickupError('PICKUP_INTENT_CONFLICT', 'Pickup intent is invalid.');
  }
  return result;
}
function exceptionCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (!response || typeof response !== 'object' || !('code' in response)) {
    return undefined;
  }
  return response.code;
}


function toMealDateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
interface LockedRegistration {
  id: string;
  status: string;
  user_id: string;
}

interface LockedDelegation {
  id: string;
  status: string;
  registration_id: string;
  delegate_user_id: string;
}
export interface PickupSessionRecord {
  id: string;
  userId: string;
  presenterUserId?: string | null;
  mealDate?: Date | null;
  registrationIds: string[];
  intentRegistrationIds?: string[];
  intentHash?: string | null;
  intentNonce?: string | null;
  qrHash?: string;
  locationId?: string | null;
  servingVerificationId?: string | null;
  expiresAt: Date;
  createdAt: Date;
}
interface StoredPresenterEvidence {
  verification: v1.ServingVerification;
  locationPolicyId: string | null;
}

@Injectable()
export class PickupService {
  private prisma: PrismaClient;

  constructor(
    @Optional() private readonly kitchenEventsService?: KitchenEventsService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly locationsService?: LocationsService,
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

  private requireLocationsService(): LocationsService {
    if (!this.locationsService) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Pickup location verification is unavailable.',
      );
    }
    return this.locationsService;
  }

  private async loadRegistrationContexts(registrationIds: string[]) {
    const contexts = await this.prisma.registration.findMany({
      where: { id: { in: registrationIds } },
      select: {
        id: true,
        userId: true,
        status: true,
        mealDate: true,
        serviceLocationId: true,
        serviceLocationCode: true,
        serviceLocationName: true,
        serviceLocationAddress: true,
        serviceLocationEffectiveFrom: true,
        mealServing: { select: { id: true } },
      },
    });
    return contexts as Array<{
      id: string;
      userId: string;
      status: string;
      mealDate: Date;
      serviceLocationId: string | null;
      serviceLocationCode: string | null;
      serviceLocationName: string | null;
      serviceLocationAddress: string | null;
      serviceLocationEffectiveFrom: Date | null;
      mealServing: { id: string } | null;
    }>;
  }

  private async resolveIntentLocation(
    registrationIds: string[],
    at: Date,
  ) {
    const contexts = await this.loadRegistrationContexts(registrationIds);
    if (contexts.length !== registrationIds.length) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'One or more selected meals are no longer available.',
      );
    }

    const mealDate = toMealDateKey(contexts[0].mealDate);
    const locationIds = new Set<string>();
    for (const context of contexts) {
      if (
        context.status !== 'ACTIVE' ||
        context.mealServing ||
        toMealDateKey(context.mealDate) !== mealDate ||
        !context.serviceLocationId ||
        !context.serviceLocationCode
      ) {
        throw pickupError(
          'PICKUP_INTENT_CONFLICT',
          'The selected meals are no longer eligible for pickup.',
        );
      }
      locationIds.add(context.serviceLocationId);
    }
    if (locationIds.size !== 1) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Selected meals must resolve to one serving location.',
      );
    }

    const locationId = [...locationIds][0];
    let location: ResolvedLocation;
    try {
      location = await this.requireLocationsService().resolveEffectiveLocation(
        contexts[0].serviceLocationCode!,
        at,
      );
    } catch (error: unknown) {
      if (exceptionCode(error) === 'UNKNOWN_SERVICE_LOCATION') {
        throw pickupError(
          'PICKUP_INTENT_CONFLICT',
          'The selected meal location is no longer available.',
        );
      }
      throw error;
    }
    if (location.id !== locationId) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'The selected meal location is no longer effective.',
      );
    }
    return { contexts, location, mealDate };
  }

  private assertExactEligibleOptions(
    registrationIds: string[],
    options: v1.PickupOption[],
  ): v1.PickupOption[] {
    const byId = new Map(
      options.map((option) => [option.registrationId, option]),
    );
    return registrationIds.map((registrationId) => {
      const option = byId.get(registrationId);
      if (!option) {
        throw pickupError(
          'PICKUP_INTENT_CONFLICT',
          'The selected meals changed; refresh pickup options and try again.',
        );
      }
      return option;
    });
  }

  private persistPresenterVerification(
    qrHash: string,
    presenterUserId: string,
    verification: Extract<GpsVerificationResult, { result: 'VALID' }>,
    at: Date,
  ) {
    return this.prisma.servingVerification.create({
      data: {
        id: qrHash,
        presenterUserId,
        locationId: verification.locationId,
        locationPolicyId: verification.locationPolicyId,
        result: 'VALID',
        capturedAt: new Date(verification.capturedAt),
        verifiedAt: new Date(verification.verifiedAt),
        accuracyMeters: verification.accuracyMeters,
        safeVerificationCode: verification.safeVerificationCode,
        retentionUntil: new Date(
          at.getTime() + VERIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });
  }

  generateSignedQr(
    userId: string,
    registrationIds: string[],
    mealDate: string = getBusinessDate(),
    now: Date = new Date(),
  ) {
    const exactIds = canonicalRegistrationIds(registrationIds);
    const exp = Math.floor(now.getTime() / 1000) + QR_TTL_SECONDS;
    const nonce = crypto.randomBytes(16).toString('hex');
    const pickupIntent = exactIds.join(',');
    const payload = `imeal:v2:${userId}:${mealDate}:${pickupIntent}:${exp}:${nonce}`;
    const sig = crypto
      .createHmac('sha256', this.getSigningKey(userId))
      .update(payload)
      .digest('hex');
    const qr = `${payload}:${sig}`;
    return {
      qr,
      exp,
      ttl: QR_TTL_SECONDS,
      nonce,
      registrationIds: exactIds,
      mealDate,
      qrHash: crypto.createHash('sha256').update(qr).digest('hex'),
    };
  }

  async generateQr(
    userId: string,
    input: v1.GenerateQrInput,
  ) {
    await this.checkServingWindow();
    const registrationIds = canonicalRegistrationIds(input?.registrationIds);
    const evidenceResult = v1.PresenterLocationEvidenceSchema.safeParse(
      input?.presenterEvidence,
    );
    if (!evidenceResult.success) {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        { action: 'RETRY' },
      );
    }
    const presenterEvidence = evidenceResult.data;
    const options = await this.getPickupOptions(userId);
    const selectedOptions = this.assertExactEligibleOptions(
      registrationIds,
      options.options,
    );
    const now = new Date();
    const { location, mealDate } = await this.resolveIntentLocation(
      registrationIds,
      now,
    );
    const gps = await this.requireLocationsService().evaluatePresenterEvidence(
      location.id,
      presenterEvidence,
      now,
    );
    if (gps.result !== 'VALID') {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        gps.details,
      );
    }

    const signed = this.generateSignedQr(userId, registrationIds, mealDate, now);
    await this.persistPresenterVerification(
      signed.qrHash,
      userId,
      gps,
      now,
    );
    return {
      qr: signed.qr,
      exp: signed.exp,
      ttl: signed.ttl,
      registrationIds: selectedOptions.map((option) => option.registrationId),
      mealDate,
    };
  }

  private parseSignedQr(qrString: string) {
    if (!qrString || typeof qrString !== 'string') {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }
    const parts = qrString.split(':');
    if (parts.length !== 8) {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
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
      !/^[a-f0-9]{64}$/i.test(sig)
    ) {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }
    let registrationIds: string[];
    try {
      registrationIds = canonicalRegistrationIds(pickupIntent.split(','));
    } catch {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }
    if (registrationIds.join(',') !== pickupIntent) {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }

    const exp = Number(expStr);
    if (!Number.isSafeInteger(exp)) {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > exp + QR_CLOCK_SKEW_SECONDS) {
      throw pickupForbiddenError('QR_EXPIRED', 'QR code has expired.');
    }
    if (exp - nowSec > QR_TTL_SECONDS + QR_CLOCK_SKEW_SECONDS) {
      throw pickupForbiddenError('QR_INVALID', 'QR code is invalid.');
    }
    if (mealDate !== getBusinessDate()) {
      throw pickupForbiddenError(
        'PICKUP_INTENT_CONFLICT',
        'QR code is not valid for today.',
      );
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
      throw pickupForbiddenError('QR_INVALID', 'QR code is invalid.');
    }

    return {
      userId,
      mealDate,
      registrationIds,
      nonce,
      exp,
      qrHash: crypto.createHash('sha256').update(qrString).digest('hex'),
    };
  }

  async verifyQr(qrString: string) {
    const parsed = this.parseSignedQr(qrString);
    const options = await this.getPickupOptions(parsed.userId);
    const pickupOptions = this.assertExactEligibleOptions(
      parsed.registrationIds,
      options.options,
    );
    return {
      valid: true as const,
      userId: parsed.userId,
      mealDate: parsed.mealDate,
      registrationIds: parsed.registrationIds,
      nonce: parsed.nonce,
      exp: parsed.exp,
      qrHash: parsed.qrHash,
      pickupOptions,
    };
  }

  private async readStoredPresenterEvidence(
    sessionOrIntentId: string,
    at: Date,
  ): Promise<StoredPresenterEvidence> {
    const stored = await this.prisma.servingVerification.findUnique({
      where: { id: sessionOrIntentId },
    });
    if (
      !stored ||
      stored.result !== 'VALID' ||
      stored.accuracyMeters == null ||
      stored.accuracyMeters < 0
    ) {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        { action: 'REFRESH' },
      );
    }
    const capturedAt = safeDate(stored.capturedAt);
    if (capturedAt.getTime() > at.getTime()) {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        { action: 'RETRY' },
      );
    }
    return {
      locationPolicyId: stored.locationPolicyId,
      verification: v1.ServingVerificationSchema.parse({
        presenterUserId: stored.presenterUserId,
        receiverType: 'SELF',
        locationId: stored.locationId,
        gps: {
          result: 'VALID',
          capturedAt: capturedAt.toISOString(),
          accuracyMeters: stored.accuracyMeters,
        },
      }),
    };
  }

  async verifyStoredPresenterEvidence(
    sessionOrIntentId: string,
    at: Date = new Date(),
  ): Promise<v1.ServingVerification> {
    return (await this.readStoredPresenterEvidence(sessionOrIntentId, at))
      .verification;
  }

  async resolvePickup(
    input: v1.ResolvePickupInput,
    kitchenActor: AuthenticatedUser,
  ) {
    if (
      !kitchenActor ||
      kitchenActor.isActive === false ||
      !kitchenActor.permissions.includes('kitchen.serve')
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Kitchen serving permission is required.',
      });
    }
    const parsedInput = v1.ResolvePickupSchema.safeParse(input);
    if (!parsedInput.success) {
      throw pickupError('QR_INVALID', 'QR code is invalid.');
    }

    const verification = await this.verifyQr(parsedInput.data.qr);
    const now = new Date();
    const { location, mealDate } = await this.resolveIntentLocation(
      verification.registrationIds,
      now,
    );
    if (verification.mealDate !== mealDate) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'QR meal date no longer matches the selected meals.',
      );
    }
    const storedEvidenceRecord = await this.readStoredPresenterEvidence(
      verification.qrHash,
      now,
    );
    const storedEvidence = storedEvidenceRecord.verification;
    if (
      storedEvidence.presenterUserId !== verification.userId ||
      storedEvidence.locationId !== location.id ||
      storedEvidenceRecord.locationPolicyId !== location.locationPolicy.id
    ) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Pickup verification no longer matches the selected intent.',
      );
    }

    const policy = location.locationPolicy;
    const capturedAt = new Date(storedEvidence.gps.capturedAt);
    const policyUpdatedAt = safeDate(policy.updatedAt);
    if (policyUpdatedAt.getTime() > capturedAt.getTime()) {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        { action: 'REFRESH' },
      );
    }
    const ageSeconds = (now.getTime() - capturedAt.getTime()) / 1000;
    if (
      ageSeconds < 0 ||
      ageSeconds > policy.maxFixAgeSeconds ||
      storedEvidence.gps.accuracyMeters > policy.maxAccuracyMeters
    ) {
      throw pickupForbiddenError(
        'GPS_RETRY_REQUIRED',
        'A fresh presenter location is required.',
        { action: 'REFRESH' },
      );
    }
    const pickupOptions = this.assertExactEligibleOptions(
      verification.registrationIds,
      verification.pickupOptions,
    );
    const expiresAt = new Date(
      now.getTime() + PICKUP_SESSION_TTL_SECONDS * 1000,
    );
    const sessionId = crypto.randomUUID();
    const sessions = await this.prisma.$queryRaw<PickupSessionRecord[]>`
      INSERT INTO "pickup_sessions"
        (
          "id",
          "user_id",
          "presenter_user_id",
          "meal_date",
          "registration_ids",
          "intent_registration_ids",
          "intent_hash",
          "intent_nonce",
          "expires_at",
          "qr_hash",
          "location_id",
          "serving_verification_id"
        )
      VALUES
        (
          ${sessionId},
          ${verification.userId},
          ${verification.userId},
          ${parseMealDate(mealDate)},
          ${verification.registrationIds}::text[],
          ${verification.registrationIds}::text[],
          ${verification.qrHash},
          ${verification.nonce},
          ${expiresAt},
          ${verification.qrHash},
          ${location.id},
          ${verification.qrHash}
        )
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
      throw pickupForbiddenError(
        'PICKUP_INTENT_CONFLICT',
        'QR code has already been resolved.',
      );
    }

    return v1.ResolveServingResponseSchema.parse({
      session: {
        id: session.id,
        userId: session.userId,
        registrationIds: verification.registrationIds,
        expiresAt: safeDate(session.expiresAt).toISOString(),
        createdAt: safeDate(session.createdAt).toISOString(),
      },
      items: pickupOptions,
      pickupSessionToken: session.id,
      intent: {
        userId: verification.userId,
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
    body: v1.ConfirmPickupInput,
    caller: AuthenticatedUser | string,
  ) {
    const unsafeBody = body as v1.ConfirmPickupInput & {
      registrationIds?: unknown;
      pickupSessionToken?: unknown;
    };
    if (
      unsafeBody.registrationIds !== undefined ||
      unsafeBody.pickupSessionToken !== undefined
    ) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Confirmation must use the exact resolved pickup session.',
      );
    }
    const callerUserId = typeof caller === 'string' ? caller : caller.id;
    const pickupSessionId = body?.pickupSessionId;
    if (!pickupSessionId) {
      throw new BadRequestException({
        code: 'PICKUP_INTENT_REQUIRED',
        message: 'Pickup session ID is required.',
      });
    }
    const session = await this.prisma.pickupSession.findUnique({
      where: { id: pickupSessionId },
    });
    if (!session) {
      throw new BadRequestException({
        code: 'PICKUP_INTENT_CONFLICT',
        message: 'Invalid pickup session.',
      });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'PICKUP_SESSION_EXPIRED',
        message: 'Pickup session has expired',
      });
    }
    const registrationIds = canonicalRegistrationIds(session.registrationIds);
    const idempotencyKey = body.idempotencyKey;

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

    // 2. The session is immutable: confirmation can never submit a subset or expansion.
    if (!exactRegistrationSet(registrationIds, session.registrationIds)) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Pickup session intent is invalid.',
      );
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

          const delegations = await tx.$queryRaw<LockedDelegation[]>`
            SELECT id, status, registration_id, "delegate_user_id"
            FROM pickup_delegations
            WHERE registration_id IN (${Prisma.join(registrationIds)})
            ORDER BY id
            FOR UPDATE
          `;
          const acceptedDelegationsByRegistration = new Map(
            delegations
              .filter((delegation) => delegation.status === 'ACCEPTED')
              .map((delegation) => [delegation.registration_id, delegation]),
          );
          const acceptedDelegateIds = [
            ...new Set(
              delegations
                .filter((delegation) => delegation.status === 'ACCEPTED')
                .map((delegation) => delegation.delegate_user_id),
            ),
          ];
          const delegateUsers = acceptedDelegateIds.length
            ? await tx.user.findMany({
                where: { id: { in: acceptedDelegateIds } },
                select: { id: true, name: true, email: true },
              })
            : [];

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

            const registration = regs.find((item) => item.id === regId);
            const acceptedDelegation =
              acceptedDelegationsByRegistration.get(regId);
            if (
              this.notificationsService &&
              registration &&
              acceptedDelegation &&
              session.userId !== registration.user_id &&
              acceptedDelegation.delegate_user_id === session.userId
            ) {
              const delegate = delegateUsers.find(
                (user) => user.id === acceptedDelegation.delegate_user_id,
              );
              await this.notificationsService.publish(tx, {
                userId: registration.user_id,
                kind: 'PROXY_PICKUP_COMPLETED',
                payload: {
                  servingId: serving.id,
                  registrationId: regId,
                  mealDate: confirmationDateKey,
                  delegateName: displayNotificationName(delegate),
                },
                dedupeKey: `proxy-pickup-completed:${registration.user_id}:${serving.id}`,
              });
            }
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
