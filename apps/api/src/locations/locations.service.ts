import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import type { Prisma } from '@prisma/client';
import { v1 } from '@imeal/contracts';
import { randomUUID } from 'node:crypto';
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;
const EARTH_RADIUS_METERS = 6_371_000;

type LocationPolicyRecord = {
  id: string;
  locationId: string;
  latitude: number;
  longitude: number;
  accuracySource: string;
  geofenceRadiusMeters: number;
  maxFixAgeSeconds: number;
  maxAccuracyMeters: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  updatedAt: Date;
};

type LocationRecord = {
  id: string;
  shortCode: string;
  displayName: string;
  servingPointName: string;
  address: string;
  building?: string;
  floor?: string;
  roomOrCounter?: string;
  localContact?: string;
  timeZone: string;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  operationalMetadata?: unknown;
  holidayOverrides?: unknown;
  capacityNotes?: string | null;
  accessibilityInstructions?: string | null;
  emergencyInstructions?: string | null;
  kitchenTeam?: string | null;
  approvedScannerDeviceIds?: string[];
  networkNotes?: string | null;
  lastVerifiedBy?: string | null;
  lastVerifiedAt?: Date | null;
  policies?: LocationPolicyRecord[];
};

export type ResolvedLocation = Omit<LocationRecord, 'policies'> & {
  locationPolicy: LocationPolicyRecord;
};

export type GpsVerificationResult =
  | {
      result: 'VALID';
      locationId: string;
      locationPolicyId: string;
      capturedAt: string;
      verifiedAt: string;
      accuracyMeters: number;
      safeVerificationCode: 'GPS_VALID';
    }
  | {
      result: 'GPS_RETRY_REQUIRED';
      locationId: string;
      code: 'GPS_RETRY_REQUIRED';
      safeVerificationCode:
        | 'GPS_UNAVAILABLE'
        | 'GPS_STALE'
        | 'GPS_INACCURATE'
        | 'GPS_RETRY_REQUIRED';
      details: { action: 'RETRY' | 'REFRESH' };
    };

type GpsFailureCode =
  'GPS_UNAVAILABLE' | 'GPS_STALE' | 'GPS_INACCURATE' | 'GPS_RETRY_REQUIRED';

export interface LocationConfigurationInput {
  id?: string;
  shortCode: string;
  displayName: string;
  servingPointName: string;
  address: string;
  building: string;
  floor: string;
  roomOrCounter: string;
  localContact: string;
  timeZone?: typeof VN_TIME_ZONE;
  isActive: boolean;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  operationalMetadata?: unknown;
  holidayOverrides?: unknown;
  capacityNotes?: string | null;
  accessibilityInstructions?: string | null;
  emergencyInstructions?: string | null;
  kitchenTeam?: string | null;
  approvedScannerDeviceIds?: string[];
  networkNotes?: string | null;
  policy: {
    id?: string;
    latitude?: number;
    longitude?: number;
    accuracySource: string;
    geofenceRadiusMeters: number;
    maxFixAgeSeconds: number;
    maxAccuracyMeters: number;
    effectiveFrom: string | Date;
    effectiveTo?: string | Date | null;
    isActive: boolean;
  };
}

function activeAt(at: Date) {
  return {
    lte: at,
  };
}

function dateRangeAt(at: Date) {
  return {
    effectiveFrom: activeAt(at),
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
  };
}

function normalizeCode(code: string): string {
  return code.normalize('NFKC').trim().toUpperCase();
}

function asDate(value: string | Date): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Effective dates must be valid UTC ISO instants.',
    });
  }
  return parsed;
}

function haversineDistanceMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(targetLatitude - latitude);
  const longitudeDelta = toRadians(targetLongitude - longitude);
  const originLatitude = toRadians(latitude);
  const destinationLatitude = toRadians(targetLatitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEffectiveLocation(
    code: string,
    at: Date = new Date(),
  ): Promise<ResolvedLocation> {
    const shortCode = normalizeCode(code);
    const record = (await this.prisma.location.findFirst({
      where: {
        shortCode,
        isActive: true,
        ...dateRangeAt(at),
      },
      include: {
        policies: {
          where: { isActive: true, ...dateRangeAt(at) },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    })) as LocationRecord | null;

    const locationPolicy = record?.policies?.[0];
    if (!record || !locationPolicy) {
      throw new NotFoundException({
        code: 'UNKNOWN_SERVICE_LOCATION',
        message: 'Service location is not available.',
      });
    }

    const resolvedPolicy = {
      ...locationPolicy,
      locationId: locationPolicy.locationId ?? record.id,
    };
    const { policies: _policies, ...location } = record;
    return { ...location, locationPolicy: resolvedPolicy };
  }

  async evaluatePresenterEvidence(
    locationId: string,
    evidence: v1.PresenterLocationEvidence,
    at: Date = new Date(),
  ): Promise<GpsVerificationResult> {
    const record = (await this.prisma.location.findUnique({
      where: { id: locationId },
      include: {
        policies: {
          where: { isActive: true, ...dateRangeAt(at) },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    })) as LocationRecord | null;

    const locationPolicy = record?.policies?.[0];
    if (!record || !record.isActive || !isEffective(record, at)) {
      return this.retry(locationId, 'GPS_UNAVAILABLE', 'REFRESH');
    }
    if (!locationPolicy) {
      return this.retry(locationId, 'GPS_UNAVAILABLE', 'REFRESH');
    }

    const capturedAt = new Date(evidence.capturedAt);
    if (!Number.isFinite(capturedAt.getTime())) {
      return this.retry(locationId, 'GPS_STALE', 'RETRY');
    }
    if (
      !Number.isFinite(evidence.latitude) ||
      !Number.isFinite(evidence.longitude) ||
      evidence.latitude < -90 ||
      evidence.latitude > 90 ||
      evidence.longitude < -180 ||
      evidence.longitude > 180
    ) {
      return this.retry(locationId, 'GPS_INACCURATE', 'RETRY');
    }

    const ageSeconds = (at.getTime() - capturedAt.getTime()) / 1000;
    if (ageSeconds < 0 || ageSeconds > locationPolicy.maxFixAgeSeconds) {
      return this.retry(locationId, 'GPS_STALE', 'RETRY');
    }
    if (
      !Number.isFinite(evidence.accuracyMeters) ||
      evidence.accuracyMeters < 0 ||
      evidence.accuracyMeters > locationPolicy.maxAccuracyMeters
    ) {
      return this.retry(locationId, 'GPS_INACCURATE', 'RETRY');
    }

    const distance = haversineDistanceMeters(
      evidence.latitude,
      evidence.longitude,
      locationPolicy.latitude,
      locationPolicy.longitude,
    );
    if (distance > locationPolicy.geofenceRadiusMeters) {
      return this.retry(locationId, 'GPS_RETRY_REQUIRED', 'REFRESH');
    }

    return {
      result: 'VALID',
      locationId,
      locationPolicyId: locationPolicy.id,
      capturedAt: capturedAt.toISOString(),
      verifiedAt: at.toISOString(),
      accuracyMeters: evidence.accuracyMeters,
      safeVerificationCode: 'GPS_VALID',
    };
  }

  async listConfiguredLocations(at: Date = new Date()) {
    const locations = await this.prisma.location.findMany({
      orderBy: { shortCode: 'asc' },
      include: {
        policies: {
          orderBy: { effectiveFrom: 'desc' },
        },
      },
    });
    return locations.map((location) => ({
      ...location,
      effectiveNow: location.isActive && isEffective(location, at) === true,
    }));
  }

  async saveConfiguration(
    input: LocationConfigurationInput,
    actorId: string,
    at: Date = new Date(),
  ) {
    if (!input || !input.policy) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Location configuration and policy are required.',
      });
    }
    const locationId = input.id ?? randomUUID();
    const effectiveFrom = asDate(input.effectiveFrom);
    const effectiveTo =
      input.effectiveTo == null ? null : asDate(input.effectiveTo);
    const policyEffectiveFrom = asDate(input.policy.effectiveFrom);
    const policyEffectiveTo =
      input.policy.effectiveTo == null
        ? null
        : asDate(input.policy.effectiveTo);
    validateDateRange(effectiveFrom, effectiveTo);
    validateDateRange(policyEffectiveFrom, policyEffectiveTo);
    validatePolicyThresholds(input.policy);

    return this.prisma.$transaction(async (tx) => {
      const existingPolicy = input.policy.id
        ? await tx.locationPolicy.findUnique({
            where: { id: input.policy.id },
            select: { locationId: true, latitude: true, longitude: true },
          })
        : null;
      if (
        input.policy.id &&
        (!existingPolicy || existingPolicy.locationId !== locationId)
      ) {
        throw new BadRequestException({
          code: 'INVALID_LOCATION_POLICY',
          message: 'Location policy does not belong to location.',
        });
      }

      const latitude = input.policy.latitude ?? existingPolicy?.latitude;
      const longitude = input.policy.longitude ?? existingPolicy?.longitude;
      if (latitude === undefined || longitude === undefined) {
        throw new BadRequestException({
          code: 'LOCATION_COORDINATES_REQUIRED',
          message: 'Location policy coordinates are required for a new policy.',
        });
      }
      const resolvedPolicy = { ...input.policy, latitude, longitude };
      validatePolicy(resolvedPolicy);

      const locationData = {
        shortCode: normalizeCode(input.shortCode),
        displayName: input.displayName.trim(),
        servingPointName: input.servingPointName.trim(),
        address: input.address.trim(),
        building: input.building.trim(),
        floor: input.floor.trim(),
        roomOrCounter: input.roomOrCounter.trim(),
        localContact: input.localContact.trim(),
        timeZone: VN_TIME_ZONE,
        isActive: input.isActive,
        effectiveFrom,
        effectiveTo,
        operationalMetadata:
          input.operationalMetadata == null
            ? undefined
            : (input.operationalMetadata as Prisma.InputJsonValue),
        holidayOverrides:
          input.holidayOverrides == null
            ? undefined
            : (input.holidayOverrides as Prisma.InputJsonValue),
        capacityNotes: input.capacityNotes ?? null,
        accessibilityInstructions: input.accessibilityInstructions ?? null,
        emergencyInstructions: input.emergencyInstructions ?? null,
        kitchenTeam: input.kitchenTeam ?? null,
        approvedScannerDeviceIds: input.approvedScannerDeviceIds ?? [],
        networkNotes: input.networkNotes ?? null,
        lastVerifiedBy: actorId,
        lastVerifiedAt: at,
      };

      const location = input.id
        ? await tx.location.update({
            where: { id: locationId },
            data: locationData,
          })
        : await tx.location.create({
            data: { id: locationId, ...locationData },
          });

      const policyData = {
        latitude: resolvedPolicy.latitude,
        longitude: resolvedPolicy.longitude,
        accuracySource: input.policy.accuracySource.trim(),
        geofenceRadiusMeters: input.policy.geofenceRadiusMeters,
        maxFixAgeSeconds: input.policy.maxFixAgeSeconds,
        maxAccuracyMeters: input.policy.maxAccuracyMeters,
        effectiveFrom: policyEffectiveFrom,
        effectiveTo: policyEffectiveTo,
        isActive: input.policy.isActive,
      };
      if (input.policy.id) {
        await tx.locationPolicy.update({
          where: { id: input.policy.id },
          data: policyData,
        });
      } else {
        await tx.locationPolicy.create({
          data: { id: randomUUID(), locationId: location.id, ...policyData },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: input.id
            ? 'LOCATION_CONFIGURATION_UPDATED'
            : 'LOCATION_CONFIGURATION_CREATED',
          details: JSON.stringify({
            locationId: location.id,
            shortCode: location.shortCode,
          }),
        },
      });
      return location;
    });
  }

  private retry(
    locationId: string,
    safeVerificationCode: GpsFailureCode,
    action: 'RETRY' | 'REFRESH',
  ): GpsVerificationResult {
    return {
      result: 'GPS_RETRY_REQUIRED',
      locationId,
      code: 'GPS_RETRY_REQUIRED',
      safeVerificationCode,
      details: { action },
    };
  }
}

function isEffective(
  record: { effectiveFrom: Date; effectiveTo: Date | null },
  at: Date,
): boolean {
  return (
    record.effectiveFrom <= at &&
    (record.effectiveTo === null || record.effectiveTo > at)
  );
}
function validateDateRange(from: Date, to: Date | null): void {
  if (to && to <= from) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Effective end must be after effective start.',
    });
  }
}

type ResolvedLocationPolicy = Omit<
  LocationConfigurationInput['policy'],
  'latitude' | 'longitude'
> & {
  latitude: number;
  longitude: number;
};

function invalidLocationPolicy(): never {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Invalid location policy.',
  });
}

function validatePolicyThresholds(
  policy: Pick<
    LocationConfigurationInput['policy'],
    'geofenceRadiusMeters' | 'maxFixAgeSeconds' | 'maxAccuracyMeters'
  >,
): void {
  if (
    !Number.isFinite(policy.geofenceRadiusMeters) ||
    policy.geofenceRadiusMeters <= 0 ||
    !Number.isInteger(policy.geofenceRadiusMeters) ||
    !Number.isFinite(policy.maxFixAgeSeconds) ||
    policy.maxFixAgeSeconds < 0 ||
    !Number.isInteger(policy.maxFixAgeSeconds) ||
    !Number.isFinite(policy.maxAccuracyMeters) ||
    policy.maxAccuracyMeters < 0
  ) {
    invalidLocationPolicy();
  }
}

function validatePolicy(policy: ResolvedLocationPolicy): void {
  if (
    !Number.isFinite(policy.latitude) ||
    policy.latitude < -90 ||
    policy.latitude > 90 ||
    !Number.isFinite(policy.longitude) ||
    policy.longitude < -180 ||
    policy.longitude > 180
  ) {
    invalidLocationPolicy();
  }
  validatePolicyThresholds(policy);
}
