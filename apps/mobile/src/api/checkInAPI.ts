import { z } from 'zod';
import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import { fetchWithTimeout } from './requestWithTimeout';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export type CheckInStatus = v1.CheckInStatus;
export type CheckInQr = v1.CheckInQr;
export type ResolveCheckInInput = v1.ResolveCheckInInput;
export type ResolveCheckInData = v1.ResolveCheckInData;
export type ConfirmCheckInInput = v1.ConfirmCheckInInput;
export type ConfirmCheckInData = v1.ConfirmCheckInData;
export type KitchenCheckInDashboard = v1.KitchenCheckInDashboard;

const CHECK_IN_REQUEST_TIMEOUT_MS = 10_000;

type CheckInFallbackKey =
  | 'errors.loadCheckIn'
  | 'errors.resolveCheckIn'
  | 'errors.confirmCheckIn'
  | 'errors.loadKitchenQr'
  | 'errors.loadKitchenDashboard';

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackKey: CheckInFallbackKey,
  token: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      input,
      init,
      CHECK_IN_REQUEST_TIMEOUT_MS,
    );
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }

  if (!response.ok) {
    await throwMobileResponseError(response, fallbackKey, { token });
  }
  return readMobileResponseJson(response, fallbackKey);
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function jsonAuthHeaders(token: string): Record<string, string> {
  return {
    ...authHeaders(token),
    'Content-Type': 'application/json',
  };
}

function parseResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new MobileApiError(
      'INVALID_RESPONSE',
      'errors.invalidResponse',
      parsed.error,
    );
  }
  return parsed.data;
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new MobileApiError(
      'INVALID_RESPONSE',
      'errors.invalidResponse',
      parsed.error,
    );
  }
  return parsed.data;
}

export const checkInAPI = {
  getStatus: async (token: string): Promise<v1.CheckInStatusResponse> => {
    const payload = await requestJson(
      `${API_BASE}/me/check-in`,
      { headers: authHeaders(token) },
      'errors.loadCheckIn',
      token,
    );
    return parseResponse(v1.CheckInStatusResponseSchema, payload);
  },

  resolve: async (
    token: string,
    input: ResolveCheckInInput,
  ): Promise<v1.ResolveCheckInResponse> => {
    const parsedInput = parseInput(v1.ResolveCheckInSchema, input);
    const payload = await requestJson(
      `${API_BASE}/me/check-in/resolve`,
      {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(parsedInput),
      },
      'errors.resolveCheckIn',
      token,
    );
    return parseResponse(v1.ResolveCheckInResponseSchema, payload);
  },

  confirm: async (
    token: string,
    input: ConfirmCheckInInput,
  ): Promise<v1.ConfirmCheckInResponse> => {
    const parsedInput = parseInput(v1.ConfirmCheckInSchema, input);
    const payload = await requestJson(
      `${API_BASE}/me/check-in/confirm`,
      {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(parsedInput),
      },
      'errors.confirmCheckIn',
      token,
    );
    return parseResponse(v1.ConfirmCheckInResponseSchema, payload);
  },

  getKitchenQr: async (token: string): Promise<v1.KitchenCheckInQrResponse> => {
    const payload = await requestJson(
      `${API_BASE}/kitchen/check-in/qr`,
      { headers: authHeaders(token) },
      'errors.loadKitchenQr',
      token,
    );
    return parseResponse(v1.KitchenCheckInQrResponseSchema, payload);
  },

  getKitchenDashboard: async (
    token: string,
    date?: string,
  ): Promise<v1.KitchenCheckInDashboardResponse> => {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
    const payload = await requestJson(
      `${API_BASE}/kitchen/check-in/dashboard${suffix}`,
      { headers: authHeaders(token) },
      'errors.loadKitchenDashboard',
      token,
    );
    return parseResponse(v1.KitchenCheckInDashboardResponseSchema, payload);
  },
};
