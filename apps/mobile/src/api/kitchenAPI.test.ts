import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));

import { kitchenAPI } from './kitchenAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('kitchenAPI', () => {
  it('rejects dashboard payloads missing dietary totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      date: '2026-09-15',
      isServingReady: true,
      counters: { totalRegistered: 1, servedTotal: 0, remaining: 1, noShowTotal: 0 },
      recentLogs: [],
      lists: { served: [], pending: [], all: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(kitchenAPI.getDashboardSnapshot(undefined, 'token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });

  it('rejects registration items missing meal choice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      date: '2026-09-15',
      isServingReady: true,
      counters: {
        totalRegistered: 1,
        regularTotal: 1,
        vegetarianTotal: 0,
        servedTotal: 0,
        remaining: 1,
        noShowTotal: 0,
      },
      recentLogs: [],
      lists: {
        served: [],
        pending: [{
          registrationId: 'registration-1',
          userId: 'user-1',
          userName: 'User',
          userEmail: 'user@example.test',
          isServed: false,
        }],
        all: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(kitchenAPI.getDashboardSnapshot(undefined, 'token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });
});
