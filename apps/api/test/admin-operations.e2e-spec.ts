import { BadRequestException, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { vi, type Mock } from 'vitest';
import { LocationsController } from '../src/admin/locations/locations.controller.js';
import { RosterController } from '../src/admin/roster/roster.controller.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { RosterImportService } from '../src/admin/roster/roster-import.service.js';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { SessionService } from '../src/auth/session.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-user.js';

type RosterServiceMock = {
  preview: Mock;
  commit: Mock;
};

type LocationServiceMock = {
  listConfiguredLocations: Mock;
  saveConfiguration: Mock;
};

const rosterRow = {
  email: 'employee@example.test',
  name: 'Employee',
  employeeCode: 'EMP-001',
  isActive: true,
  role: 'PRESENTER',
  serviceLocationCode: 'LOC-A',
  effectiveFrom: '2026-09-24T00:00:00.000Z',
  effectiveTo: null,
};

const adminUser: AuthenticatedUser = {
  id: 'admin-1',
  userId: 'admin-1',
  email: 'admin@example.test',
  name: 'Admin',
  roles: ['operations'],
  permissions: ['roster.manage', 'location.manage'],
  sessionId: 'session-admin',
  isActive: true,
};

async function createRosterApp(
  user: AuthenticatedUser,
  rosterService: RosterServiceMock,
): Promise<INestApplication<Server>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [RosterController],
    providers: [
      Reflector,
      SessionGuard,
      PermissionsGuard,
      { provide: SessionService, useValue: { resolve: vi.fn().mockResolvedValue(user) } },
      { provide: RosterImportService, useValue: rosterService },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

async function createLocationApp(
  user: AuthenticatedUser,
  locationsService: LocationServiceMock,
): Promise<INestApplication<Server>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [LocationsController],
    providers: [
      Reflector,
      SessionGuard,
      PermissionsGuard,
      { provide: SessionService, useValue: { resolve: vi.fn().mockResolvedValue(user) } },
      { provide: LocationsService, useValue: locationsService },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

describe('Admin operations (e2e)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'true';
  });

  afterEach(() => {
    delete process.env.REQUIRE_AUTH;
  });

  it('previews a roster before allowing the client to submit a commit request', async () => {
    const rosterService: RosterServiceMock = {
      preview: vi.fn().mockResolvedValue({
        batchId: 'batch-1',
        source: 'admin-web',
        rows: [{ ...rosterRow, rowNumber: 1, normalizedEmail: rosterRow.email }],
        valid: true,
        acceptedCount: 1,
        rejectedCount: 0,
      }),
      commit: vi.fn().mockResolvedValue({
        batchId: 'batch-1',
        rows: [{ rowNumber: 1, normalizedEmail: rosterRow.email, assignmentId: 'assignment-1', outcome: 'ACCEPTED' }],
        acceptedCount: 1,
        idempotent: false,
      }),
    };
    const app = await createRosterApp(adminUser, rosterService);

    try {
      const preview = await request(app.getHttpServer())
        .post('/admin/roster/preview')
        .set('Authorization', 'Bearer session-admin')
        .send({ source: 'admin-web', rows: [rosterRow] });

      expect(preview.status).toBe(201);
      expect(preview.body).toMatchObject({ batchId: 'batch-1', valid: true });
      expect(rosterService.commit).not.toHaveBeenCalled();

      const commit = await request(app.getHttpServer())
        .post('/admin/roster/batch-1/commit')
        .set('Authorization', 'Bearer session-admin');

      expect(commit.status).toBe(201);
      expect(rosterService.commit).toHaveBeenCalledWith('batch-1', 'admin-1');
    } finally {
      await app.close();
    }
  });

  it('returns row failures without invoking a partial commit', async () => {
    const rosterService: RosterServiceMock = {
      preview: vi.fn().mockResolvedValue({
        source: 'admin-web',
        rows: [{ ...rosterRow, rowNumber: 1, normalizedEmail: rosterRow.email, reason: 'UNKNOWN_SERVICE_LOCATION' }],
        valid: false,
        acceptedCount: 0,
        rejectedCount: 1,
      }),
      commit: vi.fn(),
    };
    const app = await createRosterApp(adminUser, rosterService);

    try {
      const preview = await request(app.getHttpServer())
        .post('/admin/roster/preview')
        .set('Authorization', 'Bearer session-admin')
        .send({ source: 'admin-web', rows: [rosterRow] });

      expect(preview.status).toBe(201);
      expect(preview.body).toMatchObject({ valid: false, acceptedCount: 0, rejectedCount: 1 });
      expect(preview.body.rows[0]).toMatchObject({ reason: 'UNKNOWN_SERVICE_LOCATION' });
      expect(rosterService.commit).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('denies roster operations without the explicit roster permission', async () => {
    const rosterService: RosterServiceMock = {
      preview: vi.fn(),
      commit: vi.fn(),
    };
    const app = await createRosterApp({ ...adminUser, permissions: [] }, rosterService);

    try {
      const response = await request(app.getHttpServer())
        .post('/admin/roster/preview')
        .set('Authorization', 'Bearer session-admin')
        .send({ source: 'admin-web', rows: [rosterRow] });

      expect(response.status).toBe(403);
      expect(rosterService.preview).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });



  it('redacts policy coordinates from Admin Web location responses', async () => {
    const locationsService: LocationServiceMock = {
      listConfiguredLocations: vi.fn().mockResolvedValue([
        {
          id: 'location-1',
          shortCode: 'LOC-A',
          displayName: 'Approved location',
          servingPointName: 'Serving point',
          address: 'Approved address',
          building: 'Building',
          floor: '1',
          roomOrCounter: 'Counter',
          localContact: 'Contact',
          isActive: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
          policies: [
            {
              id: 'policy-1',
              locationId: 'location-1',
              latitude: 10.77,
              longitude: 106.69,
              accuracySource: 'survey',
              geofenceRadiusMeters: 100,
              maxFixAgeSeconds: 60,
              maxAccuracyMeters: 30,
              effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
              effectiveTo: null,
              isActive: true,
            },
          ],
        },
      ]),
      saveConfiguration: vi.fn(),
    };
    const app = await createLocationApp(adminUser, locationsService);

    try {
      const response = await request(app.getHttpServer())
        .get('/admin/locations')
        .set('Authorization', 'Bearer session-admin');

      expect(response.status).toBe(200);
      expect(response.body[0].policies[0]).not.toHaveProperty('latitude');
      expect(response.body[0].policies[0]).not.toHaveProperty('longitude');
      expect(JSON.stringify(response.body)).not.toContain('10.77');
      expect(JSON.stringify(response.body)).not.toContain('106.69');
    } finally {
      await app.close();
    }
  });

  it('accepts policy updates without coordinates because the API preserves them server-side', async () => {
    const locationsService: LocationServiceMock = {
      listConfiguredLocations: vi.fn(),
      saveConfiguration: vi.fn().mockResolvedValue({ id: 'location-1' }),
    };
    const app = await createLocationApp(adminUser, locationsService);

    try {
      const response = await request(app.getHttpServer())
        .put('/admin/locations/location-1')
        .set('Authorization', 'Bearer session-admin')
        .send({
          shortCode: 'LOC-A',
          displayName: 'Approved location',
          servingPointName: 'Serving point',
          address: 'Approved address',
          building: 'Building',
          floor: '1',
          roomOrCounter: 'Counter',
          localContact: 'Contact',
          isActive: true,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: null,
          approvedScannerDeviceIds: ['scanner-1'],
          policy: {
            id: 'policy-1',
            accuracySource: 'survey',
            geofenceRadiusMeters: 100,
            maxFixAgeSeconds: 60,
            maxAccuracyMeters: 30,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            effectiveTo: null,
            isActive: true,
          },
        });

      expect(response.status).toBe(200);
      expect(locationsService.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: expect.not.objectContaining({
            latitude: expect.anything(),
            longitude: expect.anything(),
          }),
        }),
        'admin-1',
      );
    } finally {
      await app.close();
    }
  });

  it('does not expose an admin-role lifecycle route', async () => {
    const app = await createRosterApp(adminUser, {
      preview: vi.fn(),
      commit: vi.fn(),
    });

    try {
      const response = await request(app.getHttpServer())
        .post('/admin/roles')
        .set('Authorization', 'Bearer session-admin')
        .send({ userId: 'employee-1', role: 'admin' });

      expect(response.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('preserves API row-validation errors instead of pretending a commit succeeded', async () => {
    const rosterService: RosterServiceMock = {
      preview: vi.fn(),
      commit: vi.fn().mockRejectedValue(
        new BadRequestException({
          code: 'ROSTER_IMPORT_INVALID',
          message: 'Roster batch contains rejected rows.',
        }),
      ),
    };
    const app = await createRosterApp(adminUser, rosterService);

    try {
      const response = await request(app.getHttpServer())
        .post('/admin/roster/batch-invalid/commit')
        .set('Authorization', 'Bearer session-admin');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'ROSTER_IMPORT_INVALID' });
    } finally {
      await app.close();
    }
  });
});
