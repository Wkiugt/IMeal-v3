import { describe, expect, it, beforeEach, vi } from 'vitest';
import { LocationsService } from '../../locations/locations.service.js';

const NOW = new Date('2026-09-24T03:00:00.000Z');
const LOCATION = {
  id: 'location-1',
  shortCode: 'LOC-A',
  displayName: 'Approved location',
  servingPointName: 'Approved serving point',
  address: 'Approved address',
  isActive: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  timeZone: 'Asia/Ho_Chi_Minh',
  policies: [
    {
      id: 'policy-1',
      latitude: 10.77,
      longitude: 106.69,
      accuracySource: 'approved-survey',
      geofenceRadiusMeters: 250,
      maxFixAgeSeconds: 120,
      maxAccuracyMeters: 50,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      isActive: true,
    },
  ],
};

const LOCATION_CONFIGURATION = {
  id: 'location-1',
  shortCode: 'LOC-A',
  displayName: 'Approved location',
  servingPointName: 'Approved serving point',
  address: 'Approved address',
  building: 'Building',
  floor: '1',
  roomOrCounter: 'Counter',
  localContact: 'Contact',
  isActive: true,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
  policy: {
    id: 'policy-1',
    latitude: 10.77,
    longitude: 106.69,
    accuracySource: 'approved-survey',
    geofenceRadiusMeters: 250,
    maxFixAgeSeconds: 120,
    maxAccuracyMeters: 50,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    isActive: true,
  },
};

const prisma = {
  location: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  locationPolicy: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};


describe('LocationsService', () => {
  let service: LocationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    service = new LocationsService(prisma as never);
  });

  it('resolves only an effective active location and policy selected by server code', async () => {
    prisma.location.findFirst.mockResolvedValue(LOCATION);

    const resolved = await service.resolveEffectiveLocation(' loc-a ', NOW);

    expect(prisma.location.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shortCode: 'LOC-A',
          isActive: true,
        }),
      }),
    );
    expect(resolved).toMatchObject({
      id: 'location-1',
      shortCode: 'LOC-A',
      locationPolicy: expect.objectContaining({ locationId: 'location-1' }),
    });
  });

  it.each([
    ['geofence radius', { geofenceRadiusMeters: 250.5 }],
    ['maximum fix age', { maxFixAgeSeconds: 120.5 }],
  ])(
    'rejects a non-integral %s policy threshold before persistence',
    async (_label, override) => {
      await expect(
        service.saveConfiguration(
          {
            ...LOCATION_CONFIGURATION,
            policy: { ...LOCATION_CONFIGURATION.policy, ...override },
          },
          'admin-1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a policy update when the policy belongs to another location', async () => {
    prisma.locationPolicy.findUnique.mockResolvedValue({
      id: 'policy-2',
      locationId: 'location-2',
    });

    await expect(
      service.saveConfiguration(
        {
          ...LOCATION_CONFIGURATION,
          policy: { ...LOCATION_CONFIGURATION.policy, id: 'policy-2' },
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_LOCATION_POLICY' },
    });
    expect(prisma.location.update).not.toHaveBeenCalled();
  });

  it('evaluates a fresh accurate fix inside the configured geofence', async () => {
    prisma.location.findUnique.mockResolvedValue(LOCATION);

    const result = await service.evaluatePresenterEvidence(
      'location-1',
      {
        capturedAt: NOW.toISOString(),
        latitude: 10.7705,
        longitude: 106.6905,
        accuracyMeters: 12,
      },
      NOW,
    );

    expect(result).toMatchObject({ result: 'VALID', locationId: 'location-1' });
    expect(JSON.stringify(result)).not.toContain('distance');
    expect(JSON.stringify(result)).not.toContain('latitude');
    expect(JSON.stringify(result)).not.toContain('longitude');
  });

  it.each([
    ['stale', new Date('2026-09-24T02:55:00.000Z'), 12, 10.7705, 106.6905],
    ['inaccurate', NOW, 500, 10.7705, 106.6905],
    ['outside', NOW, 12, 11.1, 106.69],
  ])(
    'returns safe retry data for a %s fix',
    async (_reason, capturedAt, accuracyMeters, latitude, longitude) => {
      prisma.location.findUnique.mockResolvedValue(LOCATION);

      const result = await service.evaluatePresenterEvidence(
        'location-1',
        {
          capturedAt: capturedAt.toISOString(),
          latitude,
          longitude,
          accuracyMeters,
        },
        NOW,
      );

      expect(result.result).toBe('GPS_RETRY_REQUIRED');
      if (result.result !== 'GPS_RETRY_REQUIRED') {
        throw new Error('Expected retry result');
      }
      expect(result.details).toEqual({ action: expect.any(String) });
      if (_reason === 'outside') {
        expect(result.code).toBe('GPS_RETRY_REQUIRED');
        expect(result.safeVerificationCode).toBe('OUTSIDE_GEOFENCE');
      }
      expect(JSON.stringify(result)).not.toContain('distance');
      expect(JSON.stringify(result)).not.toContain('latitude');
      expect(JSON.stringify(result)).not.toContain('longitude');
    },
  );
});
