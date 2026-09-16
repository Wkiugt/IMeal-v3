import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export type KitchenDashboardCounters = v1.KitchenDashboardCounters;
export type ServingLogItem = v1.ServingLogItem;
export type KitchenRegistrationItem = v1.KitchenRegistrationItem;
export type KitchenDashboardSnapshot = v1.KitchenDashboardSnapshot;

type KitchenErrorKey = 'errors.loadKitchen' | 'errors.toggleServing';

function isServingSignalResponse(value: unknown): value is { success: boolean; isServingReady: boolean; date?: string } {
  if (value === null || typeof value !== 'object') return false;
  if (!('success' in value) || !('isServingReady' in value)) return false;
  return typeof value.success === 'boolean'
    && typeof value.isServingReady === 'boolean'
    && (!('date' in value) || typeof value.date === 'string');
}


async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackKey: KitchenErrorKey,
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

export const kitchenAPI = {
  getDashboardSnapshot: async (
    date: string | undefined,
    token: string,
  ): Promise<KitchenDashboardSnapshot> => {
    const url = date
      ? `${API_BASE}/kitchen/days/${date}/dashboard`
      : `${API_BASE}/kitchen/today/dashboard`;
    const payload = await requestJson(url, { headers: { Authorization: `Bearer ${token}` } }, 'errors.loadKitchen');
    const parsed = v1.KitchenDashboardSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
    }
    return parsed.data;
  },

  toggleServingSignal: async (
    isReady: boolean,
    date: string | undefined,
    token: string,
  ): Promise<{ success: boolean; isServingReady: boolean; date?: string }> => {
    const url = date
      ? `${API_BASE}/kitchen/days/${date}/signal`
      : `${API_BASE}/kitchen/signal`;
    const payload = await requestJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isServingReady: isReady }),
    }, 'errors.toggleServing');
    if (!isServingSignalResponse(payload)) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
    }
    return payload;
  },
};
