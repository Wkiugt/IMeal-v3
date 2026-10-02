import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export interface ResolveServingRequest {
  qrPayload: string;
}

export type ServingItem = v1.ServingIntentItem;
export type ResolveServingResponse = v1.ResolveServingResponse;

export interface ConfirmServingRequest {
  pickupSessionToken: string;
}

export interface ConfirmServingResponse {
  success: boolean;
  message?: string;
}

async function postServingRequest(
  path: string,
  data: object,
  token: string,
  fallbackKey: 'errors.resolveServing' | 'errors.confirmServing',
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }
  if (!response.ok)
    await throwMobileResponseError(response, fallbackKey, { token });
  return readMobileResponseJson(response, fallbackKey);
}

function isConfirmServingResponse(
  payload: unknown,
): payload is ConfirmServingResponse {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('success' in payload)
  )
    return false;
  if (typeof payload.success !== 'boolean') return false;
  return !('message' in payload) || typeof payload.message === 'string';
}

export const servingAPI = {
  resolveServing: async (
    data: ResolveServingRequest,
    token: string,
  ): Promise<ResolveServingResponse> => {
    const payload = await postServingRequest(
      '/serving/resolve',
      data,
      token,
      'errors.resolveServing',
    );
    const parsed = v1.ResolveServingResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsed.error,
      );
    }
    return parsed.data;
  },

  confirmServing: async (
    data: ConfirmServingRequest,
    token: string,
  ): Promise<ConfirmServingResponse> => {
    const payload = await postServingRequest(
      '/serving/confirm',
      data,
      token,
      'errors.confirmServing',
    );
    if (!isConfirmServingResponse(payload)) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        payload,
      );
    }
    return payload;
  },
};
