import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export interface KitchenDashboardCounters {
  totalRegistered: number;
  servedTotal: number;
  remaining: number;
  noShowTotal: number;
}

export interface ServingLogItem {
  id: string;
  registrationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  servedAt: string;
  isProxy: boolean;
}

export interface KitchenRegistrationItem {
  registrationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  isServed: boolean;
  servedAt?: string | null;
}

export interface KitchenDashboardSnapshot {
  date: string;
  isServingReady: boolean;
  counters: KitchenDashboardCounters;
  recentLogs: ServingLogItem[];
  lists: {
    served: KitchenRegistrationItem[];
    pending: KitchenRegistrationItem[];
    all: KitchenRegistrationItem[];
    noShow?: KitchenRegistrationItem[];
  };
}

type KitchenErrorKey = 'errors.loadKitchen' | 'errors.toggleServing';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isKitchenRegistrationItem(value: unknown): value is KitchenRegistrationItem {
  if (!isObject(value)) return false;
  return typeof value.registrationId === 'string'
    && typeof value.userId === 'string'
    && typeof value.userName === 'string'
    && typeof value.userEmail === 'string'
    && typeof value.isServed === 'boolean'
    && (!('servedAt' in value) || value.servedAt === null || typeof value.servedAt === 'string');
}

function isServingLogItem(value: unknown): value is ServingLogItem {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && typeof value.registrationId === 'string'
    && typeof value.userId === 'string'
    && typeof value.userName === 'string'
    && typeof value.userEmail === 'string'
    && typeof value.servedAt === 'string'
    && typeof value.isProxy === 'boolean';
}

function isKitchenDashboardSnapshot(value: unknown): value is KitchenDashboardSnapshot {
  if (!isObject(value) || !isObject(value.counters) || !isObject(value.lists)) return false;
  const counters = value.counters;
  const lists = value.lists;
  return typeof value.date === 'string'
    && typeof value.isServingReady === 'boolean'
    && typeof counters.totalRegistered === 'number'
    && typeof counters.servedTotal === 'number'
    && typeof counters.remaining === 'number'
    && typeof counters.noShowTotal === 'number'
    && Array.isArray(value.recentLogs)
    && value.recentLogs.every(isServingLogItem)
    && Array.isArray(lists.served)
    && lists.served.every(isKitchenRegistrationItem)
    && Array.isArray(lists.pending)
    && lists.pending.every(isKitchenRegistrationItem)
    && Array.isArray(lists.all)
    && lists.all.every(isKitchenRegistrationItem)
    && (!('noShow' in lists) || (Array.isArray(lists.noShow) && lists.noShow.every(isKitchenRegistrationItem)));
}

function isServingSignalResponse(value: unknown): value is { success: boolean; isServingReady: boolean; date?: string } {
  if (!isObject(value)) return false;
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
    if (!isKitchenDashboardSnapshot(payload)) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
    }
    return payload;
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
