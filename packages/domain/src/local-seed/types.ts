export type SeedRole = 'staff' | 'kitchen' | 'admin';
export type SeedMealChoice = 'REGULAR' | 'VEGETARIAN';
export type SeedRegistrationStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'SERVED'
  | 'NO_SHOW';
export type SeedDelegationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'REVOKED'
  | 'COMPLETED';
export type SeedServingConfirmStatus = 'PROCESSING' | 'SUCCESS' | 'REJECTED';
export type SeedPenaltyStatus = 'PENDING' | 'PAID' | 'WAIVED';
export type SeedVerificationResult =
  | 'VALID'
  | 'GPS_UNAVAILABLE'
  | 'GPS_STALE'
  | 'GPS_INACCURATE'
  | 'OUTSIDE_GEOFENCE';
export type SeedReceiverType = 'SELF' | 'PROXY';
export type SeedOtpAllowlistState = 'ACTIVE' | 'DISABLED';
export type SeedOtpPurpose = 'SESSION_LOGIN';
export type SeedNotificationLocale = 'VI' | 'EN';

export type SeedJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SeedJsonValue[]
  | { readonly [key: string]: SeedJsonValue };

export interface LocalSeedConfig {
  baseEmail: string;
  weekStart: string;
  serveDate: string;
  dryRun: boolean;
  databaseUrl: string;
  target: {
    nodeEnv: 'development' | 'test';
    host: string;
    database: string;
    schema: string | null;
  };
}

export interface SeedUserRow {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  notificationLocale: SeedNotificationLocale;
  remindersEnabled: boolean;
  roles: readonly SeedRole[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedUserRoleRow {
  userId: string;
  roleName: SeedRole;
}

export interface SeedLocationRow {
  id: string;
  shortCode: string;
  displayName: string;
  servingPointName: string;
  address: string;
  building: string;
  floor: string;
  roomOrCounter: string;
  localContact: string;
  timeZone: string;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  operationalMetadata?: SeedJsonValue;
  holidayOverrides?: SeedJsonValue;
  capacityNotes?: string;
  accessibilityInstructions?: string;
  emergencyInstructions?: string;
  kitchenTeam?: string;
  approvedScannerDeviceIds: readonly string[];
  networkNotes?: string;
  lastVerifiedBy?: string | null;
  lastVerifiedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedLocationPolicyRow {
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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedAssignmentRow {
  id: string;
  userId: string;
  normalizedEmail: string;
  employeeName: string;
  employeeCode: string;
  isActive: boolean;
  role: string;
  serviceLocationCode: string;
  locationId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rosterImportBatchId?: string | null;
  auditEventId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedAllowlistRow {
  id: string;
  normalizedEmail: string;
  userId: string;
  state: SeedOtpAllowlistState;
  purpose: SeedOtpPurpose;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedWeeklyMenuRow {
  id: string;
  startDate: Date;
  endDate: Date;
  publishedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedDailyMenuRow {
  id: string;
  weeklyMenuId: string;
  date: Date;
  isHoliday: boolean;
  isEnabled: boolean;
  createdAt?: Date;
}

export interface SeedMealDayRow {
  id: string;
  dailyMenuId: string;
  mealType: 'LUNCH';
  isServingReady: boolean;
  createdAt?: Date;
}

export interface SeedMenuRevisionRow {
  id: string;
  dailyMenuId: string;
  content: string;
  createdAt?: Date;
}

export interface SeedRegistrationRow {
  id: string;
  userId: string;
  mealDate: Date;
  status: SeedRegistrationStatus;
  mealChoice: SeedMealChoice;
  serviceLocationId: string;
  serviceLocationAssignmentId: string;
  serviceLocationCode: string;
  serviceLocationName: string;
  serviceLocationAddress: string;
  serviceLocationEffectiveFrom: Date;
  serviceLocationSnapshotAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
  version: number;
}

export interface SeedDelegationRow {
  id: string;
  registrationId: string;
  delegateUserId: string;
  status: SeedDelegationStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedPenaltyRow {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  status: SeedPenaltyStatus;
  paidAt?: Date | null;
  waivedAt?: Date | null;
  waiveReason?: string | null;
  waivedByUserId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedServingVerificationRow {
  id: string;
  presenterUserId: string;
  locationId: string;
  locationPolicyId: string;
  result: SeedVerificationResult;
  capturedAt: Date;
  verifiedAt: Date;
  accuracyMeters: number;
  safeVerificationCode: string;
  intentNonce: string;
  retentionUntil: Date;
  createdAt?: Date;
}

export interface SeedPickupSessionRow {
  id: string;
  userId: string;
  presenterUserId: string;
  mealDate: Date;
  registrationIds: string[];
  intentRegistrationIds: string[];
  intentHash: string;
  intentNonce: string;
  qrHash: string;
  locationId: string;
  servingVerificationId: string;
  expiresAt: Date;
  consumedAt: Date;
  createdAt?: Date;
}

export interface SeedServingConfirmRequestRow {
  id: string;
  callerUserId: string;
  idempotencyKey: string;
  status: SeedServingConfirmStatus;
  requestBodyHash: string;
  intentHash: string;
  pickupSessionId: string;
  resultServingIds: string[];
  resultSnapshot: SeedJsonValue;
  originalResultRequestId?: string | null;
  completedAt: Date;
  createdAt?: Date;
}

export interface SeedMealServingRow {
  id: string;
  registrationId: string;
  ownerUserId: string;
  ownerEmailSnapshot: string;
  ownerNameSnapshot: string;
  presenterUserId: string;
  receiverType: SeedReceiverType;
  kitchenUserId: string;
  kitchenPermissionContext: string;
  scannerDeviceId?: string | null;
  locationId: string;
  locationShortCode: string;
  locationNameSnapshot: string;
  locationAddressSnapshot: string;
  mealDate: Date;
  menuRevisionId: string;
  requestId: string;
  pickupSessionId: string;
  intentHash: string;
  verificationOutcome: string;
  servingVerificationId: string;
  delegationId: string | null;
  servedAt: Date;
}

export interface SeedMealEventRow {
  id: string;
  mealServingId: string;
  eventType: 'PICKUP_CONFIRMED';
  createdAt?: Date;
}

export interface SeedAppSettingRow {
  key: string;
  value: string;
  version: number;
  updatedAt?: Date;
}

export interface SeedCounts {
  users: 50;
  userRoles: 56;
  locations: 4;
  locationPolicies: 4;
  assignments: 50;
  allowlists: 50;
  weeklyMenus: 1;
  dailyMenus: 7;
  mealDays: 7;
  menuRevisions: 7;
  registrations: 126;
  pendingDelegations: 0;
  acceptedDelegations: 0;
  completedDelegations: 0;
  penalties: 10;
  servingVerifications: 40;
  pickupSessions: 40;
  servingConfirmRequests: 40;
  mealServings: 40;
  mealEvents: 40;
  appSettings: 1;
}

export interface LocalSeedPlan {
  key: { baseEmail: string; weekStart: string; serveDate: string };
  counts: SeedCounts;
  users: readonly SeedUserRow[];
  userRoles: readonly SeedUserRoleRow[];
  locations: readonly SeedLocationRow[];
  locationPolicies: readonly SeedLocationPolicyRow[];
  assignments: readonly SeedAssignmentRow[];
  allowlists: readonly SeedAllowlistRow[];
  weeklyMenu: SeedWeeklyMenuRow;
  dailyMenus: readonly SeedDailyMenuRow[];
  mealDays: readonly SeedMealDayRow[];
  menuRevisions: readonly SeedMenuRevisionRow[];
  registrations: readonly SeedRegistrationRow[];
  delegations: readonly SeedDelegationRow[];
  penalties: readonly SeedPenaltyRow[];
  servingVerifications: readonly SeedServingVerificationRow[];
  pickupSessions: readonly SeedPickupSessionRow[];
  servingConfirmRequests: readonly SeedServingConfirmRequestRow[];
  mealServings: readonly SeedMealServingRow[];
  mealEvents: readonly SeedMealEventRow[];
  appSettings: readonly SeedAppSettingRow[];
}

export interface SeedWriteOptions {
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SeedWriteResult {
  created: number;
  updated: number;
  unchanged: number;
  counts: SeedCounts;
}

export type LocalSeedCliResult =
  | { kind: 'help'; text: string }
  | { kind: 'dry-run'; plan: LocalSeedPlan; summary: string }
  | { kind: 'written'; plan: LocalSeedPlan; result: SeedWriteResult; summary: string };
