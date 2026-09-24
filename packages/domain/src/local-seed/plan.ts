import {
  generateSeedEmails,
  normalizeSeedEmail,
  seedEmployeeCode,
  seedHash,
  seedInstant,
  stableSeedId,
  stableSeedKey,
} from './ids.js';
import type {
  LocalSeedConfig,
  LocalSeedPlan,
  SeedAllowlistRow,
  SeedAppSettingRow,
  SeedAssignmentRow,
  SeedCounts,
  SeedDailyMenuRow,
  SeedDelegationRow,
  SeedJsonValue,
  SeedLocationPolicyRow,
  SeedLocationRow,
  SeedMealDayRow,
  SeedMealEventRow,
  SeedMealServingRow,
  SeedMenuRevisionRow,
  SeedPenaltyRow,
  SeedPickupSessionRow,
  SeedRegistrationRow,
  SeedRole,
  SeedServingConfirmRequestRow,
  SeedServingVerificationRow,
  SeedUserRoleRow,
  SeedUserRow,
  SeedWeeklyMenuRow,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SECOND_MS = 1_000;
const FIXED_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const ROLE_NAMES: readonly SeedRole[] = ['staff', 'kitchen', 'admin'];
const LOCATION_CODES = ['LOCAL-A', 'LOCAL-B', 'LOCAL-C', 'LOCAL-D'] as const;
const LOCATION_COORDINATES: readonly [number, number][] = [
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
];

const EXPECTED_COUNTS: SeedCounts = {
  users: 50,
  userRoles: 56,
  locations: 4,
  locationPolicies: 4,
  assignments: 50,
  allowlists: 50,
  weeklyMenus: 1,
  dailyMenus: 7,
  mealDays: 7,
  menuRevisions: 7,
  registrations: 126,
  pendingDelegations: 4,
  acceptedDelegations: 4,
  completedDelegations: 8,
  penalties: 10,
  servingVerifications: 40,
  pickupSessions: 40,
  servingConfirmRequests: 40,
  mealServings: 40,
  mealEvents: 40,
  appSettings: 1,
};

const LOCATION_BY_CODE: Record<
  (typeof LOCATION_CODES)[number],
  {
    displayName: string;
    address: string;
  }
> = {
  'LOCAL-A': {
    displayName: 'Synthetic Cafeteria A',
    address: 'LOCAL-ONLY synthetic address A',
  },
  'LOCAL-B': {
    displayName: 'Synthetic Cafeteria B',
    address: 'LOCAL-ONLY synthetic address B',
  },
  'LOCAL-C': {
    displayName: 'Synthetic Cafeteria C',
    address: 'LOCAL-ONLY synthetic address C',
  },
  'LOCAL-D': {
    displayName: 'Synthetic Cafeteria D',
    address: 'LOCAL-ONLY synthetic address D',
  },
};

export class LocalSeedPlanError extends Error {
  readonly code = 'INVALID_PLAN' as const;

  constructor(
    readonly entity: string,
    readonly key: string,
    readonly reason: string,
  ) {
    super(`LocalSeedPlanError ${entity}/${key}: ${reason}`);
    this.name = 'LocalSeedPlanError';
  }
}

export function buildLocalSeedPlan(config: LocalSeedConfig): LocalSeedPlan {
  const normalizedBaseEmail = normalizeSeedEmail(config.baseEmail);
  const weekStart = parseDateOnly(config.weekStart, 'config', 'weekStart');
  const serveDate = parseDateOnly(config.serveDate, 'config', 'serveDate');
  assertMonday(weekStart, config.weekStart);
  const serveOffset = dayOffset(weekStart, serveDate);
  if (serveOffset < 0 || serveOffset > 6) {
    throw new LocalSeedPlanError('config', config.serveDate, 'serveDate is outside the selected week');
  }

  const normalizedConfig: LocalSeedConfig = {
    ...config,
    baseEmail: normalizedBaseEmail,
  };
  const { users, userRoles } = buildUsers(normalizedConfig);
  const { locations, locationPolicies, assignments } = buildLocations(normalizedConfig, users);
  const { weeklyMenu, dailyMenus, mealDays, menuRevisions } = buildMenu(normalizedConfig);
  const allowlists = buildAllowlists(normalizedConfig, users);
  const {
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
  } = buildRegistrations(normalizedConfig, users, assignments, menuRevisions);
  const appSettings: readonly SeedAppSettingRow[] = [
    {
      key: `isServingReady:${normalizedConfig.serveDate}`,
      value: 'true',
      version: 1,
    },
  ];

  const plan: LocalSeedPlan = {
    key: {
      baseEmail: normalizedBaseEmail,
      weekStart: normalizedConfig.weekStart,
      serveDate: normalizedConfig.serveDate,
    },
    counts: { ...EXPECTED_COUNTS },
    users,
    userRoles,
    locations,
    locationPolicies,
    assignments,
    allowlists,
    weeklyMenu,
    dailyMenus,
    mealDays,
    menuRevisions,
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
    appSettings,
  };

  assertLocalSeedPlan(plan);
  return plan;
}

export function assertLocalSeedPlan(plan: LocalSeedPlan): void {
  assertPlanCounts(plan);
  assertPlanKey(plan);
  assertPrimaryIds(plan);

  const usersById = indexRows(plan.users, 'users', (row) => row.id);
  const usersByEmail = indexRows(plan.users, 'users', (row) => row.email);
  const rolesByUser = assertRoles(plan, usersById);
  const staffUserIds = new Set(
    [...rolesByUser.entries()]
      .filter(([, roles]) => roles.includes('staff'))
      .map(([userId]) => userId),
  );
  const kitchenUserIds = new Set(
    [...rolesByUser.entries()]
      .filter(([, roles]) => roles.includes('kitchen'))
      .map(([userId]) => userId),
  );

  const locationsById = indexRows(plan.locations, 'locations', (row) => row.id);
  const locationsByCode = indexRows(plan.locations, 'locations', (row) => row.shortCode);
  assertLocations(plan, locationsById, locationsByCode);
  const policiesById = indexRows(plan.locationPolicies, 'locationPolicies', (row) => row.id);
  assertPolicies(plan, locationsById, policiesById);

  const assignmentsById = indexRows(plan.assignments, 'assignments', (row) => row.id);
  const assignmentsByUser = assertAssignments(plan, usersById, locationsById, assignmentsById);
  assertAllowlists(plan, usersById, usersByEmail);

  const dailyMenusById = assertMenus(plan);
  const revisionsById = indexRows(plan.menuRevisions, 'menuRevisions', (row) => row.id);
  assertMenuRevisions(plan, dailyMenusById, revisionsById);

  const registrationsById = indexRows(plan.registrations, 'registrations', (row) => row.id);
  const registrationsByUserAndDate = new Set<string>();
  assertRegistrations(
    plan,
    usersById,
    staffUserIds,
    locationsById,
    assignmentsById,
    assignmentsByUser,
    policiesById,
    registrationsById,
    registrationsByUserAndDate,
  );
  assertAppSettings(plan);

  const delegationsById = indexRows(plan.delegations, 'delegations', (row) => row.id);
  assertDelegations(plan, registrationsById, usersById, staffUserIds, delegationsById);
  assertPenalties(plan, registrationsById, usersById);
  assertServingGraph(
    plan,
    usersById,
    staffUserIds,
    kitchenUserIds,
    locationsById,
    policiesById,
    dailyMenusById,
    revisionsById,
    registrationsById,
    delegationsById,
  );
}

function buildUsers(config: LocalSeedConfig): {
  users: readonly SeedUserRow[];
  userRoles: readonly SeedUserRoleRow[];
} {
  const emails = generateSeedEmails(config.baseEmail);
  const users: SeedUserRow[] = [];
  const userRoles: SeedUserRoleRow[] = [];

  for (let ordinal = 0; ordinal < emails.length; ordinal += 1) {
    const roles = rolesForOrdinal(ordinal);
    const userKey = stableSeedKey(config.baseEmail, config.weekStart, 'user', ordinal);
    const userId = stableSeedId('user', userKey);
    const createdAt = seedInstant(userKey);
    users.push({
      id: userId,
      email: emails[ordinal],
      name: `Local Seed User ${String(ordinal + 1).padStart(3, '0')}`,
      isActive: true,
      notificationLocale: 'VI',
      remindersEnabled: true,
      roles,
      createdAt,
      updatedAt: createdAt,
    });
    for (const roleName of roles) {
      userRoles.push({ userId, roleName });
    }
  }

  return { users, userRoles };
}

function buildLocations(
  config: LocalSeedConfig,
  users: readonly SeedUserRow[],
): {
  locations: readonly SeedLocationRow[];
  locationPolicies: readonly SeedLocationPolicyRow[];
  assignments: readonly SeedAssignmentRow[];
} {
  const locations: SeedLocationRow[] = [];
  const locationPolicies: SeedLocationPolicyRow[] = [];
  const locationsByCode = new Map<string, SeedLocationRow>();

  for (const [index, shortCode] of LOCATION_CODES.entries()) {
    const locationKey = stableSeedKey(config.baseEmail, config.weekStart, 'location', shortCode);
    const locationId = stableSeedId('location', locationKey);
    const metadata: SeedJsonValue = {
      source: 'local-seed-only',
      synthetic: true,
      capacity: 'fixture-only',
    };
    const location: SeedLocationRow = {
      id: locationId,
      shortCode,
      displayName: LOCATION_BY_CODE[shortCode].displayName,
      servingPointName: `Synthetic Counter ${shortCode}`,
      address: LOCATION_BY_CODE[shortCode].address,
      building: 'SYNTHETIC',
      floor: '0',
      roomOrCounter: `Counter ${shortCode}`,
      localContact: 'local-seed-only',
      timeZone: TIME_ZONE,
      isActive: true,
      effectiveFrom: new Date(FIXED_EFFECTIVE_FROM),
      effectiveTo: null,
      operationalMetadata: metadata,
      holidayOverrides: { synthetic: true },
      capacityNotes: 'Synthetic local seed capacity only',
      accessibilityInstructions: 'Synthetic local seed accessibility only',
      emergencyInstructions: 'Synthetic local seed emergency instructions only',
      kitchenTeam: 'Synthetic local seed kitchen team',
      approvedScannerDeviceIds: [],
      networkNotes: 'Synthetic local seed network only',
      lastVerifiedBy: null,
      lastVerifiedAt: null,
      createdAt: seedInstant(locationKey),
    };
    locations.push(location);
    locationsByCode.set(shortCode, location);

    const policyKey = stableSeedKey(config.baseEmail, config.weekStart, 'location-policy', shortCode);
    const policyId = stableSeedId('location-policy', policyKey);
    const [latitude, longitude] = LOCATION_COORDINATES[index];
    locationPolicies.push({
      id: policyId,
      locationId,
      latitude,
      longitude,
      accuracySource: 'synthetic-local-seed',
      geofenceRadiusMeters: 150,
      maxFixAgeSeconds: 30,
      maxAccuracyMeters: 100,
      effectiveFrom: new Date(FIXED_EFFECTIVE_FROM),
      effectiveTo: null,
      isActive: true,
      createdAt: seedInstant(policyKey),
    });
  }

  const assignments: SeedAssignmentRow[] = [];
  for (const [ordinal, user] of users.entries()) {
    const shortCode = LOCATION_CODES[ordinal % LOCATION_CODES.length];
    const location = locationsByCode.get(shortCode);
    if (!location) {
      throw new LocalSeedPlanError('assignments', String(ordinal), 'location code is not defined');
    }
    const assignmentKey = stableSeedKey(config.baseEmail, config.weekStart, 'assignment', ordinal);
    const role = assignmentRoleForRoles(user.roles);
    assignments.push({
      id: stableSeedId('assignment', assignmentKey),
      userId: user.id,
      normalizedEmail: user.email,
      employeeName: user.name,
      employeeCode: seedEmployeeCode(ordinal + 1),
      isActive: true,
      role,
      serviceLocationCode: shortCode,
      locationId: location.id,
      effectiveFrom: new Date(FIXED_EFFECTIVE_FROM),
      effectiveTo: null,
      rosterImportBatchId: null,
      auditEventId: null,
      createdAt: seedInstant(assignmentKey),
    });
  }

  return { locations, locationPolicies, assignments };
}

function buildMenu(config: LocalSeedConfig): {
  weeklyMenu: SeedWeeklyMenuRow;
  dailyMenus: readonly SeedDailyMenuRow[];
  mealDays: readonly SeedMealDayRow[];
  menuRevisions: readonly SeedMenuRevisionRow[];
} {
  const weekStart = parseDateOnly(config.weekStart, 'menu', 'weekStart');
  const weeklyKey = stableSeedKey(config.baseEmail, config.weekStart, 'weekly-menu', 0);
  const weeklyMenu: SeedWeeklyMenuRow = {
    id: stableSeedId('weekly-menu', weeklyKey),
    startDate: new Date(weekStart),
    endDate: dateAtOffset(weekStart, 6),
    publishedAt: new Date(weekStart.getTime() - DAY_MS),
    createdAt: seedInstant(weeklyKey),
  };
  const dailyMenus: SeedDailyMenuRow[] = [];
  const mealDays: SeedMealDayRow[] = [];
  const menuRevisions: SeedMenuRevisionRow[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const date = dateAtOffset(weekStart, offset);
    const dateKey = date.toISOString().slice(0, 10);
    const dailyKey = stableSeedKey(config.baseEmail, config.weekStart, 'daily-menu', offset);
    const dailyMenuId = stableSeedId('daily-menu', dailyKey);
    dailyMenus.push({
      id: dailyMenuId,
      weeklyMenuId: weeklyMenu.id,
      date,
      isHoliday: false,
      isEnabled: true,
      createdAt: seedInstant(dailyKey),
    });

    const mealDayKey = stableSeedKey(config.baseEmail, config.weekStart, 'meal-day', offset);
    mealDays.push({
      id: stableSeedId('meal-day', mealDayKey),
      dailyMenuId,
      mealType: 'LUNCH',
      isServingReady: dateKey === config.serveDate,
      createdAt: seedInstant(mealDayKey),
    });

    const revisionKey = stableSeedKey(config.baseEmail, config.weekStart, 'menu-revision', offset);
    menuRevisions.push({
      id: stableSeedId('menu-revision', revisionKey),
      dailyMenuId,
      content: `Local synthetic menu ${dateKey}`,
      createdAt: seedInstant(revisionKey),
    });
  }

  return { weeklyMenu, dailyMenus, mealDays, menuRevisions };
}

function buildAllowlists(
  config: LocalSeedConfig,
  users: readonly SeedUserRow[],
): readonly SeedAllowlistRow[] {
  return users.map((user, ordinal) => {
    const key = stableSeedKey(config.baseEmail, config.weekStart, 'otp-allowlist', ordinal);
    return {
      id: stableSeedId('otp-allowlist', key),
      normalizedEmail: user.email,
      userId: user.id,
      state: 'ACTIVE',
      purpose: 'SESSION_LOGIN',
      effectiveFrom: new Date(FIXED_EFFECTIVE_FROM),
      effectiveTo: null,
      reason: 'local-seed-only',
      createdBy: null,
      updatedBy: null,
      createdAt: seedInstant(key),
    };
  });
}

function buildRegistrations(
  config: LocalSeedConfig,
  users: readonly SeedUserRow[],
  assignments: readonly SeedAssignmentRow[],
  menuRevisions: readonly SeedMenuRevisionRow[],
): {
  registrations: readonly SeedRegistrationRow[];
  delegations: readonly SeedDelegationRow[];
  penalties: readonly SeedPenaltyRow[];
  servingVerifications: readonly SeedServingVerificationRow[];
  pickupSessions: readonly SeedPickupSessionRow[];
  servingConfirmRequests: readonly SeedServingConfirmRequestRow[];
  mealServings: readonly SeedMealServingRow[];
  mealEvents: readonly SeedMealEventRow[];
} {
  const weekStart = parseDateOnly(config.weekStart, 'registrations', 'weekStart');
  const usersById = new Map(users.map((user) => [user.id, user]));
  const assignmentsByUser = new Map(assignments.map((assignment) => [assignment.userId, assignment]));
  const owners = users.filter((user) => user.roles.includes('staff'));
  const registrations: SeedRegistrationRow[] = [];
  const penalties: SeedPenaltyRow[] = [];

  for (const [ownerOrdinal, owner] of owners.entries()) {
    const assignment = assignmentsByUser.get(owner.id);
    if (!assignment) {
      throw new LocalSeedPlanError('registrations', owner.id, 'owner has no location assignment');
    }
    const location = locationDetails(assignment.serviceLocationCode);
    for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
      const ordinal = ownerOrdinal * 3 + dayOffset;
      const registrationKey = stableSeedKey(config.baseEmail, config.weekStart, 'registration', ordinal);
      const mealDate = dateAtOffset(weekStart, dayOffset);
      const status = statusForOrdinal(ordinal);
      const registration: SeedRegistrationRow = {
        id: stableSeedId('registration', registrationKey),
        userId: owner.id,
        mealDate,
        status,
        mealChoice: ordinal % 4 === 0 ? 'VEGETARIAN' : 'REGULAR',
        serviceLocationId: assignment.locationId,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: assignment.serviceLocationCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: new Date(assignment.effectiveFrom),
        serviceLocationSnapshotAt: new Date(weekStart),
        createdAt: seedInstant(registrationKey),
        updatedAt: seedInstant(registrationKey),
        version: 1,
      };
      registrations.push(registration);

      if (status === 'NO_SHOW') {
        const penaltyKey = stableSeedKey(config.baseEmail, config.weekStart, 'penalty', ordinal);
        penalties.push({
          id: stableSeedId('penalty', penaltyKey),
          userId: owner.id,
          amount: 50_000,
          reason: `NO_SHOW_PENALTY_${mealDate.toISOString().slice(0, 10)}_${registration.id}`,
          status: 'PENDING',
          paidAt: null,
          waivedAt: null,
          waiveReason: null,
          waivedByUserId: null,
          createdAt: seedInstant(penaltyKey),
        });
      }
    }
  }

  const delegations: SeedDelegationRow[] = [];
  for (let index = 0; index < 8; index += 1) {
    const registration = registrations[index];
    const ownerOrdinal = owners.findIndex((owner) => owner.id === registration.userId);
    const delegate = owners[(ownerOrdinal + index + 1) % owners.length];
    const key = stableSeedKey(config.baseEmail, config.weekStart, 'delegation-active', index);
    delegations.push({
      id: stableSeedId('delegation', key),
      registrationId: registration.id,
      delegateUserId: delegate.id,
      status: index < 4 ? 'PENDING' : 'ACCEPTED',
      createdAt: seedInstant(key),
      updatedAt: seedInstant(key),
    });
  }

  const servedRegistrations = registrations.filter((registration) => registration.status === 'SERVED');
  const completedDelegationByRegistration = new Map<string, SeedDelegationRow>();
  for (let index = 0; index < 8; index += 1) {
    const registration = servedRegistrations[32 + index];
    const ownerOrdinal = owners.findIndex((owner) => owner.id === registration.userId);
    const delegate = owners[(ownerOrdinal + index + 1) % owners.length];
    const key = stableSeedKey(config.baseEmail, config.weekStart, 'delegation-completed', index);
    const delegation: SeedDelegationRow = {
      id: stableSeedId('delegation', key),
      registrationId: registration.id,
      delegateUserId: delegate.id,
      status: 'COMPLETED',
      createdAt: seedInstant(key),
      updatedAt: seedInstant(key),
    };
    delegations.push(delegation);
    completedDelegationByRegistration.set(registration.id, delegation);
  }

  const servingVerifications: SeedServingVerificationRow[] = [];
  const pickupSessions: SeedPickupSessionRow[] = [];
  const servingConfirmRequests: SeedServingConfirmRequestRow[] = [];
  const mealServings: SeedMealServingRow[] = [];
  const mealEvents: SeedMealEventRow[] = [];
  const kitchenUser = users.find(
    (user) => user.roles.length === 1 && user.roles[0] === 'kitchen',
  );
  if (!kitchenUser) {
    throw new LocalSeedPlanError('mealServings', 'kitchen', 'kitchen-only user is missing');
  }

  for (const [servedOrdinal, registration] of servedRegistrations.entries()) {
    const owner = usersById.get(registration.userId);
    const assignment = assignmentsByUser.get(registration.userId);
    if (!owner || !assignment) {
      throw new LocalSeedPlanError('mealServings', registration.id, 'owner graph is incomplete');
    }
    const completedDelegation = completedDelegationByRegistration.get(registration.id);
    const isProxy = Boolean(completedDelegation);
    const presenterUserId = completedDelegation?.delegateUserId ?? owner.id;
    const location = locationDetails(registration.serviceLocationCode);
    const servingKey = stableSeedKey(config.baseEmail, config.weekStart, 'meal-serving', servedOrdinal);
    const servingId = stableSeedId('meal-serving', servingKey);
    const verificationKey = stableSeedKey(
      config.baseEmail,
      config.weekStart,
      'serving-verification',
      servedOrdinal,
    );
    const sessionKey = stableSeedKey(config.baseEmail, config.weekStart, 'pickup-session', servedOrdinal);
    const requestKey = stableSeedKey(
      config.baseEmail,
      config.weekStart,
      'serving-confirm-request',
      servedOrdinal,
    );
    const servedAt = servingTime(registration.mealDate, servedOrdinal);
    const capturedAt = new Date(servedAt.getTime() - 5 * SECOND_MS);
    const verifiedAt = new Date(servedAt.getTime() - 3 * SECOND_MS);
    const retentionUntil = new Date(servedAt.getTime() + 365 * DAY_MS);
    const intentHash = seedHash(stableSeedKey(config.baseEmail, config.weekStart, 'serving-intent', servedOrdinal));
    const intentNonce = seedHash(stableSeedKey(config.baseEmail, config.weekStart, 'serving-nonce', servedOrdinal));
    const qrHash = seedHash(stableSeedKey(config.baseEmail, config.weekStart, 'serving-qr', servedOrdinal));
    const verificationId = stableSeedId('serving-verification', verificationKey);
    const pickupSessionId = stableSeedId('pickup-session', sessionKey);
    const requestId = stableSeedId('serving-confirm-request', requestKey);
    const registrationIds = [registration.id].sort();
    const policyKey = stableSeedKey(
      config.baseEmail,
      config.weekStart,
      'location-policy',
      registration.serviceLocationCode,
    );
    const policyId = stableSeedId('location-policy', policyKey);

    servingVerifications.push({
      id: verificationId,
      presenterUserId,
      locationId: registration.serviceLocationId,
      locationPolicyId: policyId,
      result: 'VALID',
      capturedAt,
      verifiedAt,
      accuracyMeters: 5,
      safeVerificationCode: 'GPS_VALID',
      intentNonce,
      retentionUntil,
      createdAt: new Date(capturedAt),
    });
    pickupSessions.push({
      id: pickupSessionId,
      userId: owner.id,
      presenterUserId,
      mealDate: new Date(registration.mealDate),
      registrationIds,
      intentRegistrationIds: [...registrationIds],
      intentHash,
      intentNonce,
      qrHash,
      locationId: registration.serviceLocationId,
      servingVerificationId: verificationId,
      expiresAt: new Date(servedAt.getTime() + 30 * SECOND_MS),
      consumedAt: new Date(servedAt),
      createdAt: new Date(capturedAt),
    });
    servingConfirmRequests.push({
      id: requestId,
      callerUserId: presenterUserId,
      idempotencyKey: `local-seed-confirm-${servedOrdinal}`,
      status: 'SUCCESS',
      requestBodyHash: seedHash(stableSeedKey(config.baseEmail, config.weekStart, 'request-body', servedOrdinal)),
      intentHash,
      pickupSessionId,
      resultServingIds: [servingId],
      resultSnapshot: {
        status: 'SUCCESS',
        registrationIds,
        servingIds: [servingId],
      },
      originalResultRequestId: null,
      completedAt: new Date(servedAt),
      createdAt: new Date(capturedAt),
    });
    mealServings.push({
      id: servingId,
      registrationId: registration.id,
      ownerUserId: owner.id,
      ownerEmailSnapshot: owner.email,
      ownerNameSnapshot: owner.name,
      presenterUserId,
      receiverType: isProxy ? 'PROXY' : 'SELF',
      kitchenUserId: kitchenUser.id,
      kitchenPermissionContext: 'kitchen.serve',
      scannerDeviceId: null,
      locationId: registration.serviceLocationId,
      locationShortCode: registration.serviceLocationCode,
      locationNameSnapshot: location.displayName,
      locationAddressSnapshot: location.address,
      mealDate: new Date(registration.mealDate),
      menuRevisionId: menuRevisions[dayOffsetForRegistration(weekStart, registration.mealDate)].id,
      requestId,
      pickupSessionId,
      intentHash,
      verificationOutcome: 'VALID',
      servingVerificationId: verificationId,
      delegationId: completedDelegation?.id ?? null,
      servedAt: new Date(servedAt),
    });
    mealEvents.push({
      id: stableSeedId('meal-event', servingKey),
      mealServingId: servingId,
      eventType: 'PICKUP_CONFIRMED',
      createdAt: new Date(servedAt),
    });
  }

  return {
    registrations,
    delegations,
    penalties,
    servingVerifications,
    pickupSessions,
    servingConfirmRequests,
    mealServings,
    mealEvents,
  };
}

function assertPlanCounts(plan: LocalSeedPlan): void {
  const actualCounts: Record<string, number> = {
    users: plan.users.length,
    userRoles: plan.userRoles.length,
    locations: plan.locations.length,
    locationPolicies: plan.locationPolicies.length,
    assignments: plan.assignments.length,
    allowlists: plan.allowlists.length,
    weeklyMenus: 1,
    dailyMenus: plan.dailyMenus.length,
    mealDays: plan.mealDays.length,
    menuRevisions: plan.menuRevisions.length,
    registrations: plan.registrations.length,
    pendingDelegations: plan.delegations.filter((row) => row.status === 'PENDING').length,
    acceptedDelegations: plan.delegations.filter((row) => row.status === 'ACCEPTED').length,
    completedDelegations: plan.delegations.filter((row) => row.status === 'COMPLETED').length,
    penalties: plan.penalties.length,
    servingVerifications: plan.servingVerifications.length,
    pickupSessions: plan.pickupSessions.length,
    servingConfirmRequests: plan.servingConfirmRequests.length,
    mealServings: plan.mealServings.length,
    mealEvents: plan.mealEvents.length,
    appSettings: plan.appSettings.length,
  };
  for (const key of Object.keys(EXPECTED_COUNTS) as (keyof SeedCounts)[]) {
    if (actualCounts[key] !== EXPECTED_COUNTS[key]) {
      throw new LocalSeedPlanError(key, key, `expected ${EXPECTED_COUNTS[key]}, got ${actualCounts[key]}`);
    }
    if (plan.counts[key] !== EXPECTED_COUNTS[key]) {
      throw new LocalSeedPlanError('counts', key, `expected ${EXPECTED_COUNTS[key]}, got ${plan.counts[key]}`);
    }
  }
}

function assertPlanKey(plan: LocalSeedPlan): void {
  const normalizedEmail = normalizeSeedEmail(plan.key.baseEmail);
  if (normalizedEmail !== plan.key.baseEmail) {
    throw new LocalSeedPlanError('key', 'baseEmail', 'base email is not normalized');
  }
  const weekStart = parseDateOnly(plan.key.weekStart, 'key', 'weekStart');
  const serveDate = parseDateOnly(plan.key.serveDate, 'key', 'serveDate');
  assertMonday(weekStart, plan.key.weekStart);
  const serveOffset = dayOffset(weekStart, serveDate);
  if (serveOffset < 0 || serveOffset > 6) {
    throw new LocalSeedPlanError('key', 'serveDate', 'serveDate is outside the selected week');
  }
}

function assertPrimaryIds(plan: LocalSeedPlan): void {
  if (!plan.weeklyMenu.id) {
    throw new LocalSeedPlanError('weeklyMenu', '<empty>', 'primary ID is empty');
  }
  indexRows(plan.users, 'users', (row) => row.id);
  indexRows(plan.locations, 'locations', (row) => row.id);
  indexRows(plan.locationPolicies, 'locationPolicies', (row) => row.id);
  indexRows(plan.assignments, 'assignments', (row) => row.id);
  indexRows(plan.allowlists, 'allowlists', (row) => row.id);
  indexRows(plan.dailyMenus, 'dailyMenus', (row) => row.id);
  indexRows(plan.mealDays, 'mealDays', (row) => row.id);
  indexRows(plan.menuRevisions, 'menuRevisions', (row) => row.id);
  indexRows(plan.registrations, 'registrations', (row) => row.id);
  indexRows(plan.delegations, 'delegations', (row) => row.id);
  indexRows(plan.penalties, 'penalties', (row) => row.id);
  indexRows(plan.servingVerifications, 'servingVerifications', (row) => row.id);
  indexRows(plan.pickupSessions, 'pickupSessions', (row) => row.id);
  indexRows(plan.servingConfirmRequests, 'servingConfirmRequests', (row) => row.id);
  indexRows(plan.mealServings, 'mealServings', (row) => row.id);
  indexRows(plan.mealEvents, 'mealEvents', (row) => row.id);
}

function assertRoles(
  plan: LocalSeedPlan,
  usersById: ReadonlyMap<string, SeedUserRow>,
): Map<string, SeedRole[]> {
  const rolesByUser = new Map<string, SeedRole[]>();
  for (const user of plan.users) {
    if (!user.email || !user.name || !user.isActive) {
      throw new LocalSeedPlanError('users', user.id, 'synthetic user profile is incomplete');
    }
    if (!usersById.has(user.id)) {
      throw new LocalSeedPlanError('users', user.id, 'user index is incomplete');
    }
    const roles = user.roles;
    if (roles.length === 0 || new Set(roles).size !== roles.length) {
      throw new LocalSeedPlanError('users', user.id, 'role list is empty or duplicated');
    }
    for (const role of roles) {
      if (!ROLE_NAMES.includes(role)) {
        throw new LocalSeedPlanError('users', user.id, `invalid role ${String(role)}`);
      }
    }
  }
  for (const row of plan.userRoles) {
    if (!usersById.has(row.userId)) {
      throw new LocalSeedPlanError('userRoles', row.userId, 'userId is outside the plan');
    }
    if (!ROLE_NAMES.includes(row.roleName)) {
      throw new LocalSeedPlanError('userRoles', row.userId, `invalid role ${String(row.roleName)}`);
    }
    const roles = rolesByUser.get(row.userId) ?? [];
    if (roles.includes(row.roleName)) {
      throw new LocalSeedPlanError('userRoles', `${row.userId}:${row.roleName}`, 'duplicate role key');
    }
    roles.push(row.roleName);
    rolesByUser.set(row.userId, roles);
  }

  const cohorts = { staff: 0, kitchen: 0, staffKitchen: 0, admin: 0, adminStaff: 0 };
  for (const user of plan.users) {
    const rowRoles = rolesByUser.get(user.id) ?? [];
    if (rowRoles.length !== user.roles.length || rowRoles.some((role) => !user.roles.includes(role))) {
      throw new LocalSeedPlanError('userRoles', user.id, 'role rows do not inherit the user role matrix');
    }
    const sorted = [...rowRoles].sort().join(',');
    if (sorted === 'staff') cohorts.staff += 1;
    else if (sorted === 'kitchen') cohorts.kitchen += 1;
    else if (sorted === 'kitchen,staff') cohorts.staffKitchen += 1;
    else if (sorted === 'admin') cohorts.admin += 1;
    else if (sorted === 'admin,staff') cohorts.adminStaff += 1;
    else throw new LocalSeedPlanError('userRoles', user.id, `invalid role inheritance ${sorted}`);
  }
  if (cohorts.staff !== 36 || cohorts.kitchen !== 6 || cohorts.staffKitchen !== 5 || cohorts.admin !== 2 || cohorts.adminStaff !== 1) {
    throw new LocalSeedPlanError('userRoles', 'cohorts', 'role cohort counts are invalid');
  }
  return rolesByUser;
}

function assertLocations(
  plan: LocalSeedPlan,
  locationsById: ReadonlyMap<string, SeedLocationRow>,
  locationsByCode: ReadonlyMap<string, SeedLocationRow>,
): void {
  if (plan.locations.map((row) => row.shortCode).join(',') !== LOCATION_CODES.join(',')) {
    throw new LocalSeedPlanError('locations', 'codes', 'synthetic location codes are invalid');
  }
  for (const [index, code] of LOCATION_CODES.entries()) {
    const location = locationsByCode.get(code);
    if (!location || !locationsById.has(location.id)) {
      throw new LocalSeedPlanError('locations', code, 'location is outside the plan');
    }
    if (
      location.displayName !== LOCATION_BY_CODE[code].displayName ||
      location.address !== LOCATION_BY_CODE[code].address ||
      location.servingPointName !== `Synthetic Counter ${code}` ||
      location.building !== 'SYNTHETIC' ||
      location.floor !== '0' ||
      location.localContact !== 'local-seed-only' ||
      location.timeZone !== TIME_ZONE ||
      !location.isActive ||
      location.effectiveTo !== null ||
      !sameInstant(location.effectiveFrom, FIXED_EFFECTIVE_FROM) ||
      location.approvedScannerDeviceIds.length !== 0
    ) {
      throw new LocalSeedPlanError('locations', code, 'synthetic location fields are invalid');
    }
    const [latitude, longitude] = LOCATION_COORDINATES[index];
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new LocalSeedPlanError('locations', code, 'location coordinate is not finite');
    }
  }
}

function assertPolicies(
  plan: LocalSeedPlan,
  locationsById: ReadonlyMap<string, SeedLocationRow>,
  policiesById: ReadonlyMap<string, SeedLocationPolicyRow>,
): void {
  const policiesByLocation = new Set<string>();
  for (const policy of plan.locationPolicies) {
    if (!locationsById.has(policy.locationId)) {
      throw new LocalSeedPlanError('locationPolicies', policy.id, 'locationId is outside the plan');
    }
    if (policiesByLocation.has(policy.locationId)) {
      throw new LocalSeedPlanError('locationPolicies', policy.locationId, 'duplicate active policy');
    }
    policiesByLocation.add(policy.locationId);
    const location = locationsById.get(policy.locationId);
    const locationIndex = location
      ? LOCATION_CODES.indexOf(location.shortCode as (typeof LOCATION_CODES)[number])
      : -1;
    const expectedCoordinates = locationIndex >= 0 ? LOCATION_COORDINATES[locationIndex] : undefined;
    if (
      !location ||
      !expectedCoordinates ||
      !Number.isFinite(policy.latitude) ||
      !Number.isFinite(policy.longitude) ||
      policy.latitude !== expectedCoordinates[0] ||
      policy.longitude !== expectedCoordinates[1] ||
      policy.latitude < -90 ||
      policy.latitude > 90 ||
      policy.longitude < -180 ||
      policy.longitude > 180 ||
      !Number.isFinite(policy.maxAccuracyMeters) ||
      !Number.isInteger(policy.geofenceRadiusMeters) ||
      policy.geofenceRadiusMeters <= 0 ||
      !Number.isInteger(policy.maxFixAgeSeconds) ||
      policy.maxFixAgeSeconds < 0 ||
      policy.maxAccuracyMeters < 0 ||
      !policy.isActive ||
      policy.effectiveTo !== null ||
      !sameInstant(policy.effectiveFrom, FIXED_EFFECTIVE_FROM) ||
      policy.accuracySource !== 'synthetic-local-seed'
    ) {
      throw new LocalSeedPlanError('locationPolicies', policy.id, 'policy values are invalid');
    }
  }
  for (const location of locationsById.values()) {
    if (!policiesByLocation.has(location.id)) {
      throw new LocalSeedPlanError('locationPolicies', location.id, 'effective policy is missing');
    }
  }
  if (policiesById.size !== plan.locationPolicies.length) {
    throw new LocalSeedPlanError('locationPolicies', 'ids', 'policy IDs are duplicated');
  }
}

function assertAssignments(
  plan: LocalSeedPlan,
  usersById: ReadonlyMap<string, SeedUserRow>,
  locationsById: ReadonlyMap<string, SeedLocationRow>,
  assignmentsById: ReadonlyMap<string, SeedAssignmentRow>,
): Map<string, SeedAssignmentRow> {
  const assignmentsByUser = new Map<string, SeedAssignmentRow>();
  const employeeCodes = new Set<string>();
  for (const assignment of plan.assignments) {
    const user = usersById.get(assignment.userId);
    if (!user) {
      throw new LocalSeedPlanError('assignments', assignment.id, 'userId is outside the plan');
    }
    const location = locationsById.get(assignment.locationId);
    if (!location) {
      throw new LocalSeedPlanError('assignments', assignment.id, 'locationId is outside the plan');
    }
    if (assignmentsByUser.has(assignment.userId)) {
      throw new LocalSeedPlanError('assignments', assignment.userId, 'user has duplicate assignments');
    }
    if (employeeCodes.has(assignment.employeeCode)) {
      throw new LocalSeedPlanError('assignments', assignment.employeeCode, 'employee code is duplicated');
    }
    employeeCodes.add(assignment.employeeCode);
    if (
      !assignment.isActive ||
      assignment.effectiveTo !== null ||
      assignment.rosterImportBatchId !== null ||
      assignment.auditEventId !== null ||
      !sameInstant(assignment.effectiveFrom, FIXED_EFFECTIVE_FROM) ||
      !/^LOCAL-EMP-\d{4}$/.test(assignment.employeeCode) ||
      assignment.normalizedEmail !== user.email ||
      assignment.employeeName !== user.name ||
      assignment.role !== assignmentRoleForRoles(user.roles) ||
      assignment.normalizedEmail.length === 0 ||
      assignment.employeeName.length === 0
    ) {
      throw new LocalSeedPlanError('assignments', assignment.id, 'assignment values are invalid');
    }
    if (location.shortCode !== assignment.serviceLocationCode) {
      throw new LocalSeedPlanError('assignments', assignment.id, 'location code does not match locationId');
    }
    assignmentsByUser.set(assignment.userId, assignment);
  }
  if (assignmentsById.size !== plan.assignments.length || assignmentsByUser.size !== plan.users.length) {
    throw new LocalSeedPlanError('assignments', 'users', 'exactly one assignment per user is required');
  }
  return assignmentsByUser;
}

function assertAllowlists(
  plan: LocalSeedPlan,
  usersById: ReadonlyMap<string, SeedUserRow>,
  usersByEmail: ReadonlyMap<string, SeedUserRow>,
): void {
  const emailKeys = new Set<string>();
  const userIds = new Set<string>();
  for (const row of plan.allowlists) {
    if (!usersById.has(row.userId) || usersByEmail.get(row.normalizedEmail)?.id !== row.userId) {
      throw new LocalSeedPlanError('allowlists', row.id, 'allowlist user reference is outside the plan');
    }
    if (userIds.has(row.userId)) {
      throw new LocalSeedPlanError('allowlists', row.userId, 'user has duplicate allowlist rows');
    }
    userIds.add(row.userId);
    const key = `${row.normalizedEmail}:${row.purpose}`;
    if (emailKeys.has(key)) {
      throw new LocalSeedPlanError('allowlists', key, 'allowlist key is duplicated');
    }
    emailKeys.add(key);
    if (
      row.state !== 'ACTIVE' ||
      row.purpose !== 'SESSION_LOGIN' ||
      !sameInstant(row.effectiveFrom, FIXED_EFFECTIVE_FROM) ||
      row.effectiveTo !== null
    ) {
      throw new LocalSeedPlanError('allowlists', row.id, 'allowlist state or effective interval is invalid');
    }
  }
  if (userIds.size !== usersById.size) {
    throw new LocalSeedPlanError('allowlists', 'users', 'every user needs exactly one allowlist row');
  }
}

function assertAppSettings(plan: LocalSeedPlan): void {
  if (
    plan.appSettings.length !== 1 ||
    plan.appSettings[0].key !== `isServingReady:${plan.key.serveDate}` ||
    plan.appSettings[0].value !== 'true' ||
    plan.appSettings[0].version !== 1
  ) {
    throw new LocalSeedPlanError('appSettings', plan.key.serveDate, 'serving-ready setting is invalid');
  }
}

function assertMenus(plan: LocalSeedPlan): Map<string, SeedDailyMenuRow> {
  const weekStart = parseDateOnly(plan.key.weekStart, 'menus', 'weekStart');
  const serveDate = parseDateOnly(plan.key.serveDate, 'menus', 'serveDate');
  assertDateOnly(plan.weeklyMenu.startDate, 'weeklyMenu', 'startDate');
  assertDateOnly(plan.weeklyMenu.endDate, 'weeklyMenu', 'endDate');
  if (
    !(plan.weeklyMenu.publishedAt instanceof Date) ||
    !Number.isFinite(plan.weeklyMenu.publishedAt.getTime()) ||
    !sameInstant(plan.weeklyMenu.startDate, weekStart) ||
    !sameInstant(plan.weeklyMenu.endDate, dateAtOffset(weekStart, 6)) ||
    plan.weeklyMenu.publishedAt.getTime() >= weekStart.getTime()
  ) {
    throw new LocalSeedPlanError('weeklyMenu', plan.weeklyMenu.id, 'weekly menu dates are invalid');
  }
  const dailyMenusById = indexRows(plan.dailyMenus, 'dailyMenus', (row) => row.id);
  const dates = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = dateAtOffset(weekStart, offset);
    const dailyMenu = plan.dailyMenus[offset];
    if (dailyMenu) {
      assertDateOnly(dailyMenu.date, 'dailyMenus', dailyMenu.id);
    }
    if (
      !dailyMenu ||
      dailyMenu.weeklyMenuId !== plan.weeklyMenu.id ||
      !sameInstant(dailyMenu.date, date) ||
      dailyMenu.isHoliday ||
      !dailyMenu.isEnabled
    ) {
      throw new LocalSeedPlanError('dailyMenus', String(offset), 'daily menu date graph is invalid');
    }
    const dateKey = dailyMenu.date.toISOString().slice(0, 10);
    if (dates.has(dateKey)) {
      throw new LocalSeedPlanError('dailyMenus', dateKey, 'daily menu date is duplicated');
    }
    dates.add(dateKey);
  }
  const readyMealDays = plan.mealDays.filter((row) => row.isServingReady);
  if (readyMealDays.length !== 1) {
    throw new LocalSeedPlanError('mealDays', 'serving-ready', 'exactly one serving-ready day is required');
  }
  const mealDaysByDailyMenu = new Set<string>();
  for (const mealDay of plan.mealDays) {
    if (
      !dailyMenusById.has(mealDay.dailyMenuId) ||
      mealDaysByDailyMenu.has(mealDay.dailyMenuId) ||
      mealDay.mealType !== 'LUNCH'
    ) {
      throw new LocalSeedPlanError('mealDays', mealDay.id, 'meal day reference, uniqueness, or type is invalid');
    }
    mealDaysByDailyMenu.add(mealDay.dailyMenuId);
    const dailyMenu = dailyMenusById.get(mealDay.dailyMenuId)!;
    if (mealDay.isServingReady !== sameInstant(dailyMenu.date, serveDate)) {
      throw new LocalSeedPlanError('mealDays', mealDay.id, 'serving-ready date is invalid');
    }
  }
  if (mealDaysByDailyMenu.size !== dailyMenusById.size) {
    throw new LocalSeedPlanError('mealDays', 'dailyMenus', 'one meal day per daily menu is required');
  }
  return dailyMenusById;
}

function assertMenuRevisions(
  plan: LocalSeedPlan,
  dailyMenusById: ReadonlyMap<string, SeedDailyMenuRow>,
  revisionsById: ReadonlyMap<string, SeedMenuRevisionRow>,
): void {
  const revisionDailyMenus = new Set<string>();
  for (const revision of plan.menuRevisions) {
    const dailyMenu = dailyMenusById.get(revision.dailyMenuId);
    if (!dailyMenu || !revision.content.startsWith('Local synthetic menu ')) {
      throw new LocalSeedPlanError('menuRevisions', revision.id, 'menu revision is invalid');
    }
    if (revisionDailyMenus.has(revision.dailyMenuId)) {
      throw new LocalSeedPlanError('menuRevisions', revision.dailyMenuId, 'daily menu has duplicate revisions');
    }
    revisionDailyMenus.add(revision.dailyMenuId);
  }
  if (revisionDailyMenus.size !== dailyMenusById.size || revisionsById.size !== plan.menuRevisions.length) {
    throw new LocalSeedPlanError('menuRevisions', 'dailyMenus', 'one revision per daily menu is required');
  }
}

function assertRegistrations(
  plan: LocalSeedPlan,
  usersById: ReadonlyMap<string, SeedUserRow>,
  staffUserIds: ReadonlySet<string>,
  locationsById: ReadonlyMap<string, SeedLocationRow>,
  assignmentsById: ReadonlyMap<string, SeedAssignmentRow>,
  assignmentsByUser: ReadonlyMap<string, SeedAssignmentRow>,
  policiesById: ReadonlyMap<string, SeedLocationPolicyRow>,
  registrationsById: ReadonlyMap<string, SeedRegistrationRow>,
  registrationsByUserAndDate: Set<string>,
): void {
  const weekStart = parseDateOnly(plan.key.weekStart, 'registrations', 'weekStart');
  const counts = { ACTIVE: 0, SERVED: 0, CANCELLED: 0, NO_SHOW: 0 };
  for (const [ordinal, registration] of plan.registrations.entries()) {
    assertDateOnly(registration.mealDate, 'registrations', registration.id);
    if (!usersById.has(registration.userId) || !staffUserIds.has(registration.userId)) {
      throw new LocalSeedPlanError('registrations', registration.id, 'registration owner is outside staff-capable users');
    }
    const assignment = assignmentsById.get(registration.serviceLocationAssignmentId);
    const location = locationsById.get(registration.serviceLocationId);
    const policy = [...policiesById.values()].find(
      (candidate) => candidate.locationId === registration.serviceLocationId,
    );
    if (
      !assignment ||
      !location ||
      !policy ||
      assignment.userId !== registration.userId ||
      assignment.locationId !== registration.serviceLocationId ||
      assignment.serviceLocationCode !== registration.serviceLocationCode
    ) {
      throw new LocalSeedPlanError('registrations', registration.id, 'location assignment reference is outside the plan');
    }
    if (
      !(registration.mealDate instanceof Date) ||
      !Number.isFinite(registration.mealDate.getTime()) ||
      !sameInstant(registration.serviceLocationEffectiveFrom, assignment.effectiveFrom) ||
      !sameInstant(registration.serviceLocationSnapshotAt, weekStart) ||
      registration.serviceLocationName !== location.displayName ||
      registration.serviceLocationAddress !== location.address ||
      !isEffective(assignment.effectiveFrom, assignment.effectiveTo, registration.mealDate) ||
      !isEffective(location.effectiveFrom, location.effectiveTo, registration.mealDate) ||
      !isEffective(policy.effectiveFrom, policy.effectiveTo, registration.mealDate)
    ) {
      throw new LocalSeedPlanError('registrations', registration.id, 'location snapshot is not effective');
    }
    const ownerAssignment = assignmentsByUser.get(registration.userId);
    if (ownerAssignment?.id !== assignment.id) {
      throw new LocalSeedPlanError('registrations', registration.id, 'owner assignment is ambiguous');
    }
    const mealDateOffset = dayOffset(weekStart, registration.mealDate);
    if (mealDateOffset < 0 || mealDateOffset > 2) {
      throw new LocalSeedPlanError('registrations', registration.id, 'registration date is outside the first three week dates');
    }
    if (!['ACTIVE', 'SERVED', 'CANCELLED', 'NO_SHOW'].includes(registration.status)) {
      throw new LocalSeedPlanError('registrations', registration.id, `invalid status ${String(registration.status)}`);
    }
    if (!['REGULAR', 'VEGETARIAN'].includes(registration.mealChoice)) {
      throw new LocalSeedPlanError('registrations', registration.id, `invalid meal choice ${String(registration.mealChoice)}`);
    }
    if (
      registration.status !== statusForOrdinal(ordinal) ||
      registration.mealChoice !== (ordinal % 4 === 0 ? 'VEGETARIAN' : 'REGULAR')
    ) {
      throw new LocalSeedPlanError('registrations', registration.id, 'ordinal status or meal choice rule is invalid');
    }
    counts[registration.status] += 1;
    const pairKey = `${registration.userId}:${registration.mealDate.toISOString().slice(0, 10)}`;
    if (registrationsByUserAndDate.has(pairKey)) {
      throw new LocalSeedPlanError('registrations', pairKey, 'user/date registration key is duplicated');
    }
    registrationsByUserAndDate.add(pairKey);
  }
  if (counts.ACTIVE !== 60 || counts.SERVED !== 40 || counts.CANCELLED !== 16 || counts.NO_SHOW !== 10) {
    throw new LocalSeedPlanError('registrations', 'statuses', 'registration status distribution is invalid');
  }
  if (registrationsById.size !== plan.registrations.length) {
    throw new LocalSeedPlanError('registrations', 'ids', 'registration IDs are duplicated');
  }
}

function assertDelegations(
  plan: LocalSeedPlan,
  registrationsById: ReadonlyMap<string, SeedRegistrationRow>,
  usersById: ReadonlyMap<string, SeedUserRow>,
  staffUserIds: ReadonlySet<string>,
  delegationsById: ReadonlyMap<string, SeedDelegationRow>,
): void {
  const activeDelegationsByRegistration = new Set<string>();
  const delegationStatuses = { PENDING: 0, ACCEPTED: 0, COMPLETED: 0 };
  for (const delegation of plan.delegations) {
    const registration = registrationsById.get(delegation.registrationId);
    if (!registration || !usersById.has(delegation.delegateUserId) || !staffUserIds.has(delegation.delegateUserId)) {
      throw new LocalSeedPlanError('delegations', delegation.id, 'delegation reference is outside the plan');
    }
    if (registration.userId === delegation.delegateUserId) {
      throw new LocalSeedPlanError('delegations', delegation.id, 'delegation target must differ from owner');
    }
    if (delegation.status === 'PENDING' || delegation.status === 'ACCEPTED') {
      delegationStatuses[delegation.status] += 1;
      if (registration.status !== 'ACTIVE' || activeDelegationsByRegistration.has(registration.id)) {
        throw new LocalSeedPlanError('delegations', delegation.id, 'active delegation relationship is invalid');
      }
      activeDelegationsByRegistration.add(registration.id);
    } else if (delegation.status === 'COMPLETED') {
      delegationStatuses.COMPLETED += 1;
      if (registration.status !== 'SERVED') {
        throw new LocalSeedPlanError('delegations', delegation.id, 'completed delegation must serve a historical registration');
      }
    } else {
      throw new LocalSeedPlanError('delegations', delegation.id, `invalid status ${String(delegation.status)}`);
    }
  }
  if (
    delegationStatuses.PENDING !== 4 ||
    delegationStatuses.ACCEPTED !== 4 ||
    delegationStatuses.COMPLETED !== 8 ||
    delegationsById.size !== plan.delegations.length
  ) {
    throw new LocalSeedPlanError('delegations', 'statuses', 'delegation status distribution is invalid');
  }
}

function assertPenalties(
  plan: LocalSeedPlan,
  registrationsById: ReadonlyMap<string, SeedRegistrationRow>,
  usersById: ReadonlyMap<string, SeedUserRow>,
): void {
  const penaltiesByRegistration = new Map<string, SeedPenaltyRow[]>();
  for (const penalty of plan.penalties) {
    if (!usersById.has(penalty.userId) || penalty.amount !== 50_000 || penalty.status !== 'PENDING') {
      throw new LocalSeedPlanError('penalties', penalty.id, 'penalty values are invalid');
    }
    const matching = [...registrationsById.values()].find(
      (registration) =>
        registration.userId === penalty.userId &&
        penalty.reason === `NO_SHOW_PENALTY_${registration.mealDate.toISOString().slice(0, 10)}_${registration.id}`,
    );
    if (!matching || matching.status !== 'NO_SHOW') {
      throw new LocalSeedPlanError('penalties', penalty.id, 'penalty does not match a no-show registration');
    }
    const rows = penaltiesByRegistration.get(matching.id) ?? [];
    rows.push(penalty);
    penaltiesByRegistration.set(matching.id, rows);
  }
  for (const registration of registrationsById.values()) {
    const penalties = penaltiesByRegistration.get(registration.id) ?? [];
    if (registration.status === 'NO_SHOW' && penalties.length !== 1) {
      throw new LocalSeedPlanError('penalties', registration.id, 'no-show must have exactly one penalty');
    }
    if (registration.status !== 'NO_SHOW' && penalties.length !== 0) {
      throw new LocalSeedPlanError('penalties', registration.id, 'non-no-show must not have a penalty');
    }
  }
}

function assertServingGraph(
  plan: LocalSeedPlan,
  usersById: ReadonlyMap<string, SeedUserRow>,
  staffUserIds: ReadonlySet<string>,
  kitchenUserIds: ReadonlySet<string>,
  locationsById: ReadonlyMap<string, SeedLocationRow>,
  policiesById: ReadonlyMap<string, SeedLocationPolicyRow>,
  dailyMenusById: ReadonlyMap<string, SeedDailyMenuRow>,
  revisionsById: ReadonlyMap<string, SeedMenuRevisionRow>,
  registrationsById: ReadonlyMap<string, SeedRegistrationRow>,
  delegationsById: ReadonlyMap<string, SeedDelegationRow>,
): void {
  const servingsByRegistration = indexRows(plan.mealServings, 'mealServings', (row) => row.registrationId);
  const servingsById = indexRows(plan.mealServings, 'mealServings', (row) => row.id);
  const verificationsById = indexRows(
    plan.servingVerifications,
    'servingVerifications',
    (row) => row.id,
  );
  const sessionsById = indexRows(plan.pickupSessions, 'pickupSessions', (row) => row.id);
  const requestsById = indexRows(
    plan.servingConfirmRequests,
    'servingConfirmRequests',
    (row) => row.id,
  );
  const eventsByServing = new Map<string, SeedMealEventRow[]>();
  const qrHashes = new Set<string>();
  const requestCallerKeys = new Set<string>();
  const receiverCounts = { SELF: 0, PROXY: 0 };
  const completedDelegationUseCounts = new Map<string, number>();
  for (const event of plan.mealEvents) {
    if (!servingsById.has(event.mealServingId) || event.eventType !== 'PICKUP_CONFIRMED') {
      throw new LocalSeedPlanError('mealEvents', event.id, 'meal event reference or type is invalid');
    }
    const events = eventsByServing.get(event.mealServingId) ?? [];
    events.push(event);
    eventsByServing.set(event.mealServingId, events);
  }

  for (const registration of registrationsById.values()) {
    const serving = servingsByRegistration.get(registration.id);
    if (registration.status === 'SERVED' && !serving) {
      throw new LocalSeedPlanError('mealServings', registration.id, 'served registration has no serving');
    }
    if (registration.status !== 'SERVED' && serving) {
      throw new LocalSeedPlanError('mealServings', registration.id, 'non-served registration has a serving');
    }
  }

  for (const serving of plan.mealServings) {
    assertDateOnly(serving.mealDate, 'mealServings', serving.id);
    const registration = registrationsById.get(serving.registrationId);
    const verification = verificationsById.get(serving.servingVerificationId);
    const session = sessionsById.get(serving.pickupSessionId);
    if (session) {
      assertDateOnly(session.mealDate, 'pickupSessions', session.id);
    }
    const request = requestsById.get(serving.requestId);
    if (!session || qrHashes.has(session.qrHash)) {
      throw new LocalSeedPlanError('pickupSessions', session?.id ?? serving.pickupSessionId, 'qr hash is duplicated');
    }
    qrHashes.add(session.qrHash);
    const requestCallerKey = request ? `${request.callerUserId}:${request.idempotencyKey}` : serving.requestId;
    if (requestCallerKeys.has(requestCallerKey)) {
      throw new LocalSeedPlanError('servingConfirmRequests', requestCallerKey, 'caller/idempotency key is duplicated');
    }
    requestCallerKeys.add(requestCallerKey);
    if (!registration || registration.status !== 'SERVED') {
      throw new LocalSeedPlanError('mealServings', serving.id, 'serving registration is invalid');
    }
    if (
      !usersById.has(serving.ownerUserId) ||
      !staffUserIds.has(serving.ownerUserId) ||
      serving.ownerUserId !== registration.userId ||
      !usersById.has(serving.presenterUserId) ||
      !staffUserIds.has(serving.presenterUserId) ||
      !kitchenUserIds.has(serving.kitchenUserId) ||
      serving.kitchenPermissionContext !== 'kitchen.serve'
    ) {
      throw new LocalSeedPlanError('mealServings', serving.id, 'serving principal relationship is invalid');
    }
    if (
      serving.ownerEmailSnapshot !== usersById.get(serving.ownerUserId)!.email ||
      serving.ownerNameSnapshot !== usersById.get(serving.ownerUserId)!.name ||
      serving.locationId !== registration.serviceLocationId ||
      serving.locationShortCode !== registration.serviceLocationCode ||
      !locationsById.has(serving.locationId) ||
      serving.locationNameSnapshot !== registration.serviceLocationName ||
      serving.locationAddressSnapshot !== registration.serviceLocationAddress ||
      !sameInstant(serving.mealDate, registration.mealDate) ||
      serving.verificationOutcome !== 'VALID' ||
      !verification ||
      !session ||
      !request
    ) {
      throw new LocalSeedPlanError('mealServings', serving.id, 'serving snapshot or graph reference is invalid');
    }
    const expectedRevision = [...revisionsById.values()].find(
      (revision) => dailyMenusById.get(revision.dailyMenuId)?.date.getTime() === serving.mealDate.getTime(),
    );
    if (!expectedRevision || serving.menuRevisionId !== expectedRevision.id) {
      throw new LocalSeedPlanError('mealServings', serving.id, 'menu revision does not match meal date');
    }
    if (serving.receiverType === 'SELF') {
      receiverCounts.SELF += 1;
      if (serving.presenterUserId !== serving.ownerUserId || serving.delegationId !== null) {
        throw new LocalSeedPlanError('mealServings', serving.id, 'self serving relationship is invalid');
      }
    } else if (serving.receiverType === 'PROXY') {
      receiverCounts.PROXY += 1;
      const delegation = serving.delegationId ? delegationsById.get(serving.delegationId) : undefined;
      if (
        !delegation ||
        delegation.status !== 'COMPLETED' ||
        delegation.registrationId !== serving.registrationId ||
        delegation.delegateUserId !== serving.presenterUserId ||
        serving.presenterUserId === serving.ownerUserId
      ) {
        throw new LocalSeedPlanError('mealServings', serving.id, 'proxy serving relationship is invalid');
      }
      completedDelegationUseCounts.set(
        delegation.id,
        (completedDelegationUseCounts.get(delegation.id) ?? 0) + 1,
      );
    } else {
      throw new LocalSeedPlanError('mealServings', serving.id, `invalid receiver type ${String(serving.receiverType)}`);
    }
    if (
      verification.presenterUserId !== serving.presenterUserId ||
      verification.locationId !== serving.locationId ||
      verification.result !== 'VALID' ||
      !Number.isFinite(verification.capturedAt.getTime()) ||
      !Number.isFinite(verification.verifiedAt.getTime()) ||
      !Number.isFinite(verification.retentionUntil.getTime()) ||
      verification.verifiedAt.getTime() < verification.capturedAt.getTime() ||
      !Number.isFinite(verification.accuracyMeters) ||
      verification.accuracyMeters < 0 ||
      verification.safeVerificationCode !== 'GPS_VALID' ||
      verification.intentNonce !== session.intentNonce ||
      !policiesById.has(verification.locationPolicyId) ||
      policiesById.get(verification.locationPolicyId)!.locationId !== verification.locationId
    ) {
      throw new LocalSeedPlanError('servingVerifications', verification.id, 'serving verification is invalid');
    }
    if (
      session.userId !== serving.ownerUserId ||
      session.presenterUserId !== serving.presenterUserId ||
      !locationsById.has(session.locationId) ||
      session.locationId !== serving.locationId ||
      !sameInstant(session.mealDate, serving.mealDate) ||
      session.registrationIds.length !== 1 ||
      session.registrationIds[0] !== serving.registrationId ||
      !isSortedUnique(session.registrationIds) ||
      !isSortedUnique(session.intentRegistrationIds) ||
      session.intentRegistrationIds.length !== session.registrationIds.length ||
      session.intentRegistrationIds.some((id, index) => id !== session.registrationIds[index]) ||
      session.intentHash !== serving.intentHash ||
      session.servingVerificationId !== serving.servingVerificationId ||
      session.qrHash.length === 0 ||
      session.consumedAt.getTime() !== serving.servedAt.getTime() ||
      session.consumedAt.getTime() + 30 * SECOND_MS !== session.expiresAt.getTime()
    ) {
      throw new LocalSeedPlanError('pickupSessions', session.id, 'pickup session graph or ordering is invalid');
    }
    if (
      request.callerUserId !== serving.presenterUserId ||
      request.status !== 'SUCCESS' ||
      request.pickupSessionId !== serving.pickupSessionId ||
      request.intentHash !== serving.intentHash ||
      request.originalResultRequestId !== null ||
      request.resultServingIds.length !== 1 ||
      request.resultServingIds[0] !== serving.id ||
      !isSortedUnique(request.resultServingIds) ||
      request.completedAt.getTime() !== serving.servedAt.getTime()
    ) {
      throw new LocalSeedPlanError('servingConfirmRequests', request.id, 'serving confirmation request is invalid');
    }
    const events = eventsByServing.get(serving.id) ?? [];
    if (events.length !== 1) {
      throw new LocalSeedPlanError('mealEvents', serving.id, 'serving must have exactly one event');
    }
  }
  if (receiverCounts.SELF !== 32 || receiverCounts.PROXY !== 8) {
    throw new LocalSeedPlanError(
      'mealServings',
      'receiverType',
      `expected 32 SELF and 8 PROXY servings, got ${receiverCounts.SELF} SELF and ${receiverCounts.PROXY} PROXY`,
    );
  }
  for (const delegation of plan.delegations) {
    if (
      delegation.status === 'COMPLETED' &&
      completedDelegationUseCounts.get(delegation.id) !== 1
    ) {
      throw new LocalSeedPlanError(
        'delegations',
        delegation.id,
        'every completed delegation must be consumed by exactly one proxy serving',
      );
    }
  }
}

function indexRows<T>(rows: readonly T[], entity: string, keyOf: (row: T) => string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || indexed.has(key)) {
      throw new LocalSeedPlanError(entity, key || '<empty>', 'duplicate or empty key');
    }
    indexed.set(key, row);
  }
  return indexed;
}

function rolesForOrdinal(ordinal: number): readonly SeedRole[] {
  if (ordinal < 36) return ['staff'];
  if (ordinal < 42) return ['kitchen'];
  if (ordinal < 47) return ['staff', 'kitchen'];
  if (ordinal < 49) return ['admin'];
  return ['admin', 'staff'];
}

function assignmentRoleForRoles(roles: readonly SeedRole[]): string {
  if (roles.includes('staff') && roles.includes('kitchen')) return 'STAFF_KITCHEN';
  if (roles.includes('staff')) return 'STAFF';
  if (roles.includes('kitchen')) return 'KITCHEN';
  return 'ADMIN';
}

function statusForOrdinal(ordinal: number): SeedRegistrationRow['status'] {
  if (ordinal < 60) return 'ACTIVE';
  if (ordinal < 100) return 'SERVED';
  if (ordinal < 116) return 'CANCELLED';
  return 'NO_SHOW';
}

function locationDetails(code: string): { displayName: string; address: string } {
  if (!Object.hasOwn(LOCATION_BY_CODE, code)) {
    throw new LocalSeedPlanError('locations', code, 'unknown synthetic location');
  }
  return LOCATION_BY_CODE[code as keyof typeof LOCATION_BY_CODE];
}

function parseDateOnly(value: string, entity: string, key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LocalSeedPlanError(entity, key, 'date must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new LocalSeedPlanError(entity, key, 'date is not a valid calendar date');
  }
  return date;
}

function assertDateOnly(value: Date, entity: string, key: string): void {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0
  ) {
    throw new LocalSeedPlanError(entity, key, 'date must be a valid UTC-midnight date-only value');
  }
}

function assertMonday(date: Date, key: string): void {
  if (date.getUTCDay() !== 1) {
    throw new LocalSeedPlanError('config', key, 'weekStart must be a Monday');
  }
}

function dateAtOffset(date: Date, offset: number): Date {
  return new Date(date.getTime() + offset * DAY_MS);
}

function dayOffset(start: Date, date: Date): number {
  return Math.round((date.getTime() - start.getTime()) / DAY_MS);
}

function dayOffsetForRegistration(start: Date, date: Date): number {
  const offset = dayOffset(start, date);
  if (offset < 0 || offset > 6) {
    throw new LocalSeedPlanError('registrations', date.toISOString(), 'registration date is outside the week');
  }
  return offset;
}

function servingTime(mealDate: Date, ordinal: number): Date {
  return new Date(Date.UTC(mealDate.getUTCFullYear(), mealDate.getUTCMonth(), mealDate.getUTCDate(), 4, 0, ordinal));
}

function sameInstant(left: Date, right: Date): boolean {
  return left instanceof Date && right instanceof Date && Number.isFinite(left.getTime()) && left.getTime() === right.getTime();
}

function isEffective(effectiveFrom: Date, effectiveTo: Date | null, at: Date): boolean {
  return effectiveFrom.getTime() <= at.getTime() && (effectiveTo === null || effectiveTo.getTime() > at.getTime());
}

function isSortedUnique(values: readonly string[]): boolean {
  const sorted = [...values].sort();
  return values.every((value, index) => value === sorted[index]) && new Set(values).size === values.length;
}
