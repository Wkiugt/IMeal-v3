import { v1 } from '@imeal/contracts';
import { projectRegistrationStatus } from './registration-status.js';

export type EmployeeRegistrationSnapshotRecord = {
  id: string;
  mealDate: Date;
  status: string;
  mealChoice: v1.MealChoice;
  menuRevisionId: string | null;
  menuNameSnapshot: string | null;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
  serviceLocationId: string | null;
  serviceLocationAssignmentId: string | null;
  serviceLocationCode: string | null;
  serviceLocationName: string | null;
  serviceLocationAddress: string | null;
  serviceLocationEffectiveFrom: Date | null;
  serviceLocationSnapshotAt: Date | null;
  registeredAt: Date | null;
  cancelledAt: Date | null;
  noShowAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mealServing: { servedAt: Date } | null;
};

export function toNullableIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function serializeEmployeeRegistrationBase(
  registration: EmployeeRegistrationSnapshotRecord,
): v1.EmployeeRegistrationActivityBase {
  return {
    id: registration.id,
    mealDate: registration.mealDate.toISOString().slice(0, 10),
    status: projectRegistrationStatus(
      registration.status,
      registration.mealServing,
    ),
    mealChoice: registration.mealChoice,
    menuRevisionId: registration.menuRevisionId,
    menuNameSnapshot: registration.menuNameSnapshot,
    menuDescriptionSnapshot: registration.menuDescriptionSnapshot,
    menuImageSnapshot: registration.menuImageSnapshot,
    serviceLocationId: registration.serviceLocationId,
    serviceLocationAssignmentId: registration.serviceLocationAssignmentId,
    serviceLocationCode: registration.serviceLocationCode,
    serviceLocationName: registration.serviceLocationName,
    serviceLocationAddress: registration.serviceLocationAddress,
    serviceLocationEffectiveFrom: toNullableIso(
      registration.serviceLocationEffectiveFrom,
    ),
    serviceLocationSnapshotAt: toNullableIso(
      registration.serviceLocationSnapshotAt,
    ),
    registeredAt: toNullableIso(registration.registeredAt),
    cancelledAt: toNullableIso(registration.cancelledAt),
    noShowAt: toNullableIso(registration.noShowAt),
    servedAt: toNullableIso(registration.mealServing?.servedAt ?? null),
    createdAt: registration.createdAt.toISOString(),
    updatedAt: registration.updatedAt.toISOString(),
  };
}
