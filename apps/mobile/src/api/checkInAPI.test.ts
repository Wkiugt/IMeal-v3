import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));

import { checkInAPI } from './checkInAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

const gps = {
  capturedAt: '2026-10-03T04:00:00.000Z',
  latitude: 10.77,
  longitude: 106.69,
  accuracyMeters: 12,
};

const location = {
  id: 'location-1',
  shortCode: 'HQ',
  displayName: 'Headquarters',
  servingPointName: 'Lunch counter',
  address: '1 Example Street',
};

const menu = { name: 'Chicken rice', description: null, imageUrl: null };

const registration = {
  id: 'registration-1',
  mealDate: '2026-10-03',
  mealChoice: 'REGULAR' as const,
  status: 'ACTIVE' as const,
  servedAt: null,
};

describe('checkInAPI', () => {
  it('loads the authenticated staff status from the canonical endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            date: '2026-10-03',
            window: {
              opensAt: '2026-10-03T03:30:00.000Z',
              closesAt: '2026-10-03T06:30:00.000Z',
              timeZone: 'Asia/Ho_Chi_Minh',
            },
            employee: { id: 'employee-1', name: 'Nguyen A', employeeCode: 'E001' },
            location,
            menu,
            registration,
            state: 'ACTIVE',
            canResolve: true,
            canConfirm: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInAPI.getStatus('token');

    expect(result.data.state).toBe('ACTIVE');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/me/check-in',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer token' },
      }),
    );
  });

  it('sends fresh GPS evidence when resolving a scanned kitchen QR', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            sessionId: 'check-in-session-1',
            intentNonce: 'intent-nonce-1',
            date: '2026-10-03',
            expiresAt: '2026-10-03T04:00:30.000Z',
            employee: { id: 'employee-1', name: 'Nguyen A', employeeCode: 'E001' },
            menu,
            location,
            registration,
            eligibility: { eligible: true, reasons: [] },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await checkInAPI.resolve('token', { qr: 'stable-kitchen-qr', gps });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/me/check-in/resolve',
      expect.objectContaining({
        body: JSON.stringify({ qr: 'stable-kitchen-qr', gps }),
      }),
    );
  });

  it('sends the idempotency key and fresh GPS on explicit confirmation', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            status: 'CHECKED_IN',
            registrationId: 'registration-1',
            servingId: 'serving-1',
            servedAt: '2026-10-03T04:01:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await checkInAPI.confirm('token', {
      sessionId: 'check-in-session-1',
      intentNonce: 'intent-nonce-1',
      idempotencyKey: 'idempotency-1',
      gps,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/me/check-in/confirm',
      expect.objectContaining({
        body: JSON.stringify({
          sessionId: 'check-in-session-1',
          intentNonce: 'intent-nonce-1',
          idempotencyKey: 'idempotency-1',
          gps,
        }),
      }),
    );
  });

  it('loads the stable kitchen QR and aggregate dashboard without employee data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              qr: 'stable-kitchen-qr',
              date: '2026-10-03',
              location,
              activeFrom: '2026-10-03T03:30:00.000Z',
              expiresAt: '2026-10-03T06:30:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              date: '2026-10-03',
              location,
              window: {
                opensAt: '2026-10-03T03:30:00.000Z',
                closesAt: '2026-10-03T06:30:00.000Z',
                timeZone: 'Asia/Ho_Chi_Minh',
              },
              lastUpdated: '2026-10-03T04:01:00.000Z',
              counts: {
                registered: 3,
                checkedIn: 1,
                pending: 1,
                noShow: 1,
                regular: 2,
                vegetarian: 1,
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const qr = await checkInAPI.getKitchenQr('token');
    const dashboard = await checkInAPI.getKitchenDashboard('token', '2026-10-03');

    expect(qr.data.qr).toBe('stable-kitchen-qr');
    expect(dashboard.data.counts).toEqual({
      registered: 3,
      checkedIn: 1,
      pending: 1,
      noShow: 1,
      regular: 2,
      vegetarian: 1,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/kitchen/check-in/dashboard?date=2026-10-03',
      expect.anything(),
    );
  });

  it('preserves structured check-in errors for the UI recovery path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: 'GPS_STALE', message: 'GPS fix is stale' },
            requestId: 'request-1',
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(checkInAPI.resolve('token', { qr: 'qr', gps })).rejects.toMatchObject({
      code: 'GPS_STALE',
      messageKey: 'errors.gpsStale',
    });
  });
});
