import { z } from 'zod';
import { v1 } from '@imeal/contracts';
import { API_ROOT } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

type AuthFallbackKey =
  | 'errors.requestOtp'
  | 'errors.verifyOtp'
  | 'errors.restoreSession'
  | 'errors.logOut';

const CurrentUserSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    email: z.string().email(),
    name: z.string().optional(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    sessionId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type MobileProfile = z.infer<typeof CurrentUserSchema>;
export type VerifyOtpInput =
  | Pick<v1.VerifyOtpInput, 'email' | 'code'>
  | v1.VerifyOtpInput;
export type VerifyOtpResponse = v1.VerifyOtpResponse;
export type RequestOtpResponse = v1.RequestOtpResponse;
export type LogoutResponse = v1.LogoutResponse;

async function requestJson(
  path: string,
  init: RequestInit,
  fallbackKey: AuthFallbackKey,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, init);
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }
  if (!response.ok) await throwMobileResponseError(response, fallbackKey);
  return readMobileResponseJson(response, fallbackKey);
}

function jsonHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const authAPI = {
  requestOtp: async (email: string): Promise<RequestOtpResponse> => {
    const parsedInput = v1.RequestOtpSchema.safeParse({
      email: email.trim(),
      purpose: 'SESSION_LOGIN',
    });
    if (!parsedInput.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsedInput.error,
      );
    }
    const payload = await requestJson(
      '/auth/otp/request',
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(parsedInput.data),
      },
      'errors.requestOtp',
    );
    const parsed = v1.RequestOtpResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsed.error,
      );
    }
    return parsed.data;
  },

  verifyOtp: async (input: VerifyOtpInput): Promise<VerifyOtpResponse> => {
    const parsedInput = v1.VerifyOtpSchema.safeParse({
      ...input,
      email: input.email.trim(),
      purpose: 'SESSION_LOGIN',
    });
    if (!parsedInput.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsedInput.error,
      );
    }
    const payload = await requestJson(
      '/auth/otp/verify',
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(parsedInput.data),
      },
      'errors.verifyOtp',
    );
    const parsed = v1.VerifyOtpResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsed.error,
      );
    }
    return parsed.data;
  },

  bootstrapSession: async (token: string): Promise<MobileProfile> => {
    const payload = await requestJson(
      '/auth/me',
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      'errors.restoreSession',
    );
    const parsed = CurrentUserSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsed.error,
      );
    }
    return parsed.data;
  },

  logout: async (token: string): Promise<LogoutResponse> => {
    const payload = await requestJson(
      '/auth/logout',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      'errors.logOut',
    );
    const parsed = v1.LogoutResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsed.error,
      );
    }
    return parsed.data;
  },
};
