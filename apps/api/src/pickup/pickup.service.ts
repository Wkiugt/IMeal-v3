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

function hasCompleteRegistrationSnapshot(registration: {
  ownerNameSnapshot: string | null;
  employeeCodeSnapshot: string | null;
  serviceLocationId: string | null;
  serviceLocationAssignmentId: string | null;
  serviceLocationCode: string | null;
  serviceLocationName: string | null;
  serviceLocationAddress: string | null;
  serviceLocationEffectiveFrom: Date | null;
  serviceLocationSnapshotAt: Date | null;
  menuRevisionId: string | null;
  menuNameSnapshot: string | null;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
}): boolean {
  return (
    typeof registration.ownerNameSnapshot === 'string' &&
    registration.ownerNameSnapshot.trim().length > 0 &&
    typeof registration.employeeCodeSnapshot === 'string' &&
    registration.employeeCodeSnapshot.trim().length > 0 &&
    typeof registration.serviceLocationId === 'string' &&
    registration.serviceLocationId.trim().length > 0 &&
    typeof registration.serviceLocationAssignmentId === 'string' &&
    registration.serviceLocationAssignmentId.trim().length > 0 &&
    typeof registration.serviceLocationCode === 'string' &&
    registration.serviceLocationCode.trim().length > 0 &&
    typeof registration.serviceLocationName === 'string' &&
    registration.serviceLocationName.trim().length > 0 &&
    typeof registration.serviceLocationAddress === 'string' &&
    registration.serviceLocationAddress.trim().length > 0 &&
    registration.serviceLocationEffectiveFrom instanceof Date &&
    Number.isFinite(registration.serviceLocationEffectiveFrom.getTime()) &&
    registration.serviceLocationSnapshotAt instanceof Date &&
    Number.isFinite(registration.serviceLocationSnapshotAt.getTime()) &&
    typeof registration.menuRevisionId === 'string' &&
    registration.menuRevisionId.trim().length > 0 &&
    typeof registration.menuNameSnapshot === 'string' &&
    registration.menuNameSnapshot.trim().length > 0
  );
}

interface MenuRevisionSnapshot {
  id: string;
  mealName: string | null;
  description: string | null;
  imageUrl: string | null;
}

function hasMatchingMenuSnapshot(
  registration: Parameters<typeof hasCompleteRegistrationSnapshot>[0],
  revision: MenuRevisionSnapshot | null,
): boolean {
  return (
    hasCompleteRegistrationSnapshot(registration) &&
    revision !== null &&
    registration.menuRevisionId === revision.id &&
    registration.menuNameSnapshot === revision.mealName &&
    registration.menuDescriptionSnapshot === revision.description &&
    registration.menuImageSnapshot === revision.imageUrl
  );
}

interface LockedRegistration {
  id: string;
  status: string;
  userId: string;
  mealDate: Date;
  mealChoice: string;
  ownerNameSnapshot: string | null;
  employeeCodeSnapshot: string | null;
  menuRevisionId: string | null;
  menuNameSnapshot: string | null;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
  immutableMenuRevisionId: string | null;
  immutableMenuName: string | null;
  immutableMenuDescription: string | null;
  immutableMenuImage: string | null;
  serviceLocationId: string | null;
  serviceLocationAssignmentId: string | null;
  serviceLocationCode: string | null;
  serviceLocationName: string | null;
  serviceLocationAddress: string | null;
  serviceLocationEffectiveFrom: Date | null;
  serviceLocationSnapshotAt: Date | null;
  mealServingId: string | null;
}

interface LockedDelegation {
  id: string;
  status: string;
  registrationId: string;
  delegateUserId: string;
}

interface LockedAccount {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  hasKitchenServe: boolean;
}

interface LockedPickupSession extends PickupSessionRecord {
  presenterUserId: string | null;
  mealDate: Date | null;
  registrationIds: string[];
  intentRegistrationIds: string[];
  intentHash: string | null;
  intentNonce: string | null;
  locationId: string | null;
  servingVerificationId: string | null;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

interface ServingConfirmRequestRow {
  id: string;
  callerUserId: string;
  idempotencyKey: string;
  status: string;
  requestBodyHash: string | null;
  intentHash: string | null;
  pickupSessionId: string | null;
  resultSnapshot: unknown;
}

interface ConfirmServingSummary {
  id: string;
  registrationId: string;
  servedAt: string;
}

export interface ConfirmPickupResult {
  success: true;
  servedCount: number;
  servings: ConfirmServingSummary[];
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalConfirmBody(body: v1.ConfirmPickupInput): string {
  return JSON.stringify({ pickupSessionId: body.pickupSessionId });
}

function asConfirmResult(value: unknown): ConfirmPickupResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ConfirmPickupResult>;
  const servedCount = candidate.servedCount;
  if (
    candidate.success !== true ||
    typeof servedCount !== 'number' ||
    !Number.isInteger(servedCount) ||
    !Array.isArray(candidate.servings)
  ) {
    return null;
  }
  const servings = candidate.servings.filter(
    (serving): serving is ConfirmServingSummary =>
      !!serving &&
      typeof serving === 'object' &&
      typeof serving.id === 'string' &&
      typeof serving.registrationId === 'string' &&
      typeof serving.servedAt === 'string',
  );
  if (servings.length !== candidate.servings.length) return null;
  return {
    success: true,
    servedCount,
    servings,
  };
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
    const registrationSnapshotSelect = {
      ownerNameSnapshot: true,
      employeeCodeSnapshot: true,
      serviceLocationId: true,
      serviceLocationAssignmentId: true,
      serviceLocationCode: true,
      serviceLocationName: true,
      serviceLocationAddress: true,
      serviceLocationEffectiveFrom: true,
      serviceLocationSnapshotAt: true,
      menuRevisionId: true,
      menuNameSnapshot: true,
      menuDescriptionSnapshot: true,
      menuImageSnapshot: true,
      menuRevision: {
        select: {
          id: true,
          mealName: true,
          description: true,
          imageUrl: true,
        },
      },
    } as const;

    // 1. Own eligible registration
    const ownRegistration = await this.prisma.registration.findUnique({
      where: { userId_mealDate: { userId, mealDate: today } },
      select: {
        id: true,
        status: true,
        mealDate: true,
        mealChoice: true,
        mealServing: true,
        ...registrationSnapshotSelect,
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
            status: true,
            mealDate: true,
            mealChoice: true,
            mealServing: true,
            user: { select: { id: true, email: true } },
            ...registrationSnapshotSelect,
          },
        },
      },
    });

    const options: v1.PickupOption[] = [];

    if (
      ownRegistration &&
      ownRegistration.status === 'ACTIVE' &&
      !ownRegistration.mealServing &&
      hasCompleteRegistrationSnapshot(ownRegistration) &&
      hasMatchingMenuSnapshot(ownRegistration, ownRegistration.menuRevision)
    ) {
      options.push({
        type: 'OWN',
        registrationId: ownRegistration.id,
        mealDate: toMealDateKey(ownRegistration.mealDate),
        mealChoice: ownRegistration.mealChoice,
      });
    }

    for (const del of delegations) {
      const registration = del.registration;
      if (
        !registration ||
        registration.status !== 'ACTIVE' ||
        registration.mealServing ||
        !hasCompleteRegistrationSnapshot(registration) ||
        !hasMatchingMenuSnapshot(registration, registration.menuRevision)
      ) {
        continue;
      }
      options.push({
        type: 'DELEGATED',
        registrationId: del.registrationId,
        delegationId: del.id,
        mealDate: toMealDateKey(registration.mealDate),
        mealChoice: registration.mealChoice,
        owner: {
          id: registration.user.id,
          name: registration.ownerNameSnapshot!,
          email: registration.user.email,
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
        ownerNameSnapshot: true,
        employeeCodeSnapshot: true,
        menuRevisionId: true,
        menuNameSnapshot: true,
        menuDescriptionSnapshot: true,
        menuImageSnapshot: true,
        menuRevision: {
          select: {
            id: true,
            mealName: true,
            description: true,
            imageUrl: true,
          },
        },
        serviceLocationId: true,
        serviceLocationAssignmentId: true,
        serviceLocationCode: true,
        serviceLocationName: true,
        serviceLocationAddress: true,
        serviceLocationEffectiveFrom: true,
        serviceLocationSnapshotAt: true,
        mealServing: { select: { id: true } },
      },
    });
    return contexts as Array<{
      id: string;
      userId: string;
      status: string;
      mealDate: Date;
      ownerNameSnapshot: string | null;
      employeeCodeSnapshot: string | null;
      menuRevisionId: string | null;
      menuNameSnapshot: string | null;
      menuDescriptionSnapshot: string | null;
      menuImageSnapshot: string | null;
      menuRevision: MenuRevisionSnapshot | null;
      serviceLocationId: string | null;
      serviceLocationAssignmentId: string | null;
      serviceLocationCode: string | null;
      serviceLocationName: string | null;
      serviceLocationAddress: string | null;
      serviceLocationEffectiveFrom: Date | null;
      serviceLocationSnapshotAt: Date | null;
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
      const completeSnapshot =
        hasCompleteRegistrationSnapshot(context) &&
        hasMatchingMenuSnapshot(context, context.menuRevision);
      if (
        context.status !== 'ACTIVE' ||
        context.mealServing ||
        toMealDateKey(context.mealDate) !== mealDate ||
        !context.serviceLocationId ||
        !completeSnapshot
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
    intentNonce: string,
    presenterUserId: string,
    verification: Extract<GpsVerificationResult, { result: 'VALID' }>,
    at: Date,
  ) {
    return this.prisma.servingVerification.create({
      data: {
        id: qrHash,
        intentNonce,
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
      signed.nonce,
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
  private async assertServingReadyInTransaction(
    tx: Prisma.TransactionClient,
    mealDateKey: string,
    at: Date,
  ): Promise<{
    currentMenuRevisionId: string;
    serviceStartAt: Date;
    serviceEndAt: Date;
  }> {
    if (!isWithinServingWindow(at)) {
      throw new ForbiddenException({
        code: 'PICKUP_WINDOW_CLOSED',
        message: PICKUP_WINDOW_CLOSED_MESSAGE,
        details: PICKUP_AVAILABILITY_DETAILS,
      });
    }
    if (getBusinessDate(at) !== mealDateKey) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'Pickup session is not for the current serving date.',
      );
    }
    const kitchenSignal = await tx.appSetting.findUnique({
      where: { key: `isServingReady:${mealDateKey}` },
    });
    const mealDay = await tx.mealDay.findFirst({
      where: {
        dailyMenu: { date: parseMealDate(mealDateKey) },
        mealType: 'LUNCH',
      },
      include: {
        dailyMenu: {
          include: {
            revisions: {
              where: { revision: { not: null } },
              orderBy: [{ revision: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    const currentMenu = mealDay?.dailyMenu;
    const currentMenuRevisionId = currentMenu?.revisions?.[0]?.id ?? null;
    const serviceStartAt = mealDay?.serviceStartAt ?? null;
    const serviceEndAt = mealDay?.serviceEndAt ?? null;
    if (
      !mealDay ||
      !currentMenu ||
      !currentMenu.isEnabled ||
      !currentMenuRevisionId ||
      !(serviceStartAt instanceof Date) ||
      !Number.isFinite(serviceStartAt.getTime()) ||
      !(serviceEndAt instanceof Date) ||
      !Number.isFinite(serviceEndAt.getTime())
    ) {
      throw pickupError(
        'PICKUP_INTENT_CONFLICT',
        'The serving menu is no longer available.',
      );
    }
    if (kitchenSignal?.value !== 'true' && !mealDay.isServingReady) {
      throw new ForbiddenException({
        code: 'PICKUP_NOT_READY',
        message: PICKUP_NOT_READY_MESSAGE,
        details: PICKUP_AVAILABILITY_DETAILS,
      });
    }
    return {
      currentMenuRevisionId,
      serviceStartAt,
      serviceEndAt,
    };
  }


  async confirmPickup(
    body: v1.ConfirmPickupInput,
    kitchenActor: AuthenticatedUser,
  ): Promise<ConfirmPickupResult> {
    const unsafeBody = (body ?? {}) as v1.ConfirmPickupInput & {
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
    const parsedBody = v1.ConfirmPickupSchema.safeParse(body);
    if (!parsedBody.success) {
      throw pickupError(
        'PICKUP_INTENT_REQUIRED',
        'Pickup session and idempotency key are required.',
      );
    }
    if (
      !kitchenActor ||
      kitchenActor.isActive === false ||
      !kitchenActor.id ||
      kitchenActor.id !== kitchenActor.userId ||
      !kitchenActor.permissions.includes('kitchen.serve')
    ) {
      throw pickupForbiddenError(
        'SESSION_REVOKED',
        'An active Kitchen serving session is required.',
      );
    }

    const input = parsedBody.data;
    const callerUserId = kitchenActor.id;
    const pickupSessionId = input.pickupSessionId;
    const idempotencyKey = input.idempotencyKey;
    const requestBodyHash = sha256(canonicalConfirmBody(input));
    const requestId = crypto.randomUUID();
    let confirmationTime: Date;


    const transactionResult = await this.prisma.$transaction(
      async (tx) => {
        const insertedRequests =
          (await tx.$queryRaw<ServingConfirmRequestRow[]>`
            INSERT INTO "serving_confirm_requests"
              (
                "id",
                "caller_user_id",
                "idempotency_key",
                "status",
                "request_body_hash",
                "pickup_session_id"
              )
            VALUES
              (
                ${requestId},
                ${callerUserId},
                ${idempotencyKey},
                'PROCESSING',
                ${requestBodyHash},
                ${pickupSessionId}
              )
            ON CONFLICT ("caller_user_id", "idempotency_key") DO NOTHING
            RETURNING
              "id",
              "caller_user_id" AS "callerUserId",
              "idempotency_key" AS "idempotencyKey",
              "status",
              "request_body_hash" AS "requestBodyHash",
              "intent_hash" AS "intentHash",
              "pickup_session_id" AS "pickupSessionId",
              "result_snapshot" AS "resultSnapshot"
          `) ?? [];
        let confirmRequest = insertedRequests[0];
        let isNewRequest = !!confirmRequest;

        if (!confirmRequest) {
          const existingRequests =
            (await tx.$queryRaw<ServingConfirmRequestRow[]>`
              SELECT
                "id",
                "caller_user_id" AS "callerUserId",
                "idempotency_key" AS "idempotencyKey",
                "status",
                "request_body_hash" AS "requestBodyHash",
                "intent_hash" AS "intentHash",
                "pickup_session_id" AS "pickupSessionId",
                "result_snapshot" AS "resultSnapshot"
              FROM "serving_confirm_requests"
              WHERE
                "caller_user_id" = ${callerUserId}
                AND "idempotency_key" = ${idempotencyKey}
              FOR UPDATE
            `) ?? [];
          confirmRequest = existingRequests[0];
        }

        if (!confirmRequest) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'The confirmation request could not be established.',
          );
        }
        if (
          !isNewRequest &&
          (confirmRequest.requestBodyHash !== requestBodyHash ||
            confirmRequest.pickupSessionId !== pickupSessionId)
        ) {
          throw pickupError(
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key was already used for a different request.',
          );
        }
        if (!isNewRequest) {
          if (confirmRequest.status !== 'SUCCESS') {
            throw pickupError(
              'IDEMPOTENCY_CONFLICT',
              'The idempotency key is already being processed.',
            );
          }
          const originalResult = asConfirmResult(confirmRequest.resultSnapshot);
          if (!originalResult) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'The original confirmation result is unavailable.',
            );
          }
          return {
            response: originalResult,
            isNewRequest: false,
            mealDate: originalResult.servings[0]?.servedAt.slice(0, 10) ?? '',
            requestId: confirmRequest.id,
          };
        }
        confirmationTime = new Date();


        const lockedSessions =
          (await tx.$queryRaw<LockedPickupSession[]>`
            SELECT
              "id",
              "user_id" AS "userId",
              "presenter_user_id" AS "presenterUserId",
              "meal_date" AS "mealDate",
              "registration_ids" AS "registrationIds",
              "intent_registration_ids" AS "intentRegistrationIds",
              "intent_hash" AS "intentHash",
              "intent_nonce" AS "intentNonce",
              "qr_hash" AS "qrHash",
              "location_id" AS "locationId",
              "serving_verification_id" AS "servingVerificationId",
              "expires_at" AS "expiresAt",
              "consumed_at" AS "consumedAt",
              "created_at" AS "createdAt"
            FROM "pickup_sessions"
            WHERE "id" = ${pickupSessionId}
            FOR UPDATE
          `) ?? [];
        const session = lockedSessions[0];
        if (!session) {
          throw pickupError('PICKUP_INTENT_CONFLICT', 'Invalid pickup session.');
        }
        if (
          session.consumedAt ||
          session.expiresAt.getTime() <= confirmationTime.getTime()
        ) {
          throw pickupError(
            'PICKUP_SESSION_EXPIRED',
            session.consumedAt
              ? 'Pickup session has already been consumed.'
              : 'Pickup session has expired',
          );
        }
        if (
          !session.presenterUserId ||
          session.presenterUserId !== session.userId ||
          !session.mealDate ||
          !session.intentHash ||
          !session.intentNonce ||
          !session.qrHash ||
          session.intentHash !== session.qrHash ||
          !session.locationId ||
          !session.servingVerificationId ||
          session.servingVerificationId !== session.qrHash
        ) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'Pickup session intent is invalid.',
          );
        }

        let registrationIds: string[];
        let intentRegistrationIds: string[];
        try {
          registrationIds = canonicalRegistrationIds(session.registrationIds);
          intentRegistrationIds = canonicalRegistrationIds(
            session.intentRegistrationIds,
          );
        } catch {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'Pickup session intent is invalid.',
          );
        }
        if (!exactRegistrationSet(registrationIds, session.registrationIds)) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'Pickup session registration order is invalid.',
          );
        }
        if (!exactRegistrationSet(registrationIds, intentRegistrationIds)) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'Pickup session intent does not match its registration set.',
          );
        }

        const registrations =
          (await tx.$queryRaw<LockedRegistration[]>`
            SELECT
              r."id",
              r."status",
              r."user_id" AS "userId",
              r."meal_date" AS "mealDate",
              r."meal_choice" AS "mealChoice",
              r."owner_name_snapshot" AS "ownerNameSnapshot",
              r."employee_code_snapshot" AS "employeeCodeSnapshot",
              r."menu_revision_id" AS "menuRevisionId",
              r."menu_name_snapshot" AS "menuNameSnapshot",
              r."menu_description_snapshot" AS "menuDescriptionSnapshot",
              r."menu_image_snapshot" AS "menuImageSnapshot",
              mr."id" AS "immutableMenuRevisionId",
              mr."meal_name" AS "immutableMenuName",
              mr."description" AS "immutableMenuDescription",
              mr."image_url" AS "immutableMenuImage",
              r."service_location_id" AS "serviceLocationId",
              r."service_location_assignment_id" AS "serviceLocationAssignmentId",
              r."service_location_code" AS "serviceLocationCode",
              r."service_location_name" AS "serviceLocationName",
              r."service_location_address" AS "serviceLocationAddress",
              r."service_location_effective_from" AS "serviceLocationEffectiveFrom",
              r."service_location_snapshot_at" AS "serviceLocationSnapshotAt",
              ms."id" AS "mealServingId"
            FROM "registrations" r
            LEFT JOIN "daily_menu_revisions" mr
              ON mr."id" = r."menu_revision_id"
            LEFT JOIN "meal_servings" ms
              ON ms."registration_id" = r."id"
            WHERE r."id" IN (${Prisma.join(registrationIds)})
            ORDER BY r."id"
            FOR UPDATE OF r
          `) ?? [];
        if (
          registrations.length !== registrationIds.length ||
          !registrationIds.every(
            (registrationId, index) =>
              registrations[index]?.id === registrationId,
          )
        ) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'One or more selected meals are no longer available.',
          );
        }

        const mealDateKey = toMealDateKey(session.mealDate);
        const servingReadiness =
          await this.assertServingReadyInTransaction(
            tx,
            mealDateKey,
            confirmationTime,
          );
        const delegations =
          (await tx.$queryRaw<LockedDelegation[]>`
            SELECT
              d."id",
              d."status",
              d."registration_id" AS "registrationId",
              d."delegate_user_id" AS "delegateUserId"
            FROM "pickup_delegations" d
            WHERE d."registration_id" IN (${Prisma.join(registrationIds)})
            ORDER BY d."id"
            FOR UPDATE OF d
          `) ?? [];
        const acceptedByRegistration = new Map<string, LockedDelegation>();
        for (const delegation of delegations) {
          if (delegation.status !== 'ACCEPTED') continue;
          if (acceptedByRegistration.has(delegation.registrationId)) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'The selected meal has conflicting accepted delegations.',
            );
          }
          acceptedByRegistration.set(delegation.registrationId, delegation);
        }

        const accountIds = [
          ...new Set([
            callerUserId,
            session.userId,
            session.presenterUserId,
            ...registrations.map((registration) => registration.userId),
            ...delegations.map((delegation) => delegation.delegateUserId),
          ]),
        ].sort();
        const accounts =
          (await tx.$queryRaw<LockedAccount[]>`
            SELECT
              u."id",
              u."email",
              u."name",
              u."is_active" AS "isActive",
              (
                EXISTS (
                  SELECT 1
                  FROM "user_permissions" up
                  JOIN "permissions" p ON p."id" = up."permission_id"
                  WHERE up."user_id" = u."id"
                    AND p."name" = 'kitchen.serve'
                )
                OR EXISTS (
                  SELECT 1
                  FROM "user_roles" ur
                  JOIN "roles" r ON r."id" = ur."role_id"
                  JOIN "role_permissions" rp ON rp."role_id" = r."id"
                  JOIN "permissions" p ON p."id" = rp."permission_id"
                  WHERE ur."user_id" = u."id"
                    AND p."name" = 'kitchen.serve'
                )
              ) AS "hasKitchenServe"
            FROM "users" u
            WHERE u."id" IN (${Prisma.join(accountIds)})
            ORDER BY u."id"
            FOR UPDATE
          `) ?? [];
        if (accounts.length !== accountIds.length) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'A serving participant is no longer available.',
          );
        }
        const accountById = new Map(accounts.map((account) => [account.id, account]));
        const kitchenAccount = accountById.get(callerUserId);
        const presenterAccount = accountById.get(session.presenterUserId);
        if (
          !kitchenAccount?.isActive ||
          !kitchenAccount.hasKitchenServe ||
          !presenterAccount?.isActive
        ) {
          throw pickupForbiddenError(
            'SESSION_REVOKED',
            'An active serving participant is required.',
          );
        }

        const registrationLocationIds = new Set<string>();
        for (const registration of registrations) {
          const completeSnapshot =
            hasCompleteRegistrationSnapshot(registration) &&
            hasMatchingMenuSnapshot(registration, {
              id: registration.immutableMenuRevisionId ?? '',
              mealName: registration.immutableMenuName,
              description: registration.immutableMenuDescription,
              imageUrl: registration.immutableMenuImage,
            });
          if (
            registration.status !== 'ACTIVE' ||
            registration.mealServingId ||
            toMealDateKey(registration.mealDate) !== mealDateKey ||
            !registration.serviceLocationId ||
            !registration.serviceLocationCode ||
            !completeSnapshot ||
            registration.menuRevisionId !==
              servingReadiness.currentMenuRevisionId
          ) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'One or more selected meals are no longer eligible for pickup.',
            );
          }
          const owner = accountById.get(registration.userId);
          if (!owner?.isActive) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'One or more meal owners are no longer active.',
            );
          }
          registrationLocationIds.add(registration.serviceLocationId);
        }
        if (
          registrationLocationIds.size !== 1 ||
          !registrationLocationIds.has(session.locationId)
        ) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'The serving location no longer matches the resolved session.',
          );
        }

        const verification = await tx.servingVerification.findUnique({
          where: { id: session.servingVerificationId },
          select: {
            id: true,
            intentNonce: true,
            presenterUserId: true,
            locationId: true,
            locationPolicyId: true,
            result: true,
            capturedAt: true,
            accuracyMeters: true,
            safeVerificationCode: true,
            retentionUntil: true,
          },
        });
        const location = await tx.location.findUnique({
          where: { id: session.locationId },
          select: {
            id: true,
            shortCode: true,
            displayName: true,
            address: true,
            isActive: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        });
        const policy = await tx.locationPolicy.findFirst({
          where: {
            locationId: session.locationId,
            isActive: true,
            effectiveFrom: { lte: confirmationTime },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: confirmationTime } },
            ],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (
          !verification ||
          verification.id !== session.qrHash ||
          verification.intentNonce !== session.intentNonce ||
          verification.result !== 'VALID' ||
          verification.presenterUserId !== session.presenterUserId ||
          verification.locationId !== session.locationId ||
          !verification.locationPolicyId ||
          !policy ||
          verification.locationPolicyId !== policy.id ||
          !location ||
          !location.isActive ||
          location.effectiveFrom > confirmationTime ||
          (location.effectiveTo && location.effectiveTo <= confirmationTime)
        ) {
          throw pickupError(
            'PICKUP_INTENT_CONFLICT',
            'Pickup verification no longer matches the selected intent.',
          );
        }
        const capturedAt = safeDate(verification.capturedAt);
        if (
          capturedAt.getTime() > confirmationTime.getTime() ||
          (verification.retentionUntil &&
            verification.retentionUntil <= confirmationTime) ||
          verification.accuracyMeters == null ||
          !Number.isFinite(verification.accuracyMeters) ||
          verification.accuracyMeters < 0
        ) {
          throw pickupForbiddenError(
            'GPS_RETRY_REQUIRED',
            'A fresh presenter location is required.',
            { action: 'REFRESH' },
          );
        }
        if (safeDate(policy.updatedAt).getTime() > capturedAt.getTime()) {
          throw pickupForbiddenError(
            'GPS_RETRY_REQUIRED',
            'A fresh presenter location is required.',
            { action: 'REFRESH' },
          );
        }
        const evidenceAgeSeconds =
          (confirmationTime.getTime() - capturedAt.getTime()) / 1000;
        if (
          evidenceAgeSeconds > policy.maxFixAgeSeconds ||
          verification.accuracyMeters > policy.maxAccuracyMeters
        ) {
          throw pickupForbiddenError(
            'GPS_RETRY_REQUIRED',
            'A fresh presenter location is required.',
            { action: 'REFRESH' },
          );
        }

        const servingPlans = registrations.map((registration) => {
          const acceptedDelegation = acceptedByRegistration.get(registration.id);
          const receiverType =
            registration.userId === session.presenterUserId
              ? ('SELF' as const)
              : acceptedDelegation?.delegateUserId === session.presenterUserId
                ? ('PROXY' as const)
                : null;
          if (!receiverType) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'The presenter is no longer authorized for every selected meal.',
            );
          }
          return { registration, acceptedDelegation, receiverType };
        });

        const delegationsToComplete: LockedDelegation[] = [];
        for (const plan of servingPlans) {
          if (plan.receiverType === 'PROXY' && plan.acceptedDelegation) {
            delegationsToComplete.push(plan.acceptedDelegation);
          }
        }
        delegationsToComplete.sort((left, right) =>
          left.id.localeCompare(right.id),
        );
        for (const delegation of delegationsToComplete) {
          const changed = await tx.pickupDelegation.updateMany({
            where: { id: delegation.id, status: 'ACCEPTED' },
            data: { status: 'COMPLETED' },
          });
          if (changed.count !== 1) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'A delegation changed before serving could be committed.',
            );
          }
        }

        const servingSummaries: ConfirmServingSummary[] = [];
        for (const plan of servingPlans) {
          const owner = accountById.get(plan.registration.userId);
          if (!owner) {
            throw pickupError(
              'PICKUP_INTENT_CONFLICT',
              'The meal owner is no longer available.',
            );
          }
          const servedAt = confirmationTime.toISOString();
          const serving = await tx.mealServing.create({
            data: {
              registrationId: plan.registration.id,
              ownerUserId: plan.registration.userId,
              ownerEmailSnapshot: owner.email,
              ownerNameSnapshot: plan.registration.ownerNameSnapshot!,
              presenterUserId: session.presenterUserId,
              receiverType: plan.receiverType,
              kitchenUserId: callerUserId,
              kitchenPermissionContext: 'kitchen.serve',
              scannerDeviceId: null,
              locationId: plan.registration.serviceLocationId!,
              locationShortCode: plan.registration.serviceLocationCode!,
              locationNameSnapshot: plan.registration.serviceLocationName!,
              locationAddressSnapshot:
                plan.registration.serviceLocationAddress!,
              mealDate: parseMealDate(mealDateKey),
              menuRevisionId: plan.registration.menuRevisionId!,
              menuNameSnapshot: plan.registration.menuNameSnapshot!,
              menuDescriptionSnapshot: plan.registration.menuDescriptionSnapshot,
              menuImageSnapshot: plan.registration.menuImageSnapshot,
              requestId,
              pickupSessionId,
              intentHash: session.intentHash,
              verificationOutcome: verification.safeVerificationCode,
              servingVerificationId: verification.id,
              delegationId:
                plan.receiverType === 'PROXY'
                  ? plan.acceptedDelegation?.id ?? null
                  : null,
              servedAt: confirmationTime,
            },
          });
          await tx.mealEvent.create({
            data: {
              mealServingId: serving.id,
              eventType: 'PICKUP_CONFIRMED',
            },
          });
          await tx.auditLog.create({
            data: {
              userId: callerUserId,
              action: 'SERVING_CONFIRMED',
              details: JSON.stringify({
                requestId,
                registrationId: plan.registration.id,
                owner: {
                  id: owner.id,
                  email: owner.email,
                  name: plan.registration.ownerNameSnapshot,
                },
                presenter: {
                  id: session.presenterUserId,
                  email: accountById.get(session.presenterUserId)?.email ?? null,
                  name: accountById.get(session.presenterUserId)?.name ?? null,
                },
                receiverType: plan.receiverType,
                kitchen: {
                  id: callerUserId,
                  email: kitchenAccount.email,
                  name: kitchenAccount.name,
                  permissionContext: 'kitchen.serve',
                },
                location: {
                  id: plan.registration.serviceLocationId,
                  shortCode: plan.registration.serviceLocationCode,
                  name: plan.registration.serviceLocationName,
                  address: plan.registration.serviceLocationAddress,
                },
                delegationId:
                  plan.receiverType === 'PROXY'
                    ? plan.acceptedDelegation?.id ?? null
                    : null,
                pickupSessionId,
                intentHash: session.intentHash,
                mealDate: mealDateKey,
                mealChoice: plan.registration.mealChoice,
                menuRevisionId: plan.registration.menuRevisionId,
                menuNameSnapshot: plan.registration.menuNameSnapshot,
                menuDescriptionSnapshot:
                  plan.registration.menuDescriptionSnapshot,
                menuImageSnapshot: plan.registration.menuImageSnapshot,
                verification: {
                  id: verification.id,
                  result: verification.result,
                  safeVerificationCode: verification.safeVerificationCode,
                  capturedAt: capturedAt.toISOString(),
                  accuracyMeters: verification.accuracyMeters,
                },
                servedAt,
              }),
            },
          });

          if (
            this.notificationsService &&
            plan.receiverType === 'PROXY' &&
            plan.acceptedDelegation
          ) {
            await this.notificationsService.publish(tx, {
              userId: plan.registration.userId,
              kind: 'PROXY_PICKUP_COMPLETED',
              payload: {
                servingId: serving.id,
                registrationId: plan.registration.id,
                mealDate: mealDateKey,
                delegateName: displayNotificationName(
                  accountById.get(session.presenterUserId),
                ),
              },
              dedupeKey: `proxy-pickup-completed:${plan.registration.userId}:${serving.id}`,
            });
          }
          servingSummaries.push({
            id: serving.id,
            registrationId: serving.registrationId,
            servedAt:
              serving.servedAt instanceof Date
                ? serving.servedAt.toISOString()
                : servedAt,
          });
        }

        const response: ConfirmPickupResult = {
          success: true,
          servedCount: servingSummaries.length,
          servings: servingSummaries,
        };
        await tx.pickupSession.update({
          where: { id: pickupSessionId },
          data: { consumedAt: confirmationTime, expiresAt: confirmationTime },
        });
        await tx.servingConfirmRequest.update({
          where: { id: confirmRequest.id },
          data: {
            status: 'SUCCESS',
            requestBodyHash,
            intentHash: session.intentHash,
            pickupSessionId,
            resultServingIds: servingSummaries.map((serving) => serving.id),
            resultSnapshot: response as unknown as Prisma.InputJsonValue,
            originalResultRequestId: null,
            completedAt: confirmationTime,
            conflictCode: null,
          },
        });
        isNewRequest = true;
        return {
          response,
          isNewRequest,
          mealDate: mealDateKey,
          requestId,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );

    if (transactionResult.isNewRequest && this.kitchenEventsService) {
      const sortedServingIds = transactionResult.response.servings
        .map((serving) => serving.id)
        .sort((left, right) => left.localeCompare(right));
      this.kitchenEventsService.emitEvent({
        eventId: `serving:${sortedServingIds.join(',')}`,
        eventType: 'SERVING_CONFIRMED',
        mealDate: transactionResult.mealDate,
        requestId: transactionResult.requestId,
        payload: {
          servedCount: transactionResult.response.servedCount,
          servingIds: sortedServingIds,
        },
      });
    }
    return transactionResult.response;
  }
}
