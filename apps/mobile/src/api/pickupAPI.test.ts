import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));
import { MobileApiError } from './mobileApiError';
import { pickupAPI } from './pickupAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickupAPI', () => {
  it('maps pickup availability failures to MobileApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'PICKUP_NOT_READY',
      message: 'Meal pickup is not currently available. Please wait for the kitchen signal.',
      details: {
        availableFrom: '10:30',
        availableUntil: '13:30',
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } })));

    await expect(pickupAPI.getPickupOptions('token')).rejects.toMatchObject({
      code: 'PICKUP_NOT_READY',
      messageKey: 'errors.pickupNotReady',
    });
  });
});
