import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { v1 } from '@imeal/contracts';
import type { Prisma, ServingConfirmRequest } from '@imeal/core';

import { PrismaService } from '../common/prisma.service.js';
import { ApiMetricsService } from '../common/metrics.service.js';
import {
  BUSINESS_TIME_ZONE,
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

const CHECK_IN_QR_PREFIX = 'imeal-checkin-v1.';
const VERIFICATION_RETENTION_DAYS = 365;
type ResolveIntentPayload = {
  version: 1;
  callerUserId: string;
  registrationId: string;
  sessionId: string;
  locationId: string;
  expiresAt: string;
  nonce: string;
};

type CheckInFailureCode = v1.CheckInErrorCode | 'IDEMPOTENCY_CONFLICT';

type LocationAssignment = Prisma.EmployeeLocationAssignmentGetPayload<{
  include: {
    location: {
      select: {
        id: true;
        shortCode: true;
        displayName: true;
        servingPointName: true;
        address: true;
      };
    };
  };
}>;

type RegistrationRecord = Prisma.RegistrationGetPayload<{
  include: {
    mealServing: { select: { id: true; servedAt: true } };
    menuRevision: {
      select: {
        id: true;
        mealName: true;
        description: true;
        imageUrl: true;
      };
    };
    user: { select: { id: true; email: true; name: true; isActive: true } };
  };
}>;

type CheckInSessionRecord = Prisma.CheckInSessionGetPayload<{
  include: {
    location: {
      select: {
        id: true;
        shortCode: true;
        displayName: true;
        servingPointName: true;
        address: true;
      };
    };
  };
}>;

type ConfirmResponse = v1.ConfirmCheckInResponse;

type StoredConfirmRequest = Pick<
  ServingConfirmRequest,
  | 'id'
  | 'callerUserId'
  | 'idempotencyKey'
  | 'status'
  | 'requestBodyHash'
  | 'checkInSessionId'
  | 'resultSnapshot'
>;

type CheckInTransaction = Prisma.TransactionClient;


function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function checkInError(
  code: CheckInFailureCode,
  message: string,
  status: 400 | 403 | 409 = 400,
  details?: Record<string, unknown>,
): BadRequestException | ForbiddenException | ConflictException {
  const body = { code, message, ...(details ? { details } : {}) };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

function exceptionCode(error: unknown): string | undefined {
  if (
    !(
      error instanceof BadRequestException ||
      error instanceof ForbiddenException ||
      error instanceof ConflictException
    )
  ) {
    return undefined;
  }
  const response = error.getResponse();
  if (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    typeof response.code === 'string'
  ) {
    return response.code;
  }
  return undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function safeDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new InternalServerErrorException('Internal server error');
  }
  return date;
}

function toDateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function dateAtUtc(dateKey: string, hour: number, minute: number): Date {
  const date = parseMealDate(dateKey);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function servingWindow(dateKey: string) {
  return {
    opensAt: dateAtUtc(dateKey, 3, 30),
    closesAt: dateAtUtc(dateKey, 6, 30),
  };
}

function asWindowContract(dateKey: string) {
  const window = servingWindow(dateKey);
  return {
    opensAt: window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
  } as const;
}

function registrationStatus(
  registration: Pick<RegistrationRecord, 'status' | 'mealServing'>,
): v1.CheckInRegistration['status'] {
  if (registration.mealServing || registration.status === 'SERVED') {
    return 'CHECKED_IN';
  }
  if (
    registration.status === 'ACTIVE' ||
    registration.status === 'CANCELLED' ||
    registration.status === 'NO_SHOW'
  ) {
    return registration.status;
  }
  return 'CANCELLED';
}

function confirmationResponse(value: unknown): ConfirmResponse | null {
  const parsed = v1.ConfirmCheckInResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
    @Optional() private readonly metrics?: ApiMetricsService,
  ) {}

  private getSecret(): string {
    const secret = process.env.QR_SIGNING_SECRET?.trim();
    if (!secret) throw new Error('QR_SIGNING_SECRET is required');
    return secret;
  }

  private stableQr(dateKey: string, locationId: string): string {
    const payload = `check-in:v1:${dateKey}:${locationId}`;
    const digest = createHmac('sha256', this.getSecret())
      .update(payload, 'utf8')
      .digest('base64url');
    return `${CHECK_IN_QR_PREFIX}${digest}`;
  }
  private createResolveIntent(
    callerUserId: string,
    registrationId: string,
    session: CheckInSessionRecord,
  ): string {
    const payload: ResolveIntentPayload = {
      version: 1,
      callerUserId,
      registrationId,
      sessionId: session.id,
      locationId: session.locationId,
      expiresAt: safeDate(session.expiresAt).toISOString(),
      nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const signature = createHmac('sha256', this.getSecret())
      .update(encoded, 'utf8')
      .digest('base64url');
    return `imeal-checkin-intent-v1.${encoded}.${signature}`;
  }

  private parseResolveIntent(token: string): ResolveIntentPayload | null {
    const [prefix, encoded, signature] = token.split('.');
    if (
      prefix !== 'imeal-checkin-intent-v1' ||
      !encoded ||
      !signature ||
      token.split('.').length !== 3
    ) {
      return null;
    }
    const expected = createHmac('sha256', this.getSecret())
      .update(encoded, 'utf8')
      .digest('base64url');
    const expectedBytes = Buffer.from(expected, 'utf8');
    const signatureBytes = Buffer.from(signature, 'utf8');
    if (
      expectedBytes.length !== signatureBytes.length ||
      !timingSafeEqual(expectedBytes, signatureBytes)
    ) {
      return null;
    }
    try {
      const value: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      if (
        !value ||
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== 1 ||
        !('callerUserId' in value) ||
        !('registrationId' in value) ||
        !('sessionId' in value) ||
        !('locationId' in value) ||
        !('expiresAt' in value) ||
        !('nonce' in value) ||
        typeof value.callerUserId !== 'string' ||
        typeof value.registrationId !== 'string' ||
        typeof value.sessionId !== 'string' ||
        typeof value.locationId !== 'string' ||
        typeof value.expiresAt !== 'string' ||
        typeof value.nonce !== 'string' ||
        !Number.isFinite(new Date(value.expiresAt).getTime())
      ) {
        return null;
      }
      return {
        version: 1,
        callerUserId: value.callerUserId,
        registrationId: value.registrationId,
        sessionId: value.sessionId,
        locationId: value.locationId,
        expiresAt: value.expiresAt,
        nonce: value.nonce,
      };
    } catch {
      return null;
    }
  }


  private qrHash(qr: string): string {
    return sha256(qr);
  }

  private assertActiveUser(user: AuthenticatedUser): void {
    if (!user?.id || user.userId !== user.id || user.isActive === false) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'An active authenticated session is required.',
        403,
      );
    }
  }

  private assertWithinWindow(now: Date, dateKey = getBusinessDate(now)): void {
    if (!isWithinServingWindow(now) || getBusinessDate(now) !== dateKey) {
      const window = servingWindow(dateKey);
      throw checkInError(
        'OUTSIDE_CHECKIN_WINDOW',
        'Check-in is available only from 10:30 through 13:30 Vietnam time.',
        403,
        {
          opensAt: window.opensAt.toISOString(),
          closesAt: window.closesAt.toISOString(),
          timeZone: BUSINESS_TIME_ZONE,
        },
      );
    }
  }

  private async currentAssignments(
    userId: string,
    at: Date,
  ): Promise<LocationAssignment[]> {
    const rows = await this.prisma.employeeLocationAssignment.findMany({
      where: {
        userId,
        isActive: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      include: {
        location: {
          select: {
            id: true,
            shortCode: true,
            displayName: true,
            servingPointName: true,
            address: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows;
  }

  private async currentAssignmentsInTransaction(
    tx: CheckInTransaction,
    userId: string,
    at: Date,
  ): Promise<LocationAssignment[]> {
    return tx.employeeLocationAssignment.findMany({
      where: {
        userId,
        isActive: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      include: {
        location: {
          select: {
            id: true,
            shortCode: true,
            displayName: true,
            servingPointName: true,
            address: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  private async effectiveLocation(
    locationId: string,
    serviceLocationCode: string,
    at: Date,
  ): Promise<ResolvedLocation> {
    let location: ResolvedLocation;
    try {
      location = await this.locationsService.resolveEffectiveLocation(
        serviceLocationCode,
        at,
      );
    } catch (error: unknown) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      throw checkInError(
        'LOCATION_MISMATCH',
        'The service location is not active for check-in.',
        403,
      );
    }
    if (location.id !== locationId) {
      throw checkInError(
        'LOCATION_MISMATCH',
        'The service location no longer matches this check-in.',
        403,
      );
    }
    return location;
  }

  private async kitchenLocation(
    kitchenActor: AuthenticatedUser,
    at: Date,
    requestedLocationId?: string,
  ): Promise<{ assignment: LocationAssignment; location: ResolvedLocation }> {
    this.assertActiveUser(kitchenActor);
    const account = await this.prisma.user.findUnique({
      where: { id: kitchenActor.id },
      select: { isActive: true },
    });
    if (!account?.isActive) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'An active authenticated session is required.',
        403,
      );
    }
    const assignments = await this.currentAssignments(kitchenActor.id, at);
    const assignment = requestedLocationId
      ? assignments.find((candidate) => candidate.locationId === requestedLocationId)
      : assignments.length === 1
        ? assignments[0]
        : undefined;
    if (!assignment) {
      throw checkInError(
        'LOCATION_MISMATCH',
        'Kitchen location is not available for this account.',
        403,
      );
    }
    const location = await this.effectiveLocation(
      assignment.locationId,
      assignment.serviceLocationCode,
      at,
    );
    return { assignment, location };
  }

  private async ownerContext(userId: string, at: Date) {
    const [user, assignments] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, isActive: true },
      }),
      this.currentAssignments(userId, at),
    ]);
    if (!user || user.isActive === false) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'An active authenticated session is required.',
        403,
      );
    }
    const assignment = assignments.length === 1 ? assignments[0] : undefined;
    return { user, assignment };
  }

  private async ownRegistration(
    userId: string,
    dateKey: string,
    prisma: Pick<Prisma.TransactionClient, 'registration'> = this.prisma,
  ): Promise<RegistrationRecord | null> {
    return prisma.registration.findUnique({
      where: {
        userId_mealDate: {
          userId,
          mealDate: parseMealDate(dateKey),
        },
      },
      include: {
        mealServing: { select: { id: true, servedAt: true } },
        menuRevision: {
          select: {
            id: true,
            mealName: true,
            description: true,
            imageUrl: true,
          },
        },
        user: { select: { id: true, email: true, name: true, isActive: true } },
      },
    });
  }

  private locationContract(location: ResolvedLocation): v1.CheckInLocation {
    return v1.CheckInLocationSchema.parse({
      id: location.id,
      shortCode: location.shortCode,
      displayName: location.displayName,
      servingPointName: location.servingPointName,
      address: location.address,
    });
  }

  private registrationContract(
    registration: RegistrationRecord,
  ): v1.CheckInRegistration {
    return v1.CheckInRegistrationSchema.parse({
      id: registration.id,
      mealDate: toDateKey(registration.mealDate),
      mealChoice: registration.mealChoice,
      status: registrationStatus(registration),
      servedAt: registration.mealServing?.servedAt
        ? safeDate(registration.mealServing.servedAt).toISOString()
        : null,
    });
  }

  private employeeContract(
    registration: RegistrationRecord | null,
    assignment: LocationAssignment | undefined,
    user: { id: string; name: string | null; email: string },
  ): v1.CheckInEmployee {
    const name =
      registration?.ownerNameSnapshot?.trim() ||
      assignment?.employeeName?.trim() ||
      user.name?.trim() ||
      user.email.trim();
    const employeeCode =
      registration?.employeeCodeSnapshot?.trim() || assignment?.employeeCode?.trim();
    if (!employeeCode) {
      throw checkInError(
        'NO_REGISTRATION',
        'An approved employee assignment is required for check-in.',
      );
    }
    return v1.CheckInEmployeeSchema.parse({
      id: user.id,
      name,
      employeeCode,
    });
  }

  private menuContract(
    registration: RegistrationRecord,
  ): v1.CheckInMenu | null {
    const name =
      registration.menuNameSnapshot?.trim() ||
      registration.menuRevision?.mealName?.trim() ||
      '';
    if (!name) return null;
    return v1.CheckInMenuSchema.parse({
      name,
      description:
        registration.menuDescriptionSnapshot ??
        registration.menuRevision?.description ??
        null,
      imageUrl:
        registration.menuImageSnapshot ?? registration.menuRevision?.imageUrl ?? null,
    });
  }

  private mapGpsFailure(result: Exclude<GpsVerificationResult, { result: 'VALID' }>): CheckInFailureCode {
    switch (result.safeVerificationCode) {
      case 'GPS_STALE':
        return 'GPS_STALE';
      case 'GPS_INACCURATE':
        return 'GPS_INACCURATE';
      case 'OUTSIDE_GEOFENCE':
        return 'OUTSIDE_GEOFENCE';
      case 'GPS_UNAVAILABLE':
      case 'GPS_RETRY_REQUIRED':
      default:
        return 'GPS_REQUIRED';
    }
  }

  private async verifyGps(
    locationId: string,
    gps: v1.PresenterLocationEvidence | undefined,
    at: Date,
  ): Promise<Extract<GpsVerificationResult, { result: 'VALID' }>> {
    if (!gps) {
      throw checkInError(
        'GPS_REQUIRED',
        'A fresh foreground location is required for check-in.',
        403,
      );
    }
    const result = await this.locationsService.evaluatePresenterEvidence(
      locationId,
      gps,
      at,
    );
    if (result.result !== 'VALID') {
      throw checkInError(
        this.mapGpsFailure(result),
        'The foreground location could not be verified for check-in.',
        403,
        { action: result.details.action },
      );
    }
    return result;
  }

  private async sessionByQr(
    qr: string,
    at: Date,
  ): Promise<CheckInSessionRecord> {
    if (!qr.startsWith(CHECK_IN_QR_PREFIX)) {
      throw checkInError('INVALID_QR', 'The check-in QR is invalid.');
    }
    const session = await this.prisma.checkInSession.findUnique({
      where: { qrHash: this.qrHash(qr) },
      include: {
        location: {
          select: {
            id: true,
            shortCode: true,
            displayName: true,
            servingPointName: true,
            address: true,
          },
        },
      },
    });
    if (!session) {
      throw checkInError('INVALID_QR', 'The check-in QR is invalid.');
    }
    const dateKey = toDateKey(session.mealDate);
    if (dateKey !== getBusinessDate(at)) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'The check-in QR is not active now.',
        403,
      );
    }
    this.assertWithinWindow(at, dateKey);
    if (session.activeFrom > at || session.expiresAt <= at) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'The check-in QR is not active now.',
        403,
      );
    }
    return session;
  }

  private async resolveData(
    userId: string,
    session: CheckInSessionRecord,
    at: Date,
  ) {
    const dateKey = toDateKey(session.mealDate);
    const { user, assignment } = await this.ownerContext(userId, at);
    const registration = await this.ownRegistration(userId, dateKey);
    if (!registration) {
      throw checkInError(
        'NO_REGISTRATION',
        'No meal registration exists for today.',
      );
    }
    const employee = this.employeeContract(registration, assignment, user);
    const locationCode = registration.serviceLocationCode || assignment?.serviceLocationCode;
    const locationId = registration.serviceLocationId || assignment?.locationId;
    if (!locationCode || !locationId) {
      throw checkInError(
        'LOCATION_MISMATCH',
        'The registration has no active service location.',
        403,
      );
    }
    if (
      !assignment ||
      assignment.locationId !== locationId ||
      assignment.serviceLocationCode !== locationCode
    ) {
      throw checkInError(
        'LOCATION_MISMATCH',
        'The active roster location does not match your registration.',
        403,
      );
    }
    const location = await this.effectiveLocation(locationId, locationCode, at);
    if (location.id !== session.locationId) {
      throw checkInError(
        'LOCATION_MISMATCH',
        'The QR location does not match your registration.',
        403,
      );
    }
    const menu = this.menuContract(registration);
    if (!menu) {
      throw checkInError('NO_REGISTRATION', 'Today\'s menu is unavailable.');
    }
    const reasons: CheckInFailureCode[] = [];
    const publicRegistration = this.registrationContract(registration);
    if (registration.status === 'CANCELLED') reasons.push('REGISTRATION_CANCELLED');
    else if (registration.mealServing || registration.status === 'SERVED') {
      reasons.push('ALREADY_CHECKED_IN');
    } else if (registration.status !== 'ACTIVE') {
      reasons.push('NO_REGISTRATION');
    }
    return {
      sessionId: session.id,
      date: dateKey,
      expiresAt: safeDate(session.expiresAt).toISOString(),
      employee,
      menu,
      location: this.locationContract(location),
      registration: publicRegistration,
      eligibility: {
        eligible: reasons.length === 0,
        reasons: reasons as v1.CheckInErrorCode[],
      },
      user,
      assignment,
      registrationRecord: registration,
      resolvedLocation: location,
    };
  }

  async getKitchenQr(
    kitchenActor: AuthenticatedUser,
    requestedLocationId?: string,
    at: Date = new Date(),
  ): Promise<v1.KitchenCheckInQrResponse> {
    const dateKey = getBusinessDate(at);
    const { opensAt, closesAt } = servingWindow(dateKey);
    if (at >= closesAt) this.assertWithinWindow(at, dateKey);
    const { assignment, location } = await this.kitchenLocation(
      kitchenActor,
      at,
      requestedLocationId,
    );
    const qr = this.stableQr(dateKey, location.id);
    const qrHash = this.qrHash(qr);
    const sessionWhere = {
      mealDate_locationId: {
        mealDate: parseMealDate(dateKey),
        locationId: location.id,
      },
    };
    const sessionInclude = {
      location: {
        select: {
          id: true,
          shortCode: true,
          displayName: true,
          servingPointName: true,
          address: true,
        },
      },
    } as const;
    let session = await this.prisma.checkInSession.findUnique({
      where: sessionWhere,
      include: sessionInclude,
    });
    if (!session) {
      try {
        session = await this.prisma.checkInSession.create({
          data: {
            id: randomUUID(),
            mealDate: parseMealDate(dateKey),
            locationId: location.id,
            qrHash,
            activeFrom: opensAt,
            expiresAt: closesAt,
            createdByUserId: assignment.userId ?? kitchenActor.id,
          },
          include: sessionInclude,
        });
      } catch (error: unknown) {
        if (!isUniqueConstraintError(error)) throw error;
        session = await this.prisma.checkInSession.findUnique({
          where: sessionWhere,
          include: sessionInclude,
        });
        if (!session) throw new InternalServerErrorException('Internal server error');
      }
    }

    if (session.qrHash !== qrHash) {
      throw new InternalServerErrorException('Internal server error');
    }
    if (safeDate(session.expiresAt) <= at) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'The check-in QR is not active now.',
        403,
      );
    }
    return v1.KitchenCheckInQrResponseSchema.parse({
      data: {
        qr,
        date: dateKey,
        location: this.locationContract(location),
        activeFrom: safeDate(session.activeFrom).toISOString(),
        expiresAt: safeDate(session.expiresAt).toISOString(),
      },
    });
  }

  async getStatus(
    user: AuthenticatedUser,
    at: Date = new Date(),
  ): Promise<v1.CheckInStatusResponse> {
    this.assertActiveUser(user);
    const dateKey = getBusinessDate(at);
    const { user: account, assignment } = await this.ownerContext(user.id, at);
    const registration = await this.ownRegistration(user.id, dateKey);
    const employee = this.employeeContract(registration, assignment, account);
    let location: v1.CheckInLocation | null = null;
    let menu: v1.CheckInMenu | null = null;
    let publicRegistration: v1.CheckInRegistration | null = null;
    if (registration) {
      publicRegistration = this.registrationContract(registration);
      menu = this.menuContract(registration);
      if (registration.serviceLocationId && registration.serviceLocationCode) {
        try {
          location = this.locationContract(
            await this.effectiveLocation(
              registration.serviceLocationId,
              registration.serviceLocationCode,
              at,
            ),
          );
        } catch (error: unknown) {
          if (!(error instanceof NotFoundException)) {
            throw error;
          }
          location = null;
        }
      }
    }
    let state: v1.CheckInStatus['state'] = publicRegistration?.status ?? 'UNREGISTERED';
    if (publicRegistration) {
      state =
        publicRegistration.status === 'ACTIVE' && !isWithinServingWindow(at)
          ? 'OUTSIDE_WINDOW'
          : publicRegistration.status;
    } else if (!isWithinServingWindow(at)) {
      state = 'OUTSIDE_WINDOW';
    }
    const canResolve =
      state === 'ACTIVE' &&
      isWithinServingWindow(at) &&
      location !== null &&
      menu !== null;
    return v1.CheckInStatusResponseSchema.parse({
      data: {
        date: dateKey,
        window: asWindowContract(dateKey),
        employee,
        location,
        menu,
        registration: publicRegistration,
        state,
        canResolve,
        canConfirm: false,
      },
    });
  }

  async resolve(
    user: AuthenticatedUser,
    input: v1.ResolveCheckInInput,
    at: Date = new Date(),
  ): Promise<v1.ResolveCheckInResponse> {
    this.assertActiveUser(user);
    const parsed = v1.ResolveCheckInSchema.safeParse(input);
    if (!parsed.success) {
      const hasGps =
        typeof input === 'object' &&
        input !== null &&
        'gps' in input &&
        input.gps !== undefined &&
        input.gps !== null;
      throw checkInError(
        hasGps ? 'INVALID_QR' : 'GPS_REQUIRED',
        hasGps
          ? 'A check-in QR and fresh GPS are required.'
          : 'A fresh foreground location is required for check-in.',
        hasGps ? 400 : 403,
      );
    }
    const session = await this.sessionByQr(parsed.data.qr, at);
    const data = await this.resolveData(user.id, session, at);
    const verification = await this.verifyGps(session.locationId, parsed.data.gps, at);
    let intentNonce: string | null = null;
    if (data.eligibility.eligible) {
      intentNonce = this.createResolveIntent(
        user.id,
        data.registrationRecord.id,
        session,
      );
      await this.prisma.servingVerification.create({
        data: {
          id: randomUUID(),
          presenterUserId: user.id,
          locationId: session.locationId,
          locationPolicyId: verification.locationPolicyId,
          result: 'VALID',
          capturedAt: new Date(verification.capturedAt),
          verifiedAt: new Date(verification.verifiedAt),
          accuracyMeters: verification.accuracyMeters,
          safeVerificationCode: verification.safeVerificationCode,
          intentNonce,
          retentionUntil: new Date(
            at.getTime() + VERIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });
    }
    return v1.ResolveCheckInResponseSchema.parse({
      data: {
        sessionId: data.sessionId,
        intentNonce,
        date: data.date,
        expiresAt: data.expiresAt,
        employee: data.employee,
        menu: data.menu,
        location: data.location,
        registration: data.registration,
        eligibility: data.eligibility,
      },
    });
  }

  private canonicalConfirmBody(input: v1.ConfirmCheckInInput): string {
    return JSON.stringify({
      sessionId: input.sessionId,
      intentNonce: input.intentNonce,
      gps: {
        capturedAt: input.gps.capturedAt,
        latitude: input.gps.latitude,
        longitude: input.gps.longitude,
        accuracyMeters: input.gps.accuracyMeters,
      },
    });
  }

  private async findSession(
    tx: CheckInTransaction,
    sessionId: string,
  ): Promise<CheckInSessionRecord | null> {
    return tx.checkInSession.findUnique({
      where: { id: sessionId },
      include: {
        location: {
          select: {
            id: true,
            shortCode: true,
            displayName: true,
            servingPointName: true,
            address: true,
          },
        },
      },
    });
  }

  private async lockOwnRegistration(
    tx: CheckInTransaction,
    userId: string,
    dateKey: string,
  ): Promise<RegistrationRecord | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "registrations"
      WHERE "user_id" = ${userId}
        AND "meal_date" = ${parseMealDate(dateKey)}
      FOR UPDATE
    `;
    if (!rows[0]?.id) {
      return tx.registration.findUnique({
        where: {
          userId_mealDate: {
            userId,
            mealDate: parseMealDate(dateKey),
          },
        },
        include: {
          mealServing: { select: { id: true, servedAt: true } },
          menuRevision: {
            select: {
              id: true,
              mealName: true,
              description: true,
              imageUrl: true,
            },
          },
          user: {
            select: { id: true, email: true, name: true, isActive: true },
          },
        },
      });
    }
    return tx.registration.findUnique({
      where: { id: rows[0].id },
      include: {
        mealServing: { select: { id: true, servedAt: true } },
        menuRevision: {
          select: {
            id: true,
            mealName: true,
            description: true,
            imageUrl: true,
          },
        },
        user: {
          select: { id: true, email: true, name: true, isActive: true },
        },
      },
    });
  }

  private async claimConfirmRequest(
    tx: CheckInTransaction,
    callerUserId: string,
    input: v1.ConfirmCheckInInput,
    bodyHash: string,
    requestId: string,
  ): Promise<{ request: StoredConfirmRequest; isNew: boolean }> {
    const selectExisting = async () =>
      (await tx.$queryRaw`
        SELECT
          "id",
          "caller_user_id" AS "callerUserId",
          "idempotency_key" AS "idempotencyKey",
          "status",
          "request_body_hash" AS "requestBodyHash",
          "check_in_session_id" AS "checkInSessionId",
          "result_snapshot" AS "resultSnapshot"
        FROM "serving_confirm_requests"
        WHERE "caller_user_id" = ${callerUserId}
          AND "idempotency_key" = ${input.idempotencyKey}
        FOR UPDATE
      `) as StoredConfirmRequest[];

    const existing = await selectExisting();
    if (existing?.[0]) {
      return this.resolveExistingConfirmRequest(
        existing[0],
        input,
        bodyHash,
      );
    }

    // Validate the referenced session before inserting the FK-bearing
    // idempotency row. This maps unknown/tampered session IDs to the public
    // check-in error instead of leaking a database FK violation.
    const session = await tx.checkInSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true },
    });
    if (!session) {
      throw checkInError(
        'INACTIVE_CHECKIN_SESSION',
        'The check-in session is not active.',
        403,
      );
    }

    const inserted = (await tx.$queryRaw`
      INSERT INTO "serving_confirm_requests"
        ("id", "caller_user_id", "idempotency_key", "status", "request_body_hash", "check_in_session_id")
      VALUES
        (${requestId}, ${callerUserId}, ${input.idempotencyKey}, 'PROCESSING', ${bodyHash}, ${input.sessionId})
      ON CONFLICT ("caller_user_id", "idempotency_key") DO NOTHING
      RETURNING
        "id",
        "caller_user_id" AS "callerUserId",
        "idempotency_key" AS "idempotencyKey",
        "status",
        "request_body_hash" AS "requestBodyHash",
        "check_in_session_id" AS "checkInSessionId",
        "result_snapshot" AS "resultSnapshot"
    `) as StoredConfirmRequest[];
    if (inserted?.[0]) return { request: inserted[0], isNew: true };

    // Another request may have won the unique key race while this
    // transaction checked the session. Its row is now committed and
    // available for the same replay/conflict handling as the fast path.
    const raced = await selectExisting();
    if (!raced?.[0]) {
      throw checkInError(
        'IDEMPOTENCY_CONFLICT',
        'The idempotency request could not be established.',
        409,
      );
    }
    return this.resolveExistingConfirmRequest(raced[0], input, bodyHash);
  }

  private resolveExistingConfirmRequest(
    request: StoredConfirmRequest,
    input: v1.ConfirmCheckInInput,
    bodyHash: string,
  ): { request: StoredConfirmRequest; isNew: false } {
    if (
      request.requestBodyHash !== bodyHash ||
      request.checkInSessionId !== input.sessionId
    ) {
      throw checkInError(
        'IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for another request.',
        409,
      );
    }
    if (request.status === 'SUCCESS') {
      const response = confirmationResponse(request.resultSnapshot);
      if (!response) {
        throw new InternalServerErrorException('Internal server error');
      }
      return { request, isNew: false };
    }
    throw checkInError(
      'IDEMPOTENCY_CONFLICT',
      'The idempotency request is already being processed.',
      409,
    );
  }

  async confirm(
    user: AuthenticatedUser,
    input: v1.ConfirmCheckInInput,
    at?: Date,
  ): Promise<ConfirmResponse> {
    const startedAt = Date.now();
    try {
      this.assertActiveUser(user);
      const parsed = v1.ConfirmCheckInSchema.safeParse(input);
      if (!parsed.success) {
        const hasGps =
          typeof input === 'object' &&
          input !== null &&
          'gps' in input &&
          input.gps !== undefined &&
          input.gps !== null;
        throw checkInError(
          hasGps ? 'INACTIVE_CHECKIN_SESSION' : 'GPS_REQUIRED',
          hasGps
            ? 'A resolved check-in intent and fresh GPS are required.'
            : 'A fresh foreground location is required for check-in.',
          403,
        );
      }
    const body = parsed.data;
    const bodyHash = sha256(this.canonicalConfirmBody(body));
    const requestId = randomUUID();
    const result = await this.prisma.$transaction(async (tx: CheckInTransaction) => {
      const claimed = await this.claimConfirmRequest(
        tx,
        user.id,
        body,
        bodyHash,
        requestId,
      );
      if (!claimed.isNew) {
        const replay = confirmationResponse(claimed.request.resultSnapshot);
        if (!replay) throw new InternalServerErrorException('Internal server error');
        return replay;
      }
      const session = await this.findSession(tx, body.sessionId);
      if (!session) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The check-in session is not active.',
          403,
        );
      }
      const dateKey = toDateKey(session.mealDate);
      let checkInAt = at ?? new Date();
      this.assertWithinWindow(checkInAt, dateKey);
      if (
        session.activeFrom > checkInAt ||
        session.expiresAt <= checkInAt ||
        dateKey !== getBusinessDate(checkInAt)
      ) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The check-in session is not active.',
          403,
        );
      }
      const registration = await this.lockOwnRegistration(tx, user.id, dateKey);
      if (!registration) {
        throw checkInError('NO_REGISTRATION', 'No meal registration exists for today.');
      }
      if (registration.userId !== user.id || registration.user.isActive === false) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The authenticated account is not active.',
          403,
        );
      }
      checkInAt = at ?? new Date();
      this.assertWithinWindow(checkInAt, dateKey);
      if (
        session.activeFrom > checkInAt ||
        session.expiresAt <= checkInAt ||
        dateKey !== getBusinessDate(checkInAt)
      ) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The check-in session is not active.',
          403,
        );
      }
      const intent = this.parseResolveIntent(body.intentNonce);
      if (
        !intent ||
        intent.callerUserId !== user.id ||
        intent.sessionId !== session.id ||
        intent.locationId !== session.locationId ||
        intent.expiresAt !== safeDate(session.expiresAt).toISOString() ||
        new Date(intent.expiresAt) <= checkInAt
      ) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The resolved check-in intent is not active for this session.',
          403,
        );
      }
      if (intent.registrationId !== registration.id) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The resolved check-in intent does not belong to this registration.',
          403,
        );
      }
      const resolvedIntent = await tx.servingVerification.findFirst({
        where: {
          intentNonce: body.intentNonce,
          presenterUserId: user.id,
          locationId: session.locationId,
          result: 'VALID',
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!resolvedIntent) {
        throw checkInError(
          'INACTIVE_CHECKIN_SESSION',
          'The resolved check-in intent is not active for this session.',
          403,
        );
      }
      if (registration.status === 'CANCELLED') {
        throw checkInError(
          'REGISTRATION_CANCELLED',
          'This meal registration was cancelled.',
        );
      }
      if (registration.mealServing || registration.status === 'SERVED') {
        throw checkInError(
          'ALREADY_CHECKED_IN',
          'This meal has already been checked in.',
          409,
        );
      }
      if (registration.status !== 'ACTIVE') {
        throw checkInError('NO_REGISTRATION', 'This meal is not eligible for check-in.');
      }
      const locationId = registration.serviceLocationId;
      const locationCode = registration.serviceLocationCode;
      if (!locationId || !locationCode || locationId !== session.locationId) {
        throw checkInError(
          'LOCATION_MISMATCH',
          'The check-in location does not match your registration.',
          403,
        );
      }
      const assignments = await this.currentAssignmentsInTransaction(
        tx,
        user.id,
        checkInAt,
      );
      const assignment =
        assignments.length === 1 ? assignments[0] : undefined;
      if (
        !assignment ||
        assignment.locationId !== locationId ||
        assignment.serviceLocationCode !== locationCode
      ) {
        throw checkInError(
          'LOCATION_MISMATCH',
          'The active roster location does not match your registration.',
          403,
        );
      }
      const location = await this.effectiveLocation(
        locationId,
        locationCode,
        checkInAt,
      );
      const verification = await this.verifyGps(location.id, body.gps, checkInAt);
      const servedAt = checkInAt;
      const verificationId = randomUUID();
      await tx.servingVerification.create({
        data: {
          id: verificationId,
          presenterUserId: user.id,
          locationId: location.id,
          locationPolicyId: verification.locationPolicyId,
          result: 'VALID',
          capturedAt: new Date(verification.capturedAt),
          verifiedAt: new Date(verification.verifiedAt),
          accuracyMeters: verification.accuracyMeters,
          safeVerificationCode: verification.safeVerificationCode,
          intentNonce: body.intentNonce,
          retentionUntil: new Date(
            servedAt.getTime() + VERIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });
      const serving = await tx.mealServing.create({
        data: {
          registrationId: registration.id,
          ownerUserId: user.id,
          ownerEmailSnapshot: registration.user.email,
          ownerNameSnapshot:
            registration.ownerNameSnapshot ?? registration.user.name ?? registration.user.email,
          presenterUserId: user.id,
          receiverType: 'SELF',
          kitchenUserId: null,
          kitchenPermissionContext: null,
          scannerDeviceId: null,
          locationId: location.id,
          locationShortCode: location.shortCode,
          locationNameSnapshot: location.displayName,
          locationAddressSnapshot: location.address,
          mealDate: parseMealDate(dateKey),
          menuRevisionId: registration.menuRevisionId,
          menuNameSnapshot:
            registration.menuNameSnapshot ?? registration.menuRevision?.mealName ?? null,
          menuDescriptionSnapshot:
            registration.menuDescriptionSnapshot ?? registration.menuRevision?.description ?? null,
          menuImageSnapshot:
            registration.menuImageSnapshot ?? registration.menuRevision?.imageUrl ?? null,
          requestId,
          pickupSessionId: null,
          checkInSessionId: session.id,
          intentHash: session.qrHash,
          verificationOutcome: verification.safeVerificationCode,
          servingVerificationId: verificationId,
          delegationId: null,
          servedAt,
        },
      });
      await tx.mealEvent.create({
        data: { mealServingId: serving.id, eventType: 'CHECK_IN_CONFIRMED' },
      });
      const response = v1.ConfirmCheckInResponseSchema.parse({
        data: {
          status: 'CHECKED_IN',
          registrationId: registration.id,
          servingId: serving.id,
          servedAt: servedAt.toISOString(),
        },
      });
      await tx.servingConfirmRequest.update({
        where: { id: claimed.request.id },
        data: {
          status: 'SUCCESS',
          requestBodyHash: bodyHash,
          checkInSessionId: session.id,
          resultServingIds: [serving.id],
          resultSnapshot: response as unknown as Prisma.InputJsonValue,
          completedAt: servedAt,
          conflictCode: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CHECK_IN_CONFIRMED',
          details: JSON.stringify({
            requestId,
            registrationId: registration.id,
            servingId: serving.id,
            checkInSessionId: session.id,
            mealDate: dateKey,
            locationId: location.id,
            verificationOutcome: verification.safeVerificationCode,
            accuracyMeters: verification.accuracyMeters,
          }),
        },
      });
      return response;
    });
    const response = v1.ConfirmCheckInResponseSchema.parse(result);
    this.metrics?.recordServingConfirmation(
      'success',
      Date.now() - startedAt,
    );
    return response;
    } catch (error: unknown) {
      const code = exceptionCode(error);
      if (code === 'IDEMPOTENCY_CONFLICT') {
        this.metrics?.recordIdempotencyConflict();
      }
      this.metrics?.recordServingConfirmation('error', Date.now() - startedAt);
      throw error;
    }
  }

  async getKitchenDashboard(
    kitchenActor: AuthenticatedUser,
    dateInput?: string,
    requestedLocationId?: string,
    at: Date = new Date(),
  ): Promise<v1.KitchenCheckInDashboardResponse> {
    const dateKey = dateInput ?? getBusinessDate(at);
    let date: Date;
    try {
      date = parseMealDate(dateKey);
    } catch {
      throw checkInError('OUTSIDE_CHECKIN_WINDOW', 'The dashboard date is invalid.');
    }
    const { location } = await this.kitchenLocation(
      kitchenActor,
      at,
      requestedLocationId,
    );
    const rows = await this.prisma.registration.findMany({
      where: {
        mealDate: date,
        serviceLocationId: location.id,
        status: { in: ['ACTIVE', 'SERVED', 'NO_SHOW'] },
        user: { isActive: true },
      },
      select: {
        status: true,
        mealChoice: true,
        mealServing: { select: { id: true } },
      },
    });
    let registered = 0;
    let checkedIn = 0;
    let pending = 0;
    let noShow = 0;
    let regular = 0;
    let vegetarian = 0;
    for (const row of rows) {
      registered += 1;
      if (row.mealServing !== null) {
        checkedIn += 1;
      } else if (row.status === 'NO_SHOW') {
        noShow += 1;
      } else if (row.status === 'ACTIVE') {
        pending += 1;
      }
      if (row.mealChoice === 'REGULAR') {
        regular += 1;
      } else {
        vegetarian += 1;
      }
    }
    if (checkedIn + pending + noShow !== registered) {
      throw new InternalServerErrorException('Internal server error');
    }
    const counts = {
      registered,
      checkedIn,
      pending,
      noShow,
      regular,
      vegetarian,
    };
    return v1.KitchenCheckInDashboardResponseSchema.parse({
      data: {
        date: dateKey,
        location: this.locationContract(location),
        window: asWindowContract(dateKey),
        lastUpdated: at.toISOString(),
        counts,
      },
    });
  }
}
