import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));
import { MobileApiError } from './mobileApiError';
import { pickupAPI } from './pickupAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickupAPI', () => {
  it('maps pickup availability failures to MobileApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'PICKUP_NOT_READY',
              message:
                'Meal pickup is not currently available. Please wait for the kitchen signal.',
              details: {
                availableFrom: '10:30',
                availableUntil: '13:30',
                timeZone: 'Asia/Ho_Chi_Minh',
              },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(pickupAPI.getPickupOptions('token')).rejects.toMatchObject({
      code: 'PICKUP_NOT_READY',
      messageKey: 'errors.pickupNotReady',
    });
  });

  it('sorts exact registration IDs and sends presenter evidence for QR generation', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            qr: 'imeal:v2:presenter:2026-09-24:a,b:1:nonce:sig',
            exp: 1_000,
            ttl: 5,
            registrationIds: ['a', 'b'],
            mealDate: '2026-09-24',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await pickupAPI.generateQr('token', {
      registrationIds: ['b', 'a'],
      presenterEvidence: {
        capturedAt: '2026-09-24T03:00:00.000Z',
        latitude: 10.77,
        longitude: 106.69,
        accuracyMeters: 12,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/me/qr',
      expect.objectContaining({
        body: JSON.stringify({
          registrationIds: ['a', 'b'],
          presenterEvidence: {
            capturedAt: '2026-09-24T03:00:00.000Z',
            latitude: 10.77,
            longitude: 106.69,
            accuracyMeters: 12,
          },
        }),
      }),
    );
  });
  it.each([
    ['b', 'a'],
    ['a', 'a'],
  ])(
    'rejects a non-canonical or mismatched registrationIds response (%s)',
    async (...registrationIds: string[]) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                qr: 'imeal:v2:presenter:2026-09-24:a,b:1:nonce:sig',
                exp: 1_000,
                ttl: 5,
                registrationIds,
                mealDate: '2026-09-24',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        ),
      );

      await expect(
        pickupAPI.generateQr('token', {
          registrationIds: ['a', 'b'],
          presenterEvidence: {
            capturedAt: '2026-09-24T03:00:00.000Z',
            latitude: 10.77,
            longitude: 106.69,
            accuracyMeters: 12,
          },
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it('resolves using only the QR payload', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            session: {
              id: 'session-1',
              userId: 'presenter-1',
              registrationIds: ['registration-1'],
              expiresAt: '2026-09-24T03:00:30.000Z',
              createdAt: '2026-09-24T03:00:00.000Z',
            },
            items: [
              {
                registrationId: 'registration-1',
                mealDate: '2026-09-24',
                mealChoice: 'REGULAR',
                type: 'OWN',
              },
            ],
            pickupSessionToken: 'session-1',
            intent: {
              userId: 'presenter-1',
              items: [
                {
                  id: 'registration-1',
                  itemName: 'Lunch',
                  quantity: 1,
                  mealChoice: 'REGULAR',
                },
              ],
              totalCount: 1,
              isProxy: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await pickupAPI.resolvePickup('token', { qr: 'qr-payload' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/serving/resolve',
      expect.objectContaining({
        body: JSON.stringify({ qr: 'qr-payload' }),
      }),
    );
  });
  it('rejects a confirm response whose servedCount is not all-or-nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              servedCount: 2,
              servings: [
                {
                  id: 'serving-1',
                  registrationId: 'registration-1',
                  servedAt: '2026-09-24T03:01:00.000Z',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(
      pickupAPI.confirmPickup('token', {
        pickupSessionId: 'session-1',
        idempotencyKey: 'idempotency-1',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('confirms only the resolved session and idempotency key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            servedCount: 1,
            servings: [
              {
                id: 'serving-1',
                registrationId: 'registration-1',
                servedAt: '2026-09-24T03:01:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await pickupAPI.confirmPickup('token', {
      pickupSessionId: 'session-1',
      idempotencyKey: 'idempotency-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/serving/confirm',
      expect.objectContaining({
        body: JSON.stringify({
          pickupSessionId: 'session-1',
          idempotencyKey: 'idempotency-1',
        }),
      }),
    );
  });

  it('rejects a malformed QR response instead of trusting unknown payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              qr: 'qr',
              exp: 1_000,
              ttl: 5,
              extra: 'unexpected',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(
      pickupAPI.generateQr('token', {
        registrationIds: ['registration-1'],
        presenterEvidence: {
          capturedAt: '2026-09-24T03:00:00.000Z',
          latitude: 10.77,
          longitude: 106.69,
          accuracyMeters: 12,
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
