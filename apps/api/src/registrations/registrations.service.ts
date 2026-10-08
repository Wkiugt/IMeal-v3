import {
  BadRequestException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import type { StructuredLogger } from '@imeal/observability';
import { PrismaService } from '../common/prisma.service.js';
import { lockUserLifecycle } from '../common/transaction-locks.js';
import {
  apiLogFields,
  createApiStructuredLogger,
  API_STRUCTURED_LOGGER,
} from '../common/structured-logger.js';
import type { Prisma } from '@imeal/core';
import { KitchenEventsService } from '../kitchen/kitchen-events.service.js';
import { v1 } from '@imeal/contracts';
import type { VietnameseLunarDate } from '../common/vietnamese-lunar.js';
import {
  BUSINESS_TIME_ZONE,
  getBusinessDate,
  getBusinessMonthRange,
  getCutoffInstant,
  parseMealDate,
  resolveRegistrationWeekRestriction,
  resolveRegistrationWeekWindow,
} from '../common/business-time.js';
import {
  serializeEmployeeRegistrationBase,
  toNullableIso,
} from '../common/employee-activity.js';
import { projectRegistrationStatus } from '../common/registration-status.js';
import {
  getAvailableMealChoices,
  getVietnameseLunarDate,
} from '../common/vietnamese-lunar.js';

const INVALID_MEAL_DATE_MESSAGE = 'Invalid meal date';
const REGISTRATION_FAILED_MESSAGE = 'Registration could not be completed';
const ACCOUNT_NOT_FOUND_MESSAGE = 'Account not found.';
const ACCOUNT_DISABLED_MESSAGE = 'Account is disabled.';
const PUBLISHED_MENU_UNAVAILABLE_MESSAGE = 'Published menu is unavailable';
const PUBLISHED_MENU_REVISION_UNAVAILABLE_MESSAGE =
  'Published menu revision is unavailable';
const EMPLOYEE_LOCATION_ASSIGNMENT_UNAVAILABLE_MESSAGE =
  'Employee location assignment is unavailable';
const EMPLOYEE_LOCATION_ASSIGNMENT_AMBIGUOUS_MESSAGE =
  'Employee location assignment is ambiguous';
const SERVICE_LOCATION_AUTHORITY_UNAVAILABLE_MESSAGE =
  'Service location authority is unavailable';
const CUTOFF_PASSED_MESSAGE = 'Cutoff time exceeded';
const REGISTRATION_WEEK_NOT_OPEN_MESSAGE = 'Registration week is not open';
const OUTSIDE_REGISTRATION_WINDOW_MESSAGE =
  'Date is outside the registration window';
const MEAL_CHOICE_UNAVAILABLE_MESSAGE =
  'Meal choice is unavailable for this date';
const REGISTRATION_FINALIZED_MESSAGE = 'Registration is finalized';

type RegistrationSnapshotFailureMessage =
  | typeof PUBLISHED_MENU_UNAVAILABLE_MESSAGE
  | typeof PUBLISHED_MENU_REVISION_UNAVAILABLE_MESSAGE
  | typeof EMPLOYEE_LOCATION_ASSIGNMENT_UNAVAILABLE_MESSAGE
  | typeof EMPLOYEE_LOCATION_ASSIGNMENT_AMBIGUOUS_MESSAGE
  | typeof SERVICE_LOCATION_AUTHORITY_UNAVAILABLE_MESSAGE;

class RegistrationFinalizedError extends Error {}

class MealChoiceUnavailableError extends Error {}
class RegistrationSnapshotResolutionError extends Error {
  constructor(message: RegistrationSnapshotFailureMessage) {
    super(message);
  }
}
function safeRegistrationFailureReason(
  error: unknown,
): string | undefined {
  if (error instanceof RegistrationSnapshotResolutionError) {
    return error.message;
  }
  if (error instanceof BadRequestException) {
    if (
      error.message === ACCOUNT_NOT_FOUND_MESSAGE ||
      error.message === ACCOUNT_DISABLED_MESSAGE
    ) {
      return error.message;
    }
  }
  return undefined;
}

type RegistrationSnapshotResolution = {
  menuRevisionId: string;
  menuNameSnapshot: string;
  menuDescriptionSnapshot: string | null;
  menuImageSnapshot: string | null;
  ownerNameSnapshot: string;
  employeeCodeSnapshot: string;
  serviceLocationId: string;
  serviceLocationAssignmentId: string;
  serviceLocationCode: string;
  serviceLocationName: string;
  serviceLocationAddress: string;
  serviceLocationEffectiveFrom: Date;
  serviceLocationSnapshotAt: Date;
};

function hasCompleteRegistrationSnapshot(registration: {
  [K in keyof RegistrationSnapshotResolution]?:
    RegistrationSnapshotResolution[K] | null;
}): boolean {
  return (
    typeof registration.menuRevisionId === 'string' &&
    registration.menuRevisionId.length > 0 &&
    typeof registration.menuNameSnapshot === 'string' &&
    registration.menuNameSnapshot.length > 0 &&
    typeof registration.ownerNameSnapshot === 'string' &&
    registration.ownerNameSnapshot.length > 0 &&
    typeof registration.employeeCodeSnapshot === 'string' &&
    registration.employeeCodeSnapshot.length > 0 &&
    typeof registration.serviceLocationId === 'string' &&
    registration.serviceLocationId.length > 0 &&
    typeof registration.serviceLocationAssignmentId === 'string' &&
    registration.serviceLocationAssignmentId.length > 0 &&
    typeof registration.serviceLocationCode === 'string' &&
    registration.serviceLocationCode.length > 0 &&
    typeof registration.serviceLocationName === 'string' &&
    registration.serviceLocationName.length > 0 &&
    typeof registration.serviceLocationAddress === 'string' &&
    registration.serviceLocationAddress.length > 0 &&
    registration.serviceLocationEffectiveFrom instanceof Date &&
    registration.serviceLocationSnapshotAt instanceof Date
  );
}
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
type RegistrationLifecycleEvent = {
  auditId: string;
  eventType: 'REGISTRATION_CHANGED';
  mealDate: string;
  registrationId: string;
  status: 'ACTIVE' | 'CANCELLED';
};

type RegistrationLocationFields = {
  serviceLocationId?: string | null;
  serviceLocationCode?: string | null;
  serviceLocationName?: string | null;
  serviceLocationAddress?: string | null;
};

type EffectiveRosterAssignment = {
  isActive: boolean;
  employeeName: string;
  employeeCode: string;
  serviceLocationCode: string;
  locationId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  location: {
    id: string;
    shortCode: string;
    displayName: string;
    address: string;
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  } | null;
};

type EffectiveLocationResolution =
  | { kind: 'AVAILABLE'; location: v1.WeekDayLocation }
  | { kind: 'UNAVAILABLE'; reason: 'LOCATION_UNAVAILABLE' }
  | { kind: 'AMBIGUOUS'; reason: 'LOCATION_AMBIGUOUS' };


function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toRegistrationLocation(
  registration: RegistrationLocationFields,
): v1.WeekDayLocation | null {
  if (
    !hasText(registration.serviceLocationId) ||
    !hasText(registration.serviceLocationCode) ||
    !hasText(registration.serviceLocationName) ||
    !hasText(registration.serviceLocationAddress)
  ) {
    return null;
  }
  return {
    id: registration.serviceLocationId,
    shortCode: registration.serviceLocationCode,
    displayName: registration.serviceLocationName,
    address: registration.serviceLocationAddress,
    source: 'REGISTRATION_SNAPSHOT',
  };
}

function resolveEffectiveRosterLocation(
  assignments: readonly EffectiveRosterAssignment[],
  mealDate: Date,
): EffectiveLocationResolution {
  const effectiveAssignments = assignments.filter(
    (assignment) =>
      assignment.isActive &&
      assignment.effectiveFrom <= mealDate &&
      (assignment.effectiveTo === null || assignment.effectiveTo > mealDate),
  );
  if (effectiveAssignments.length === 0) {
    return { kind: 'UNAVAILABLE', reason: 'LOCATION_UNAVAILABLE' };
  }
  if (effectiveAssignments.length > 1) {
    return { kind: 'AMBIGUOUS', reason: 'LOCATION_AMBIGUOUS' };
  }

  const assignment = effectiveAssignments[0];
  const location = assignment.location;
  if (
    !hasText(assignment.employeeName) ||
    !hasText(assignment.employeeCode) ||
    !location ||
    !location.isActive ||
    location.effectiveFrom > mealDate ||
    (location.effectiveTo !== null && location.effectiveTo <= mealDate) ||
    location.id !== assignment.locationId ||
    !hasText(assignment.serviceLocationCode) ||
    !hasText(location.shortCode) ||
    assignment.serviceLocationCode !== location.shortCode ||
    !hasText(location.id) ||
    !hasText(location.displayName) ||
    !hasText(location.address)
  ) {
    return { kind: 'UNAVAILABLE', reason: 'LOCATION_UNAVAILABLE' };
  }
  return {
    kind: 'AVAILABLE',
    location: {
      id: location.id,
      shortCode: location.shortCode,
      displayName: location.displayName,
      address: location.address,
      source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
    },
  };
}

function menuUnavailableReasons(
  menu: v1.WeekDailyMenu | null,
): v1.RegistrationDayUnavailableReason[] {
  if (!menu) return ['NO_PUBLISHED_MENU'];
  const reasons: v1.RegistrationDayUnavailableReason[] = [];
  if (menu.isHoliday) reasons.push('HOLIDAY');
  if (!menu.isEnabled) reasons.push('DISABLED');
  if (!menu.menuRevisionId || !hasText(menu.mealName)) {
    reasons.push('NO_PUBLISHED_MENU');
  }
  return reasons;
}

function isRegistrationFinalized(registration: {
  status: string;
  mealServing?: unknown;
  penalties?: readonly unknown[];
}): boolean {
  return (
    registration.status === 'SERVED' ||
    registration.status === 'NO_SHOW' ||
    (registration.mealServing !== null &&
      registration.mealServing !== undefined) ||
    (registration.penalties?.length ?? 0) > 0
  );
}

const registrationActivitySelect = {
  id: true,
  mealDate: true,
  status: true,
  mealChoice: true,
  menuRevisionId: true,
  menuNameSnapshot: true,
  menuDescriptionSnapshot: true,
  menuImageSnapshot: true,
  serviceLocationId: true,
  serviceLocationAssignmentId: true,
  serviceLocationCode: true,
  serviceLocationName: true,
  serviceLocationAddress: true,
  serviceLocationEffectiveFrom: true,
  serviceLocationSnapshotAt: true,
  registeredAt: true,
  cancelledAt: true,
  noShowAt: true,
  createdAt: true,
  updatedAt: true,
  mealServing: { select: { servedAt: true } },
  penalties: {
    select: {
      id: true,
      userId: true,
      amount: true,
      status: true,
      createdAt: true,
      paidAt: true,
      waivedAt: true,
    },
  },
} satisfies Prisma.RegistrationSelect;

function registrationActivitySelectForUser(userId: string) {
  return {
    ...registrationActivitySelect,
    penalties: {
      ...registrationActivitySelect.penalties,
      where: { userId },
    },
  } satisfies Prisma.RegistrationSelect;
}

type RegistrationActivityRow = Prisma.RegistrationGetPayload<{
  select: typeof registrationActivitySelect;
}>;

function serializeRegistrationActivity(
  registration: RegistrationActivityRow,
  userId: string,
): v1.EmployeeRegistrationActivity {
  const base = serializeEmployeeRegistrationBase(registration);
  return {
    ...base,
    penalties: registration.penalties
      .filter((penalty) => penalty.userId === userId)
      .map((penalty) => ({
        id: penalty.id,
        amount: penalty.amount,
        status: penalty.status,
        createdAt: penalty.createdAt.toISOString(),
        paidAt: toNullableIso(penalty.paidAt),
        waivedAt: toNullableIso(penalty.waivedAt),
      })),
  };
}

@Injectable()
export class RegistrationsService {
  private readonly kitchenEventsService?: KitchenEventsService;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() kitchenEventsService?: KitchenEventsService,
    @Optional() @Inject(API_STRUCTURED_LOGGER) logger?: StructuredLogger,
  ) {
    this.kitchenEventsService = kitchenEventsService;
    this.logger = logger ?? createApiStructuredLogger();
  }
  async getHistory(
    userId: string,
    query: v1.RegistrationHistoryQuery,
  ): Promise<v1.RegistrationHistoryResponse> {
    const businessDate = parseMealDate(getBusinessDate());
    const where: Prisma.RegistrationWhereInput = {
      userId,
      mealDate: { lte: businessDate },
    };
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        select: registrationActivitySelectForUser(userId),
        orderBy: [{ mealDate: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.registration.count({ where }),
    ]);
    const totalPages = Math.ceil(total / query.limit);
    return {
      data: rows.map((row) => serializeRegistrationActivity(row, userId)),
      meta: {
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
        },
      },
    };
  }

  async getStats(
    userId: string,
    query: v1.RegistrationStatsQuery,
  ): Promise<v1.RegistrationStatsResponse> {
    const businessMonth = getBusinessDate().slice(0, 7);
    const month = query.month ?? businessMonth;
    let startDate: Date;
    let endDate: Date;
    try {
      ({ startDate, endDate } = getBusinessMonthRange(month));
    } catch {
      throw new BadRequestException();
    }
    const rows = await this.prisma.registration.findMany({
      where: {
        userId,
        mealDate: { gte: startDate, lte: endDate },
      },
      select: {
        status: true,
        mealServing: { select: { id: true } },
      },
    });
    let booked = 0;
    let enjoyed = 0;
    for (const row of rows) {
      const status = projectRegistrationStatus(row.status, row.mealServing);
      if (status === 'ACTIVE' || status === 'SERVED' || status === 'NO_SHOW') {
        booked += 1;
      }
      if (status === 'SERVED') {
        enjoyed += 1;
      }
    }
    return {
      data: {
        period: {
          month,
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
        },
        booked,
        enjoyed,
      },
    };
  }

  async getWeekData(userId: string, weekStart: string) {
    let startDate: Date;
    try {
      startDate = parseMealDate(weekStart);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_MEAL_DATE',
        message: INVALID_MEAL_DATE_MESSAGE,
      });
    }

    const mealDates = Array.from({ length: 7 }, (_, index) => {
      const mealDate = new Date(startDate);
      mealDate.setUTCDate(startDate.getUTCDate() + index);
      return mealDate.toISOString().slice(0, 10);
    });

    let lunarDates: VietnameseLunarDate[];
    try {
      lunarDates = mealDates.map((mealDate) =>
        getVietnameseLunarDate(mealDate),
      );
    } catch {
      throw new BadRequestException({
        code: 'INVALID_MEAL_DATE',
        message: INVALID_MEAL_DATE_MESSAGE,
      });
    }

    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 6);
    const cutoffSetting = await this.getCutoffTime();
    const serverNow = new Date();
    const weeklyWindow = resolveRegistrationWeekWindow(serverNow);
    const windowDays = mealDates.map((mealDateKey, index) => {
      const cutoffAt = getCutoffInstant(mealDateKey, cutoffSetting.time);
      const weeklyRestriction = resolveRegistrationWeekRestriction(
        weeklyWindow,
        mealDateKey,
      );
      return {
        mealDate: mealDateKey,
        cutoffAt: cutoffAt.toISOString(),
        editable: serverNow < cutoffAt && weeklyRestriction === null,
        weeklyRestriction,
        lunarDate: lunarDates[index],
        availableMealChoices: getAvailableMealChoices(mealDateKey),
      };
    });

    const menuData = await this.prisma.weeklyMenu.findFirst({
      where: {
        startDate,
        publishedAt: { not: null },
      },
      include: {
        dailyMenus: {
          include: {
            revisions: {
              where: { revision: { not: null } },
              orderBy: [{ revision: 'desc' }, { id: 'desc' }],
              take: 2,
            },
          },
        },
      },
    });
    const registrations = await this.prisma.registration.findMany({
      where: {
        userId,
        mealDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        mealServing: { select: { id: true } },
        penalties: { select: { id: true } },
      },
    });
    const rosterAssignments =
      await this.prisma.employeeLocationAssignment.findMany({
        where: {
          userId,
          isActive: true,
          effectiveFrom: { lte: endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: startDate } }],
        },
        include: {
          location: {
            select: {
              id: true,
              shortCode: true,
              displayName: true,
              address: true,
              isActive: true,
              effectiveFrom: true,
              effectiveTo: true,
            },
          },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
      });

    const serializedMenu = menuData
      ? {
          id: menuData.id,
          startDate: menuData.startDate.toISOString().slice(0, 10),
          endDate: menuData.endDate.toISOString().slice(0, 10),
          createdAt: menuData.createdAt.toISOString(),
          updatedAt: menuData.updatedAt.toISOString(),
          dailyMenus: menuData.dailyMenus.map((dailyMenu) => {
            const revisions = dailyMenu.revisions ?? [];
            const revision = revisions[0] ?? null;
            const revisionIsValid =
              revision !== null &&
              revision.revision !== null &&
              hasText(revision.mealName) &&
              revisions[1]?.revision !== revision.revision;
            return {
              id: dailyMenu.id,
              weeklyMenuId: dailyMenu.weeklyMenuId,
              date: dailyMenu.date.toISOString().slice(0, 10),
              isHoliday: dailyMenu.isHoliday,
              isEnabled: dailyMenu.isEnabled,
              menuRevisionId: revisionIsValid ? revision.id : null,
              mealName: revisionIsValid ? revision.mealName : null,
              description: revisionIsValid ? revision.description : null,
              imageUrl: revisionIsValid ? revision.imageUrl : null,
              createdAt: dailyMenu.createdAt.toISOString(),
            };
          }),
        }
      : null;
    const menuByDate = new Map(
      serializedMenu?.dailyMenus.map((menu) => [menu.date, menu]) ?? [],
    );
    const registrationByDate = new Map(
      registrations.map((registration) => [
        registration.mealDate.toISOString().slice(0, 10),
        registration,
      ]),
    );
    const serializedRegistrations = registrations.map((registration) => ({
      id: registration.id,
      mealDate: registration.mealDate.toISOString().slice(0, 10),
      status: projectRegistrationStatus(
        registration.status,
        registration.mealServing,
      ),
      mealChoice: registration.mealChoice,
      menuRevisionId: registration.menuRevisionId ?? null,
    }));
    const serializedRegistrationByDate = new Map(
      serializedRegistrations.map((registration) => [
        registration.mealDate,
        registration,
      ]),
    );

    const days = windowDays.map((windowDay) => {
      const mealDate = parseMealDate(windowDay.mealDate);
      const menu = menuByDate.get(windowDay.mealDate) ?? null;
      const registration = registrationByDate.get(windowDay.mealDate);
      const registrationRecord =
        serializedRegistrationByDate.get(windowDay.mealDate) ?? null;
      const effectiveLocation = resolveEffectiveRosterLocation(
        rosterAssignments,
        mealDate,
      );
      const usesRegistrationSnapshot =
        registration !== undefined &&
        (registration.status === 'ACTIVE' ||
          registration.status === 'SERVED' ||
          registration.status === 'NO_SHOW');
      const location = usesRegistrationSnapshot
        ? toRegistrationLocation(registration)
        : effectiveLocation.kind === 'AVAILABLE'
          ? effectiveLocation.location
          : null;
      const menuReasons = menuUnavailableReasons(menu);
      const locationReasons =
        effectiveLocation.kind === 'AVAILABLE'
          ? []
          : [effectiveLocation.reason];
      const activateReasons: v1.RegistrationDayUnavailableReason[] = [];
      if (serverNow >= new Date(windowDay.cutoffAt)) {
        activateReasons.push('CUTOFF_PASSED');
      } else if (registration) {
        if (isRegistrationFinalized(registration)) {
          activateReasons.push('REGISTRATION_FINALIZED');
        } else if (registration.status === 'ACTIVE') {
          activateReasons.push('ALREADY_ACTIVE');
        } else if (registration.status === 'CANCELLED') {
          activateReasons.push(...menuReasons, ...locationReasons);
        } else {
          activateReasons.push('NOT_ACTIVE');
        }
      } else {
        activateReasons.push(...menuReasons, ...locationReasons);
      }

      const cancelReasons: v1.RegistrationDayUnavailableReason[] = [];
      if (!registration) {
        cancelReasons.push('NOT_ACTIVE');
      } else if (serverNow >= new Date(windowDay.cutoffAt)) {
        cancelReasons.push('CUTOFF_PASSED');
      } else if (isRegistrationFinalized(registration)) {
        cancelReasons.push('REGISTRATION_FINALIZED');
      } else if (registration.status !== 'ACTIVE') {
        cancelReasons.push('NOT_ACTIVE');
      }

      const changeMealChoiceReasons: v1.RegistrationDayUnavailableReason[] = [];
      if (!registration || registration.status !== 'ACTIVE') {
        changeMealChoiceReasons.push('NOT_ACTIVE');
      } else if (serverNow >= new Date(windowDay.cutoffAt)) {
        changeMealChoiceReasons.push('CUTOFF_PASSED');
      } else if (isRegistrationFinalized(registration)) {
        changeMealChoiceReasons.push('REGISTRATION_FINALIZED');
      } else if (
        windowDay.availableMealChoices.every(
          (choice) => choice === registration.mealChoice,
        )
      ) {
        changeMealChoiceReasons.push('NO_ALTERNATIVE_MEAL_CHOICE');
      }

      if (windowDay.weeklyRestriction !== null) {
        activateReasons.push(windowDay.weeklyRestriction);
        cancelReasons.push(windowDay.weeklyRestriction);
        changeMealChoiceReasons.push(windowDay.weeklyRestriction);
      }

      return {
        mealDate: windowDay.mealDate,
        menu,
        registration: registrationRecord,
        location,
        lunarDate: windowDay.lunarDate,
        availableMealChoices: windowDay.availableMealChoices,
        cutoffAt: windowDay.cutoffAt,
        canActivate: activateReasons.length === 0,
        canCancel: cancelReasons.length === 0,
        canChangeMealChoice: changeMealChoiceReasons.length === 0,
        unavailableReasons: {
          activate: activateReasons,
          cancel: cancelReasons,
          changeMealChoice: changeMealChoiceReasons,
        },
      };
    });

    return v1.WeekRegistrationResponseSchema.parse({
      menu: serializedMenu,
      registrations: serializedRegistrations,
      days,
      registrationWindow: {
        serverNow: serverNow.toISOString(),
        nextWeekOpenAt: weeklyWindow.nextWeekOpenAt.toISOString(),
        cutoffAt: windowDays[0].cutoffAt,
        timeZone: BUSINESS_TIME_ZONE,
        days: windowDays.map((windowDay) => ({
          mealDate: windowDay.mealDate,
          cutoffAt: windowDay.cutoffAt,
          editable: windowDay.editable,
          lunarDate: windowDay.lunarDate,
          availableMealChoices: windowDay.availableMealChoices,
        })),
      },
    });
  }

  async getCutoffTime(): Promise<{ time: string; version: number }> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: 'CUTOFF_TIME' },
    });
    if (!setting) {
      return { time: '14:00', version: 1 };
    }
    return { time: setting.value, version: setting.version };
  }

  async setCutoffTime(time: string, expectedVersion: number) {
    try {
      getCutoffInstant('2000-01-02', time);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid cutoff time',
      );
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new BadRequestException('Version must be a non-negative integer');
    }

    // Optimistic Concurrency Control
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.appSetting.findUnique({
        where: { key: 'CUTOFF_TIME' },
      });

      if (!existing) {
        return tx.appSetting.create({
          data: {
            key: 'CUTOFF_TIME',
            value: time,
            version: 1,
          },
        });
      }

      const result = await tx.appSetting.updateMany({
        where: { key: 'CUTOFF_TIME', version: expectedVersion },
        data: {
          value: time,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new HttpException(
          'Cutoff setting was updated by another user. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      return { success: true };
    });
  }

  private async resolveRegistrationSnapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    mealDate: Date,
    at: Date,
  ): Promise<RegistrationSnapshotResolution> {
    const dailyMenu = await tx.dailyMenu.findFirst({
      where: {
        date: mealDate,
        isEnabled: true,
        isHoliday: false,
        weeklyMenu: { publishedAt: { not: null } },
      },
      select: { id: true },
    });
    if (!dailyMenu) {
      throw new RegistrationSnapshotResolutionError(
        PUBLISHED_MENU_UNAVAILABLE_MESSAGE,
      );
    }

    const revisions = await tx.dailyMenuRevision.findMany({
      where: { dailyMenuId: dailyMenu.id, revision: { not: null } },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      take: 2,
      select: {
        id: true,
        revision: true,
        mealName: true,
        description: true,
        imageUrl: true,
      },
    });
    const revision = revisions[0];
    if (
      !revision ||
      revision.revision === null ||
      !revision.mealName?.trim() ||
      revisions[1]?.revision === revision.revision
    ) {
      throw new RegistrationSnapshotResolutionError(
        PUBLISHED_MENU_REVISION_UNAVAILABLE_MESSAGE,
      );
    }

    const assignments = await tx.employeeLocationAssignment.findMany({
      where: {
        userId,
        isActive: true,
        effectiveFrom: { lte: mealDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: mealDate } }],
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        employeeName: true,
        employeeCode: true,
        serviceLocationCode: true,
        locationId: true,
        effectiveFrom: true,
      },
    });
    if (assignments.length !== 1) {
      throw new RegistrationSnapshotResolutionError(
        assignments.length === 0
          ? EMPLOYEE_LOCATION_ASSIGNMENT_UNAVAILABLE_MESSAGE
          : EMPLOYEE_LOCATION_ASSIGNMENT_AMBIGUOUS_MESSAGE,
      );
    }
    const assignment = assignments[0];
    const location = await tx.location.findFirst({
      where: {
        id: assignment.locationId,
        isActive: true,
        effectiveFrom: { lte: mealDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: mealDate } }],
      },
      select: {
        id: true,
        shortCode: true,
        displayName: true,
        address: true,
      },
    });
    if (
      !location ||
      location.id !== assignment.locationId ||
      location.shortCode !== assignment.serviceLocationCode ||
      !assignment.employeeName?.trim() ||
      !assignment.employeeCode?.trim() ||
      !location.displayName?.trim() ||
      !location.address?.trim()
    ) {
      throw new RegistrationSnapshotResolutionError(
        SERVICE_LOCATION_AUTHORITY_UNAVAILABLE_MESSAGE,
      );
    }

    return {
      menuRevisionId: revision.id,
      menuNameSnapshot: revision.mealName,
      menuDescriptionSnapshot: revision.description ?? null,
      menuImageSnapshot: revision.imageUrl ?? null,
      ownerNameSnapshot: assignment.employeeName.trim(),
      employeeCodeSnapshot: assignment.employeeCode.trim(),
      serviceLocationId: location.id,
      serviceLocationAssignmentId: assignment.id,
      serviceLocationCode: assignment.serviceLocationCode.trim(),
      serviceLocationName: location.displayName.trim(),
      serviceLocationAddress: location.address.trim(),
      serviceLocationEffectiveFrom: assignment.effectiveFrom,
      serviceLocationSnapshotAt: at,
    };
  }

  async batchRegister(
    userId: string,
    items: v1.BatchRegistrationItem[],
  ): Promise<v1.BatchRegistrationResponse> {
    const cutoffSetting = await this.getCutoffTime();
    const cutoffTimeStr = cutoffSetting.time;
    const serverNow = new Date();
    const weeklyWindow = resolveRegistrationWeekWindow(serverNow);
    const results: v1.BatchRegistrationResult[] = [];

    // Partial success handling: loop each item independently
    for (const item of items) {
      const mealDateStr = item.mealDate;
      let mealDate: Date;
      try {
        mealDate = parseMealDate(mealDateStr);
        getVietnameseLunarDate(mealDateStr);
      } catch {
        results.push({
          date: mealDateStr,
          success: false,
          code: 'INVALID_MEAL_DATE',
          reason: INVALID_MEAL_DATE_MESSAGE,
        });
        continue;
      }

      try {
        const weeklyRestriction = resolveRegistrationWeekRestriction(
          weeklyWindow,
          mealDateStr,
        );
        if (weeklyRestriction !== null) {
          results.push({
            date: mealDateStr,
            success: false,
            code: weeklyRestriction,
            reason:
              weeklyRestriction === 'REGISTRATION_WEEK_NOT_OPEN'
                ? REGISTRATION_WEEK_NOT_OPEN_MESSAGE
                : OUTSIDE_REGISTRATION_WINDOW_MESSAGE,
          });
          continue;
        }

        const cutoffDate = getCutoffInstant(mealDateStr, cutoffTimeStr);
        if (serverNow >= cutoffDate) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'CUTOFF_PASSED',
            reason: CUTOFF_PASSED_MESSAGE,
          });
          continue;
        }

        let transactionAttempt = 0;
        while (true) {
          try {
            const transactionResult = await this.prisma.$transaction(
              async (tx) => {
                await lockUserLifecycle(tx);
                let lifecycleEvent: RegistrationLifecycleEvent | null = null;
                let registration = await tx.registration.findUnique({
                  where: {
                    userId_mealDate: {
                      userId,
                      mealDate,
                    },
                  },
                  include: {
                    mealServing: true,
                    penalties: true,
                  },
                });

                if (registration) {
                  await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`;
                  registration = await tx.registration.findUnique({
                    where: { id: registration.id },
                    include: {
                      mealServing: true,
                      penalties: true,
                    },
                  });
                }

                await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
                const owner = await tx.user.findUnique({
                  where: { id: userId },
                  select: { id: true, isActive: true },
                });
                if (!owner) {
                  throw new BadRequestException(ACCOUNT_NOT_FOUND_MESSAGE);
                }
                if (!owner.isActive) {
                  throw new BadRequestException(ACCOUNT_DISABLED_MESSAGE);
                }

                if (
                  registration &&
                  (registration.status === 'SERVED' ||
                    registration.status === 'NO_SHOW' ||
                    registration.mealServing ||
                    registration.penalties?.length)
                ) {
                  throw new RegistrationFinalizedError();
                }

                if (
                  item.status === 'ACTIVE' &&
                  !getAvailableMealChoices(mealDateStr).includes(
                    item.mealChoice,
                  )
                ) {
                  throw new MealChoiceUnavailableError();
                }

                if (item.status === 'ACTIVE') {
                  const needsResolution =
                    !registration ||
                    !hasCompleteRegistrationSnapshot(registration) ||
                    registration.status === 'CANCELLED';
                  const resolution = needsResolution
                    ? await this.resolveRegistrationSnapshot(
                        tx,
                        userId,
                        mealDate,
                        serverNow,
                      )
                    : null;

                  if (
                    registration &&
                    (registration.status === 'ACTIVE' ||
                      registration.status === 'CANCELLED')
                  ) {
                    if (
                      registration.status === 'ACTIVE' &&
                      registration.mealChoice === item.mealChoice &&
                      resolution === null
                    ) {
                      return;
                    }
                    const choiceChanged =
                      registration.mealChoice !== item.mealChoice;
                    await tx.registration.update({
                      where: { id: registration.id },
                      data: {
                        ...(resolution ?? {}),
                        ...(registration.status === 'CANCELLED'
                          ? {
                              status: 'ACTIVE',
                              mealChoice: item.mealChoice,
                              version: { increment: 1 },
                              registeredAt: serverNow,
                              cancelledAt: null,
                              cancelReason: null,
                              cancelledByUserId: null,
                            }
                          : choiceChanged
                            ? {
                                mealChoice: item.mealChoice,
                                version: { increment: 1 },
                              }
                            : {}),
                      },
                    });
                    if (registration.status === 'CANCELLED') {
                      const audit = await tx.auditLog.create({
                        data: {
                          userId,
                          action: 'registration_reactivated',
                          details: `Registration ${registration.id} reactivated; previous cancellation reason=${registration.cancelReason ?? 'UNKNOWN'}`,
                        },
                      });
                      if (typeof audit.id === 'string') {
                        lifecycleEvent = {
                          auditId: audit.id,
                          eventType: 'REGISTRATION_CHANGED',
                          mealDate: mealDateStr,
                          registrationId: registration.id,
                          status: 'ACTIVE',
                        };
                      }
                    }
                  } else {
                    await tx.registration.create({
                      data: {
                        userId,
                        mealDate,
                        status: 'ACTIVE',
                        mealChoice: item.mealChoice,
                        version: 1,
                        registeredAt: serverNow,
                        ...(resolution ?? {}),
                      },
                    });
                  }
                } else if (registration?.status === 'ACTIVE') {
                  await tx.registration.update({
                    where: { id: registration.id },
                    data: {
                      status: 'CANCELLED',
                      version: { increment: 1 },
                      cancelledAt: serverNow,
                      cancelReason: 'REGISTRATION_CANCELLED',
                      cancelledByUserId: userId,
                    },
                  });

                  const audit = await tx.auditLog.create({
                    data: {
                      userId,
                      action: 'registration_cancelled',
                      details: `Registration ${registration.id} cancelled with reason REGISTRATION_CANCELLED`,
                    },
                  });
                  if (typeof audit.id === 'string') {
                    lifecycleEvent = {
                      auditId: audit.id,
                      eventType: 'REGISTRATION_CHANGED',
                      mealDate: mealDateStr,
                      registrationId: registration.id,
                      status: 'CANCELLED',
                    };
                  }
                }
                return lifecycleEvent;
              },
            );
            if (transactionResult && this.kitchenEventsService) {
              try {
                this.kitchenEventsService.emitEvent({
                  eventId: `registration:${transactionResult.auditId}`,
                  eventType: transactionResult.eventType,
                  mealDate: transactionResult.mealDate,
                  payload: {
                    registrationId: transactionResult.registrationId,
                    status: transactionResult.status,
                  },
                });
              } catch {
                this.logger.error(
                  'registrations.event_publish_failed',
                  apiLogFields('registrations.event_publish_failed', {
                    errorCode: 'EVENT_PUBLISH_FAILED',
                  }),
                );
              }
            }
            break;
          } catch (error: unknown) {
            if (transactionAttempt === 0 && isUniqueConstraintError(error)) {
              transactionAttempt += 1;
              continue;
            }
            throw error;
          }
        }

        results.push({ date: mealDateStr, success: true });
      } catch (error: unknown) {
        if (error instanceof RegistrationFinalizedError) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'REGISTRATION_FINALIZED',
            reason: REGISTRATION_FINALIZED_MESSAGE,
          });
        } else if (error instanceof MealChoiceUnavailableError) {
          results.push({
            date: mealDateStr,
            success: false,
            code: 'MEAL_CHOICE_UNAVAILABLE',
            reason: MEAL_CHOICE_UNAVAILABLE_MESSAGE,
          });
        } else {
          const safeReason = safeRegistrationFailureReason(error);
          results.push({
            date: mealDateStr,
            success: false,
            code: 'REGISTRATION_FAILED',
            reason: safeReason ?? REGISTRATION_FAILED_MESSAGE,
          });
        }
      }
    }

    return v1.BatchRegistrationResponseSchema.parse(results);
  }
}
