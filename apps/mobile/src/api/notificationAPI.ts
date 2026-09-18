import { z } from 'zod';
import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export type NotificationItem = v1.NotificationItem;
export type NotificationListResponse = v1.NotificationListResponse;
export type NotificationDetailResponse = v1.NotificationDetailResponse;
export type NotificationPreferences = v1.NotificationPreferencesResponse['data'];
export type RegisterPushDeviceRequest = v1.RegisterPushDeviceRequest;
export type PushDevicePlatform = v1.PushDevicePlatform;

const PushDeviceResponseSchema = z.object({
  data: z.object({
    token: v1.ExpoPushTokenSchema,
    platform: v1.PushDevicePlatformSchema,
    lastSeenAt: v1.NotificationTimestampSchema,
  }).strict(),
}).strict();

const PushDeviceRevokeResponseSchema = z.object({
  data: z.object({ token: v1.ExpoPushTokenSchema }).strict(),
}).strict();

async function request(
  path: string,
  token: string,
  fallbackKey: 'errors.loadNotifications' | 'errors.loadNotification' | 'errors.updateNotification' | 'errors.loadPreferences' | 'errors.updatePreferences' | 'errors.registerPushDevice' | 'errors.revokePushDevice',
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }
  if (!response.ok) await throwMobileResponseError(response, fallbackKey);
  return readMobileResponseJson(response, fallbackKey);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
  }
  return parsed.data;
}

export const notificationAPI = {
  getList: async (
    token: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<NotificationListResponse> => {
    const query = new URLSearchParams();
    if (options.cursor) query.set('cursor', options.cursor);
    query.set('limit', String(options.limit ?? 20));
    const payload = await request(
      `/notifications?${query.toString()}`,
      token,
      'errors.loadNotifications',
    );
    return parseOrThrow(v1.NotificationListResponseSchema, payload);
  },

  getDetail: async (notificationId: string, token: string): Promise<NotificationDetailResponse> => {
    const id = v1.NotificationIdSchema.safeParse(notificationId);
    if (!id.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', id.error);
    }
    const payload = await request(
      `/notifications/${encodeURIComponent(id.data)}`,
      token,
      'errors.loadNotification',
    );
    return parseOrThrow(v1.NotificationDetailResponseSchema, payload);
  },

  markRead: async (notificationId: string, token: string): Promise<NotificationDetailResponse> => {
    const id = v1.NotificationIdSchema.safeParse(notificationId);
    if (!id.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', id.error);
    }
    const payload = await request(
      `/notifications/${encodeURIComponent(id.data)}/read`,
      token,
      'errors.updateNotification',
      { method: 'PATCH' },
    );
    return parseOrThrow(v1.NotificationReadResponseSchema, payload);
  },

  getPreferences: async (token: string): Promise<NotificationPreferences> => {
    const payload = await request('/notifications/preferences', token, 'errors.loadPreferences');
    return parseOrThrow(v1.NotificationPreferencesResponseSchema, payload).data;
  },

  updatePreferences: async (
    updates: v1.NotificationPreferencesRequest,
    token: string,
  ): Promise<NotificationPreferences> => {
    const body = v1.NotificationPreferencesRequestSchema.safeParse(updates);
    if (!body.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', body.error);
    }
    const payload = await request('/notifications/preferences', token, 'errors.updatePreferences', {
      method: 'PATCH',
      body: JSON.stringify(body.data),
    });
    return parseOrThrow(v1.NotificationPreferencesResponseSchema, payload).data;
  },

  registerPushDevice: async (
    registration: RegisterPushDeviceRequest,
    token: string,
  ) => {
    const body = v1.RegisterPushDeviceRequestSchema.safeParse(registration);
    if (!body.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', body.error);
    }
    const payload = await request('/notifications/push-devices', token, 'errors.registerPushDevice', {
      method: 'POST',
      body: JSON.stringify(body.data),
    });
    return parseOrThrow(PushDeviceResponseSchema, payload).data;
  },

  revokePushDevice: async (pushToken: string, token: string) => {
    const body = v1.RevokePushDeviceRequestSchema.safeParse({ token: pushToken });
    if (!body.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', body.error);
    }
    const payload = await request('/notifications/push-devices', token, 'errors.revokePushDevice', {
      method: 'DELETE',
      body: JSON.stringify(body.data),
    });
    return parseOrThrow(PushDeviceRevokeResponseSchema, payload).data;
  },
};
