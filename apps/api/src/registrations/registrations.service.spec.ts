import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v1 } from '@imeal/contracts';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { RegistrationsService } from './registrations.service.js';
import { KitchenEventsService } from '../kitchen/kitchen-events.service.js';
const txMock = {
  $queryRaw: vi.fn(),
  dailyMenu: { findFirst: vi.fn() },
  dailyMenuRevision: { findMany: vi.fn() },
  employeeLocationAssignment: { findMany: vi.fn() },
  location: { findFirst: vi.fn() },
  registration: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  pickupDelegation: { findMany: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  notification: { upsert: vi.fn() },
  outboxEvent: { upsert: vi.fn(), create: vi.fn() },
};

const prismaMock = {
  appSetting: { findUnique: vi.fn() },
  weeklyMenu: { findFirst: vi.fn() },
  registration: { findMany: vi.fn() },
  employeeLocationAssignment: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

const completeRegistrationSnapshot = {
  menuRevisionId: 'revision-1',
  menuNameSnapshot: 'Lunch',
  menuDescriptionSnapshot: 'Verified lunch',
  menuImageSnapshot: 'https://example.test/lunch.jpg',
  ownerNameSnapshot: 'Owner',
  employeeCodeSnapshot: 'EMP-1',
  serviceLocationId: 'location-1',
  serviceLocationAssignmentId: 'assignment-1',
  serviceLocationCode: 'LOC-A',
  serviceLocationName: 'Main Hall',
  serviceLocationAddress: '1 Main Street',
  serviceLocationEffectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  serviceLocationSnapshotAt: new Date('2026-09-03T07:00:00.000Z'),
  registeredAt: new Date('2026-09-03T07:00:00.000Z'),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return prismaMock;
    }
  },
}));

function createService(
  notificationsService?: NotificationsService,
  kitchenEventsService?: KitchenEventsService,
): RegistrationsService {
  return new RegistrationsService(
    new PrismaService(),
    notificationsService,
    kitchenEventsService,
  );
}

describe('RegistrationsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    prismaMock.appSetting.findUnique.mockResolvedValue({ value: '14:00' });
    prismaMock.weeklyMenu.findFirst.mockResolvedValue(null);
    prismaMock.registration.findMany.mockResolvedValue([]);
    prismaMock.employeeLocationAssignment.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(txMock),
    );
    txMock.$queryRaw.mockResolvedValue([]);
    txMock.pickupDelegation.findMany.mockResolvedValue([]);
    txMock.registration.update.mockResolvedValue({});
    txMock.registration.create.mockResolvedValue({});
    txMock.pickupDelegation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});
    txMock.notification.upsert.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
    });
    txMock.outboxEvent.upsert.mockResolvedValue({});
    txMock.dailyMenu.findFirst.mockResolvedValue({ id: 'daily-menu-1' });
    txMock.dailyMenuRevision.findMany.mockResolvedValue([
      {
        id: 'revision-1',
        revision: 1,
        mealName: 'Lunch',
        description: 'Verified lunch',
        imageUrl: 'https://example.test/lunch.jpg',
      },
    ]);
    txMock.employeeLocationAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment-1',
        employeeName: 'Owner',
        employeeCode: 'EMP-1',
        serviceLocationCode: 'LOC-A',
        locationId: 'location-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    txMock.location.findFirst.mockResolvedValue({
      id: 'location-1',
      shortCode: 'LOC-A',
      displayName: 'Main Hall',
      address: '1 Main Street',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects registration at the exact 14:00:00 Vietnam cutoff', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-05',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-05',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.dailyMenu.findFirst).not.toHaveBeenCalled();
  });

  it('accepts registration at 13:59:59 Vietnam time before the 14:00 cutoff', async () => {
    vi.setSystemTime(new Date('2026-09-04T06:59:59.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);

    await expect(
      createService().batchRegister('user-1', [
        { mealDate: '2026-09-05', status: 'ACTIVE', mealChoice: 'REGULAR' },
      ]),
    ).resolves.toEqual([{ date: '2026-09-05', success: true }]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('publishes seven authoritative days with lunar choices and UTC dates', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.registration.findMany.mockResolvedValue([
      {
        id: 'registration-1',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ]);
    const service = createService();

    const response = await service.getWeekData('user-1', '2026-09-21');

    expect(v1.WeekRegistrationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(response).toMatchObject({
      menu: null,
      registrations: [
        {
          id: 'registration-1',
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'VEGETARIAN',
        },
      ],
      registrationWindow: {
        serverNow: '2026-09-04T07:00:00.000Z',
        cutoffAt: '2026-09-20T07:00:00.000Z',
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });
    expect(response.registrationWindow.days).toHaveLength(7);
    expect(response.registrationWindow.days[0]).toMatchObject({
      mealDate: '2026-09-21',
      cutoffAt: '2026-09-20T07:00:00.000Z',
      editable: true,
      lunarDate: { day: 11, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR'],
    });
    expect(response.registrationWindow.days[4]).toMatchObject({
      mealDate: '2026-09-25',
      lunarDate: { day: 15, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR', 'VEGETARIAN'],
    });
    expect(response.days[0]).toMatchObject({
      mealDate: '2026-09-21',
      lunarDate: { day: 11, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR'],
    });
    expect(response.days[4]).toMatchObject({
      mealDate: '2026-09-25',
      lunarDate: { day: 15, month: 8, year: 2026, isLeapMonth: false },
      availableMealChoices: ['REGULAR', 'VEGETARIAN'],
    });
    expect(response.registrationWindow.days[5].availableMealChoices).toEqual([
      'REGULAR',
    ]);
    expect(
      response.registrationWindow.days.every((day) =>
        day.cutoffAt.endsWith('.000Z'),
      ),
    ).toBe(true);
    expect(response.registrations[0].mealDate).not.toBeInstanceOf(Date);
  });
  it('projects an existing serving as SERVED in legacy and presentation rows', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.registration.findMany.mockResolvedValue([
      {
        id: 'registration-1',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        menuRevisionId: 'revision-1',
        mealServing: {
          id: 'serving-1',
          servedAt: new Date('2026-09-25T05:00:00.000Z'),
        },
      },
    ]);

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.registrations).toEqual([
      {
        id: 'registration-1',
        mealDate: '2026-09-25',
        status: 'SERVED',
        mealChoice: 'REGULAR',
        menuRevisionId: 'revision-1',
      },
    ]);
    expect(response.days[4].registration).toMatchObject({
      id: 'registration-1',
      status: 'SERVED',
      mealChoice: 'REGULAR',
    });
  });

  it('does not expose an unpublished weekly menu in the response', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const draftMenu = {
      id: 'draft-week',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: null,
      dailyMenus: [
        {
          id: 'draft-day',
          weeklyMenuId: 'draft-week',
          date: new Date('2026-09-21T00:00:00.000Z'),
          isHoliday: false,
          isEnabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          revisions: [
            {
              id: 'draft-revision',
              revision: null,
              mealName: 'Draft lunch',
              description: null,
              imageUrl: null,
            },
          ],
        },
      ],
    };
    prismaMock.weeklyMenu.findFirst.mockImplementation(
      async (options: { where?: { publishedAt?: { not?: null } } }) =>
        options.where?.publishedAt?.not === null ? null : draftMenu,
    );

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.menu).toBeNull();
    expect(response.days.every((day) => day.menu === null)).toBe(true);
  });

  it('exposes effective roster location and activation availability for an empty day', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: new Date('2026-09-03T00:00:00.000Z'),
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: new Date('2026-09-21T00:00:00.000Z'),
          isHoliday: false,
          isEnabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          revisions: [
            {
              id: 'revision-1',
              revision: 1,
              mealName: 'Lunch',
              description: 'Soup',
              imageUrl: null,
            },
          ],
        },
      ],
    });
    prismaMock.employeeLocationAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment-1',
        userId: 'user-1',
        isActive: true,
        employeeName: 'Owner',
        employeeCode: 'EMP-1',
        serviceLocationCode: 'LOC-A',
        locationId: 'location-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        location: {
          id: 'location-1',
          shortCode: 'LOC-A',
          displayName: 'Main Hall',
          address: '1 Main Street',
          isActive: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      },
    ]);

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.days[0]).toMatchObject({
      menu: {
        id: 'daily-menu-1',
        menuRevisionId: 'revision-1',
        mealName: 'Lunch',
      },
      location: {
        id: 'location-1',
        shortCode: 'LOC-A',
        displayName: 'Main Hall',
        address: '1 Main Street',
        source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
      },
      canActivate: true,
      canCancel: false,
      canChangeMealChoice: false,
      unavailableReasons: {
        activate: [],
        cancel: ['NOT_ACTIVE'],
        changeMealChoice: ['NOT_ACTIVE'],
      },
    });
  });

  it('keeps registration snapshots while resolving effective locations per date', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const mealDates = Array.from(
      { length: 7 },
      (_, index) => `2026-09-${String(21 + index).padStart(2, '0')}`,
    );
    const menuDay = (mealDate: string, index: number) => ({
      id: `daily-menu-${index + 1}`,
      weeklyMenuId: 'week-1',
      date: new Date(`${mealDate}T00:00:00.000Z`),
      isHoliday: false,
      isEnabled: true,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      revisions: [
        {
          id: `revision-${index + 1}`,
          revision: 1,
          mealName: `Meal ${index + 1}`,
          description: null,
          imageUrl: null,
        },
      ],
    });
    const locationAssignment = (
      id: string,
      locationId: string,
      shortCode: string,
      effectiveFrom: string,
      effectiveTo: string | null,
    ) => ({
      id,
      userId: 'user-1',
      isActive: true,
      employeeName: 'Owner',
      employeeCode: 'EMP-1',
      serviceLocationCode: shortCode,
      locationId,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      effectiveTo: effectiveTo
        ? new Date(`${effectiveTo}T00:00:00.000Z`)
        : null,
      location: {
        id: locationId,
        shortCode,
        displayName: `Location ${shortCode}`,
        address: `${shortCode} Street`,
        isActive: true,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
        effectiveTo: effectiveTo
          ? new Date(`${effectiveTo}T00:00:00.000Z`)
          : null,
      },
    });
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: new Date('2026-09-03T00:00:00.000Z'),
      dailyMenus: mealDates.map(menuDay),
    });
    prismaMock.registration.findMany.mockResolvedValue([
      {
        id: 'registration-snapshot',
        mealDate: new Date('2026-09-21T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        menuRevisionId: 'revision-1',
        mealServing: null,
        penalties: [],
        delegations: [],
        serviceLocationId: 'snapshot-location',
        serviceLocationCode: 'SNAP',
        serviceLocationName: 'Snapshot Hall',
        serviceLocationAddress: 'Snapshot Street',
      },
      {
        id: 'registration-cancelled',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'CANCELLED',
        mealChoice: 'REGULAR',
        menuRevisionId: 'revision-5',
        mealServing: null,
        penalties: [],
        delegations: [],
        serviceLocationId: 'cancelled-snapshot-location',
        serviceLocationCode: 'OLD',
        serviceLocationName: 'Old Hall',
        serviceLocationAddress: 'Old Street',
      },
    ]);
    prismaMock.employeeLocationAssignment.findMany.mockResolvedValue([
      locationAssignment(
        'assignment-snapshot-day',
        'current-location',
        'CURRENT',
        '2026-01-01',
        '2026-09-22',
      ),
      locationAssignment(
        'assignment-effective-day',
        'effective-location',
        'EFFECTIVE',
        '2026-09-22',
        '2026-09-23',
      ),
      locationAssignment(
        'assignment-ambiguous-a',
        'ambiguous-location-a',
        'AMB-A',
        '2026-09-24',
        '2026-09-25',
      ),
      locationAssignment(
        'assignment-ambiguous-b',
        'ambiguous-location-b',
        'AMB-B',
        '2026-09-24',
        '2026-09-25',
      ),
      locationAssignment(
        'assignment-cancelled-day',
        'fresh-location',
        'FRESH',
        '2026-09-25',
        null,
      ),
    ]);

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.days[0]).toMatchObject({
      registration: { id: 'registration-snapshot', status: 'ACTIVE' },
      location: {
        id: 'snapshot-location',
        source: 'REGISTRATION_SNAPSHOT',
      },
    });
    expect(response.days[1]).toMatchObject({
      location: {
        id: 'effective-location',
        source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
      },
      canActivate: true,
    });
    expect(response.days[2]).toMatchObject({
      location: null,
      canActivate: false,
      unavailableReasons: { activate: ['LOCATION_UNAVAILABLE'] },
    });
    expect(response.days[3]).toMatchObject({
      location: null,
      canActivate: false,
      unavailableReasons: { activate: ['LOCATION_AMBIGUOUS'] },
    });
    expect(response.days[4]).toMatchObject({
      registration: { id: 'registration-cancelled', status: 'CANCELLED' },
      location: {
        id: 'fresh-location',
        shortCode: 'FRESH',
        source: 'EFFECTIVE_ROSTER_ASSIGNMENT',
      },
      canActivate: true,
      unavailableReasons: { activate: [] },
    });
  });

  it('locks activation at the exact cutoff in the week response', async () => {
    vi.setSystemTime(new Date('2026-09-20T07:00:00.000Z'));

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.registrationWindow.days[0].cutoffAt).toBe(
      '2026-09-20T07:00:00.000Z',
    );
    expect(response.days[0]).toMatchObject({
      canActivate: false,
      unavailableReasons: {
        activate: ['CUTOFF_PASSED'],
      },
    });
  });
  it.each([
    {
      title: 'an inactive location',
      employeeName: 'Owner',
      locationPatch: { isActive: false },
    },
    {
      title: 'a location outside the meal date range',
      employeeName: 'Owner',
      locationPatch: {
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      },
    },
    {
      title: 'a missing employee identity',
      employeeName: '',
      locationPatch: {},
    },
    {
      title: 'a mismatched location identity',
      employeeName: 'Owner',
      locationPatch: { id: 'location-2' },
    },
  ])(
    'does not advertise activation with $title',
    async ({ employeeName, locationPatch }) => {
      vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
      prismaMock.weeklyMenu.findFirst.mockResolvedValue({
        id: 'week-1',
        startDate: new Date('2026-09-21T00:00:00.000Z'),
        endDate: new Date('2026-09-27T00:00:00.000Z'),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        publishedAt: new Date('2026-09-03T00:00:00.000Z'),
        dailyMenus: [
          {
            id: 'daily-menu-1',
            weeklyMenuId: 'week-1',
            date: new Date('2026-09-21T00:00:00.000Z'),
            isHoliday: false,
            isEnabled: true,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            revisions: [
              {
                id: 'revision-1',
                revision: 1,
                mealName: 'Lunch',
                description: null,
                imageUrl: null,
              },
            ],
          },
        ],
      });
      prismaMock.employeeLocationAssignment.findMany.mockResolvedValue([
        {
          id: 'assignment-1',
          userId: 'user-1',
          isActive: true,
          employeeName,
          employeeCode: 'EMP-1',
          serviceLocationCode: 'LOC-A',
          locationId: 'location-1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
          location: {
            id: 'location-1',
            shortCode: 'LOC-A',
            displayName: 'Main Hall',
            address: '1 Main Street',
            isActive: true,
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: null,
            ...locationPatch,
          },
        },
      ]);

      const response = await createService().getWeekData(
        'user-1',
        '2026-09-21',
      );

      expect(response.days[0]).toMatchObject({
        location: null,
        canActivate: false,
        unavailableReasons: {
          activate: ['LOCATION_UNAVAILABLE'],
        },
      });
    },
  );

  it('reports holiday, disabled, and missing-menu activation reasons separately', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    const menuDay = (
      id: string,
      date: string,
      isHoliday: boolean,
      isEnabled: boolean,
      revision: string,
    ) => ({
      id,
      weeklyMenuId: 'week-1',
      date: new Date(`${date}T00:00:00.000Z`),
      isHoliday,
      isEnabled,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      revisions: [
        {
          id: revision,
          revision: 1,
          mealName: 'Lunch',
          description: null,
          imageUrl: null,
        },
      ],
    });
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: new Date('2026-09-03T00:00:00.000Z'),
      dailyMenus: [
        menuDay('holiday-day', '2026-09-21', true, true, 'holiday-revision'),
        menuDay(
          'disabled-day',
          '2026-09-22',
          false,
          false,
          'disabled-revision',
        ),
      ],
    });
    prismaMock.employeeLocationAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment-1',
        userId: 'user-1',
        isActive: true,
        employeeName: 'Owner',
        employeeCode: 'EMP-1',
        serviceLocationCode: 'LOC-A',
        locationId: 'location-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        location: {
          id: 'location-1',
          shortCode: 'LOC-A',
          displayName: 'Main Hall',
          address: '1 Main Street',
          isActive: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      },
    ]);

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response.days[0].unavailableReasons.activate).toEqual(['HOLIDAY']);
    expect(response.days[1].unavailableReasons.activate).toEqual(['DISABLED']);
    expect(response.days[2].unavailableReasons.activate).toEqual([
      'NO_PUBLISHED_MENU',
    ]);
    expect(response.days[0].canActivate).toBe(false);
    expect(response.days[1].canActivate).toBe(false);
    expect(response.days[2].canActivate).toBe(false);
  });

  it('serializes menu dates before strict week response parsing', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: new Date('2026-09-03T00:00:00.000Z'),
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: new Date('2026-09-21T00:00:00.000Z'),
          isHoliday: false,
          isEnabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });
    const service = createService();

    const response = await service.getWeekData('user-1', '2026-09-21');

    expect(response.menu).toEqual({
      id: 'week-1',
      startDate: '2026-09-21',
      endDate: '2026-09-27',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: '2026-09-21',
          isHoliday: false,
          isEnabled: true,
          menuRevisionId: null,
          mealName: null,
          description: null,
          imageUrl: null,
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('maps current menu revisions and registration revision ids in the week response', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    prismaMock.weeklyMenu.findFirst.mockResolvedValue({
      id: 'week-1',
      startDate: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      publishedAt: new Date('2026-09-03T00:00:00.000Z'),
      dailyMenus: [
        {
          id: 'daily-menu-1',
          weeklyMenuId: 'week-1',
          date: new Date('2026-09-21T00:00:00.000Z'),
          isHoliday: false,
          isEnabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          revisions: [
            {
              id: 'revision-1',
              revision: 1,
              mealName: 'Verified lunch',
              description: 'Soup and rice',
              imageUrl: 'https://example.test/menu.jpg',
            },
          ],
        },
      ],
    });
    prismaMock.registration.findMany.mockResolvedValue([
      {
        id: 'registration-1',
        mealDate: new Date('2026-09-21T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        menuRevisionId: 'revision-1',
      },
    ]);

    const response = await createService().getWeekData('user-1', '2026-09-21');

    expect(response).toMatchObject({
      registrations: [{ id: 'registration-1', menuRevisionId: 'revision-1' }],
      menu: {
        dailyMenus: [
          {
            menuRevisionId: 'revision-1',
            mealName: 'Verified lunch',
            description: 'Soup and rice',
            imageUrl: 'https://example.test/menu.jpg',
          },
        ],
      },
    });
  });

  it('returns a typed bad request for a valid date outside lunar support', async () => {
    const service = createService();

    await expect(
      service.getWeekData('user-1', '2200-01-01'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'INVALID_MEAL_DATE',
      },
    });
    expect(prismaMock.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('returns ordered partial results and rejects vegetarian meals on ordinary days', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    const service = createService();

    const response = await service.batchRegister('user-1', [
      {
        mealDate: '2026-09-24',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
      {
        mealDate: '2026-09-25',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ]);

    expect(response).toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'MEAL_CHOICE_UNAVAILABLE',
        reason: 'Meal choice is unavailable for this date',
      },
      { date: '2026-09-25', success: true },
    ]);
    expect(txMock.registration.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        mealDate: new Date('2026-09-25T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
        version: 1,
        ...completeRegistrationSnapshot,
      },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('creates a regular registration with version one', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        mealDate: new Date('2026-09-24T00:00:00.000Z'),
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        version: 1,
        ...completeRegistrationSnapshot,
      },
    });
  });
  it('requires the published menu resolution to exclude holidays', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    txMock.dailyMenu.findFirst.mockImplementation(
      async (options: { where?: { isHoliday?: boolean } }) =>
        options.where?.isHoliday === false ? null : { id: 'daily-menu-1' },
    );

    await expect(
      createService().batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'Published menu is unavailable',
      },
    ]);
    expect(txMock.registration.create).not.toHaveBeenCalled();
  });

  it('cancels an active registration without menu or location authority', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      delegations: [],
      mealServing: null,
      penalties: [],
    });
    txMock.dailyMenu.findFirst.mockResolvedValue(null);
    txMock.employeeLocationAssignment.findMany.mockResolvedValue([]);

    await expect(
      createService().batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        cancelledAt: new Date('2026-09-03T07:00:00.000Z'),
        cancelReason: 'REGISTRATION_CANCELLED',
        cancelledByUserId: 'user-1',
      },
    });
  });

  it('changes an active meal choice without resolving fresh menu or location authority', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'VEGETARIAN',
      delegations: [],
      mealServing: null,
      penalties: [],
      ...completeRegistrationSnapshot,
    });
    txMock.dailyMenu.findFirst.mockResolvedValue(null);
    txMock.employeeLocationAssignment.findMany.mockResolvedValue([]);

    await expect(
      createService().batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-25', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: { mealChoice: 'REGULAR', version: { increment: 1 } },
    });
    expect(txMock.dailyMenu.findFirst).not.toHaveBeenCalled();
    expect(txMock.employeeLocationAssignment.findMany).not.toHaveBeenCalled();
  });

  it('requires fresh effective authority when reactivating a cancelled registration', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      delegations: [],
      mealServing: null,
      penalties: [],
    });
    txMock.location.findFirst.mockResolvedValue({
      id: 'location-1',
      shortCode: 'LOC-B',
      displayName: 'Other Hall',
      address: '2 Main Street',
    });

    await expect(
      createService().batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'VEGETARIAN',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-25',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'Service location authority is unavailable',
      },
    ]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
  });

  it('rejects registration when the published menu revision is missing', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    txMock.dailyMenuRevision.findMany.mockResolvedValue([]);
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'ACTIVE', mealChoice: 'REGULAR' },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'Published menu revision is unavailable',
      },
    ]);
    expect(txMock.registration.create).not.toHaveBeenCalled();
  });

  it('rejects registration when effective location assignment authority is ambiguous', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue(null);
    txMock.employeeLocationAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment-1',
        employeeName: 'Owner',
        employeeCode: 'EMP-1',
        serviceLocationCode: 'LOC-A',
        locationId: 'location-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'assignment-2',
        employeeName: 'Owner',
        employeeCode: 'EMP-2',
        serviceLocationCode: 'LOC-B',
        locationId: 'location-2',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'ACTIVE', mealChoice: 'REGULAR' },
      ]),
    ).resolves.toMatchObject([
      { date: '2026-09-24', success: false, code: 'REGISTRATION_FAILED' },
    ]);
    expect(txMock.registration.create).not.toHaveBeenCalled();
    expect(txMock.location.findFirst).not.toHaveBeenCalled();
  });
  it('retries a raced first registration create as an idempotent no-op', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'registration-1',
        status: 'ACTIVE',
        mealChoice: 'REGULAR',
        delegations: [],
        ...completeRegistrationSnapshot,
      });
    txMock.registration.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(txMock.registration.update).not.toHaveBeenCalled();
  });

  it('does not write when an active registration keeps the same choice', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      delegations: [],
      ...completeRegistrationSnapshot,
    });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
    expect(txMock.registration.create).not.toHaveBeenCalled();
  });

  it('updates an active registration choice and increments its version', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'VEGETARIAN',
      delegations: [],
      ...completeRegistrationSnapshot,
    });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-25', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: { mealChoice: 'REGULAR', version: { increment: 1 } },
    });
  });

  it('reactivates a cancelled registration with the requested choice', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-25',
          status: 'ACTIVE',
          mealChoice: 'VEGETARIAN',
        },
      ]),
    ).resolves.toEqual([{ date: '2026-09-25', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: {
        ...completeRegistrationSnapshot,
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
        version: { increment: 1 },
        registeredAt: new Date('2026-09-03T07:00:00.000Z'),
        cancelledAt: null,
        cancelReason: null,
        cancelledByUserId: null,
      },
    });
  });

  it('rejects reactivation when a serving or penalty already exists', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      mealServing: { id: 'serving-1' },
      penalties: [{ id: 'penalty-1' }],
    });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-25', status: 'ACTIVE', mealChoice: 'REGULAR' },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-25',
        success: false,
        code: 'REGISTRATION_FINALIZED',
        reason: 'Registration is finalized',
      },
    ]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
    expect(txMock.dailyMenu.findFirst).not.toHaveBeenCalled();
  });

  it('cancels active registrations and revokes delegations transactionally', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      user: { name: 'Owner', email: 'owner@example.com' },
      delegations: [
        {
          id: 'delegation-1',
          delegateUserId: 'delegate-1',
          status: 'PENDING',
        },
      ],
    });
    txMock.pickupDelegation.findMany.mockResolvedValueOnce([
      {
        id: 'delegation-1',
        delegateUserId: 'delegate-1',
        status: 'PENDING',
      },
    ]);
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([{ date: '2026-09-24', success: true }]);
    expect(txMock.registration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        cancelledAt: new Date('2026-09-03T07:00:00.000Z'),
        cancelReason: 'REGISTRATION_CANCELLED',
        cancelledByUserId: 'user-1',
      },
    });
    expect(txMock.pickupDelegation.update).toHaveBeenCalledWith({
      where: { id: 'delegation-1' },
      data: { status: 'REVOKED' },
    });
    expect(txMock.notification.upsert).toHaveBeenCalled();
    expect(txMock.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('emits cancellation lifecycle events only after the transaction commits', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    txMock.auditLog.create.mockResolvedValueOnce({ id: 'audit-cancel' });
    const eventsService = new KitchenEventsService();
    const emitEvent = vi.spyOn(eventsService, 'emitEvent');
    let committed = false;
    prismaMock.$transaction.mockImplementationOnce(async (callback) => {
      const result = await callback(txMock);
      expect(emitEvent).not.toHaveBeenCalled();
      committed = true;
      return result;
    });

    const result = await createService(undefined, eventsService).batchRegister(
      'user-1',
      [{ mealDate: '2026-09-24', status: 'CANCELLED' }],
    );

    expect(result).toEqual([{ date: '2026-09-24', success: true }]);
    expect(committed).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith({
      eventId: 'registration:audit-cancel',
      eventType: 'REGISTRATION_CHANGED',
      mealDate: '2026-09-24',
      payload: { registrationId: 'registration-1', status: 'CANCELLED' },
    });
  });

  it('emits reactivation lifecycle events with the committed audit identity', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'CANCELLED',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    txMock.auditLog.create.mockResolvedValueOnce({ id: 'audit-reactivate' });
    const eventsService = new KitchenEventsService();
    const emitEvent = vi.spyOn(eventsService, 'emitEvent');

    await createService(undefined, eventsService).batchRegister('user-1', [
      {
        mealDate: '2026-09-25',
        status: 'ACTIVE',
        mealChoice: 'VEGETARIAN',
      },
    ]);

    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'registration_reactivated' }),
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith({
      eventId: 'registration:audit-reactivate',
      eventType: 'REGISTRATION_CHANGED',
      mealDate: '2026-09-25',
      payload: { registrationId: 'registration-1', status: 'ACTIVE' },
    });
  });

  it('registration_changed_event_is_not_visible_when_registration_transaction_rolls_back', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'ACTIVE',
      mealChoice: 'REGULAR',
      user: { name: 'Owner', email: 'owner@example.com' },
      delegations: [{ id: 'delegation-1', delegateUserId: 'delegate-1' }],
    });
    txMock.pickupDelegation.findMany.mockResolvedValueOnce([
      { id: 'delegation-1', delegateUserId: 'delegate-1', status: 'PENDING' },
    ]);
    txMock.auditLog.create.mockResolvedValueOnce({ id: 'audit-rollback' });
    const publishError = new Error('notification write failed');
    const notifications = new NotificationsService(new PrismaService());
    vi.spyOn(notifications, 'publish').mockRejectedValueOnce(publishError);
    const eventsService = new KitchenEventsService();
    const emitEvent = vi.spyOn(eventsService, 'emitEvent');

    await expect(
      createService(notifications, eventsService).batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'notification write failed',
      },
    ]);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('makes cancellation of missing or already cancelled registrations idempotent', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'registration-1',
        status: 'CANCELLED',
        mealChoice: 'REGULAR',
        delegations: [],
      });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        { mealDate: '2026-09-24', status: 'CANCELLED' },
        { mealDate: '2026-09-25', status: 'CANCELLED' },
      ]),
    ).resolves.toEqual([
      { date: '2026-09-24', success: true },
      { date: '2026-09-25', success: true },
    ]);
    expect(txMock.registration.update).not.toHaveBeenCalled();
  });

  it.each(['SERVED', 'NO_SHOW'])(
    'does not mutate a finalized %s registration before cutoff',
    async (status) => {
      vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
      txMock.registration.findUnique.mockResolvedValue({
        id: 'registration-1',
        status,
        mealChoice: 'REGULAR',
        delegations: [],
      });
      const service = createService();

      await expect(
        service.batchRegister('user-1', [
          {
            mealDate: '2026-09-24',
            status: 'ACTIVE',
            mealChoice: 'REGULAR',
          },
        ]),
      ).resolves.toEqual([
        {
          date: '2026-09-24',
          success: false,
          code: 'REGISTRATION_FINALIZED',
          reason: 'Registration is finalized',
        },
      ]);
      expect(txMock.registration.update).not.toHaveBeenCalled();
    },
  );

  it('gives cutoff precedence over finalized status and no-op state', async () => {
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));
    txMock.registration.findUnique.mockResolvedValue({
      id: 'registration-1',
      status: 'SERVED',
      mealChoice: 'REGULAR',
      delegations: [],
    });
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-05',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-05',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns INVALID_MEAL_DATE for an unsupported batch date', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2200-01-01',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2200-01-01',
        success: false,
        code: 'INVALID_MEAL_DATE',
        reason: expect.stringContaining('between 1200 and 2199'),
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns REGISTRATION_FAILED when an item transaction fails', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:00:00.000Z'));
    txMock.registration.findUnique.mockRejectedValue(
      new Error('database down'),
    );
    const service = createService();

    await expect(
      service.batchRegister('user-1', [
        {
          mealDate: '2026-09-24',
          status: 'ACTIVE',
          mealChoice: 'REGULAR',
        },
      ]),
    ).resolves.toEqual([
      {
        date: '2026-09-24',
        success: false,
        code: 'REGISTRATION_FAILED',
        reason: 'database down',
      },
    ]);
  });

  it('uses a BadRequestException for malformed week starts', async () => {
    const service = createService();

    await expect(
      service.getWeekData('user-1', 'not-a-date'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
