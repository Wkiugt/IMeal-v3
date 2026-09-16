import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export type PickupOption = v1.PickupOption;
export type PickupOptionsResponse = v1.PickupOptionsResponse;

export interface GenerateQrResponse {
  qr: string;
  exp: number;
  ttl: number;
}

function isGenerateQrResponse(payload: unknown): payload is GenerateQrResponse {
  if (payload === null || typeof payload !== 'object') return false;
  if (!('qr' in payload) || !('exp' in payload) || !('ttl' in payload)) return false;
  return typeof payload.qr === 'string'
    && typeof payload.exp === 'number'
    && typeof payload.ttl === 'number';
}

async function fetchOrThrow(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackKey: 'errors.loadPickup' | 'errors.generateQr',
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }

  if (!response.ok) await throwMobileResponseError(response, fallbackKey);
  return readMobileResponseJson(response, fallbackKey);
}

export const pickupAPI = {
  getPickupOptions: async (token: string): Promise<PickupOptionsResponse> => {
    const payload = await fetchOrThrow(
      `${API_BASE}/me/pickup-options`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      'errors.loadPickup',
    );
    const parsed = v1.PickupOptionsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
    }
    return parsed.data;
  },

  generateQr: async (
    token: string,
    registrationIds: string[],
  ): Promise<GenerateQrResponse> => {
    const payload = await fetchOrThrow(
      `${API_BASE}/me/qr`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ registrationIds }),
      },
      'errors.generateQr',
    );
    if (!isGenerateQrResponse(payload)) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
    }
    return payload;
  },
};
