import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));
import { MobileApiError } from './mobileApiError';
import { servingAPI } from './servingAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('servingAPI', () => {
  it('maps an expired pickup session to a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'PICKUP_SESSION_EXPIRED',
      message: 'Pickup session has expired',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));

    await expect(servingAPI.confirmServing({ pickupSessionToken: 'expired' }, 'token'))
      .rejects.toMatchObject({
        code: 'PICKUP_SESSION_EXPIRED',
        messageKey: 'errors.pickupSessionExpired',
      });
  });

  it('maps duplicate serving to a typed error without exposing raw copy as UI text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'DUPLICATE_SERVING',
      message: 'Warning: This serving has already been fulfilled.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));

    const result = servingAPI.confirmServing({ pickupSessionToken: 'duplicate' }, 'token');
    await expect(result).rejects.toMatchObject({
      code: 'DUPLICATE_SERVING',
      messageKey: 'errors.duplicateServing',
    });
  });
});
