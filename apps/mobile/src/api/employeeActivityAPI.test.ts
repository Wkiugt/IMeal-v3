import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileApiError } from './mobileApiError';

vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test/api' }));

import { employeeActivityAPI } from './employeeActivityAPI';

const activity = {
  id: 'registration-1',
  mealDate: '2026-09-30',
  status: 'CANCELLED',
  mealChoice: 'REGULAR',
  menuRevisionId: null,
  menuNameSnapshot: null,
  menuDescriptionSnapshot: null,
  menuImageSnapshot: null,
  serviceLocationId: null,
  serviceLocationAssignmentId: null,
  serviceLocationCode: null,
  serviceLocationName: null,
  serviceLocationAddress: null,
  serviceLocationEffectiveFrom: null,
  serviceLocationSnapshotAt: null,
  registeredAt: '2026-09-29T03:00:00.000Z',
  cancelledAt: '2026-09-29T04:00:00.000Z',
  noShowAt: null,
  servedAt: null,
  createdAt: '2026-09-29T03:00:00.000Z',
  updatedAt: '2026-09-29T04:00:00.000Z',
  penalties: [],
} as const;

const pagination = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
} as const;
const pageTwoPagination = {
  page: 2,
  limit: 20,
  total: 21,
  totalPages: 2,
  hasNextPage: false,
} as const;

const penalty = {
  id: 'penalty-1',
  amount: 50000,
  reason: 'No-show',
  status: 'PAID',
  mealDate: '2026-09-30',
  createdAt: '2026-10-01T06:45:00.000Z',
  paidAt: '2026-10-02T06:45:00.000Z',
  waivedAt: null,
  waiveReason: null,
  registration: null,
} as const;
const registrationContext = {
  id: 'registration-1',
  mealDate: '2026-09-30',
  status: 'CANCELLED',
  mealChoice: 'REGULAR',
  menuRevisionId: null,
  menuNameSnapshot: null,
  menuDescriptionSnapshot: null,
  menuImageSnapshot: null,
  serviceLocationId: null,
  serviceLocationAssignmentId: null,
  serviceLocationCode: null,
  serviceLocationName: null,
  serviceLocationAddress: null,
  serviceLocationEffectiveFrom: null,
  serviceLocationSnapshotAt: null,
  registeredAt: '2026-09-29T03:00:00.000Z',
  cancelledAt: '2026-09-29T04:00:00.000Z',
  noShowAt: null,
  servedAt: null,
  createdAt: '2026-09-29T03:00:00.000Z',
  updatedAt: '2026-09-29T04:00:00.000Z',
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('employeeActivityAPI', () => {
  it('loads server-selected stats with bearer authentication and preserves the period', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              period: {
                month: '2026-09',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
              },
              booked: 0,
              enjoyed: 0,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      employeeActivityAPI.getStats('session-token'),
    ).resolves.toEqual({
      data: {
        period: {
          month: '2026-09',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
        },
        booked: 0,
        enjoyed: 0,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/registrations/stats',
      expect.objectContaining({
        headers: { Authorization: 'Bearer session-token' },
      }),
    );
  });
  it('rejects invalid stats counts and periods with the localized response error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              period: {
                month: '2026-09',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
              },
              booked: -1,
              enjoyed: 0,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              period: {
                month: '2026-13',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
              },
              booked: 0,
              enjoyed: 0,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      employeeActivityAPI.getStats('session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
    await expect(
      employeeActivityAPI.getStats('session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });

  it('loads history and appends strict page query values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [activity],
              meta: { pagination: pageTwoPagination },
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      employeeActivityAPI.getHistory('session-token', { page: 2, limit: 20 }),
    ).resolves.toMatchObject({
      data: [activity],
      meta: { pagination: pageTwoPagination },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/registrations/history?page=2&limit=20',
      expect.anything(),
    );
  });

  it('loads filtered penalties and self penalty detail with immutable context', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [penalty], meta: { pagination } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: penalty }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      employeeActivityAPI.getPenaltyList('session-token', {
        page: 1,
        limit: 20,
        status: 'PAID',
      }),
    ).resolves.toMatchObject({ data: [penalty] });
    await expect(
      employeeActivityAPI.getPenaltyDetail('penalty/1', 'session-token'),
    ).resolves.toEqual({ data: penalty });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/api/penalties?page=1&limit=20&status=PAID',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/penalties/penalty%2F1',
      expect.anything(),
    );
  });
  it('rejects malformed penalty list status, amount, and timestamp fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ ...penalty, status: 'UNKNOWN' }],
            meta: { pagination },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ ...penalty, amount: -1 }],
            meta: { pagination },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ ...penalty, createdAt: 'not-an-instant' }],
            meta: { pagination },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      employeeActivityAPI.getPenaltyList('session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
    await expect(
      employeeActivityAPI.getPenaltyList('session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
    await expect(
      employeeActivityAPI.getPenaltyList('session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });

  it('rejects malformed non-null penalty registration context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                ...penalty,
                registration: {
                  ...registrationContext,
                  servedAt: 'not-an-instant',
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      employeeActivityAPI.getPenaltyDetail('penalty-1', 'session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });

  it('rejects an empty penalty id before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      employeeActivityAPI.getPenaltyDetail('  ', 'session-token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed activity payloads before exposing them to screens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ ...activity, status: 'UNKNOWN' }],
              meta: { pagination },
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      employeeActivityAPI.getHistory('session-token', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });

  it('preserves typed not-found errors for missing or foreign detail ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }),
      ),
    );

    await expect(
      employeeActivityAPI.getPenaltyDetail('penalty-1', 'session-token'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('maps canonical unauthorized envelopes to a typed localized auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'UNAUTHORIZED',
                message: 'Session is invalid',
              },
              requestId: 'qa-request-unauthorized',
            }),
            { status: 401 },
          ),
      ),
    );

    const pending = employeeActivityAPI.getHistory('session-token');
    await expect(pending).rejects.toBeInstanceOf(MobileApiError);
    await expect(pending).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      messageKey: 'errors.sessionInvalid',
    });
  });
});
