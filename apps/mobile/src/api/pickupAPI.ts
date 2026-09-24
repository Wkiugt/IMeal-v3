import { z } from 'zod';
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
export type GenerateQrInput = v1.GenerateQrInput;
export type ResolvePickupInput = v1.ResolvePickupInput;
export type ConfirmPickupInput = v1.ConfirmPickupInput;
export type ResolvePickupResponse = v1.ResolveServingResponse;

const GenerateQrResponseSchema = z
  .object({
    qr: z.string().min(1),
    exp: z.number().int().positive(),
    ttl: z.number().int().positive(),
    registrationIds: z.array(z.string().min(1)).min(1),
    mealDate: v1.MealDateSchema,
  })
  .strict();

const ConfirmPickupResponseSchema = z
  .object({
    success: z.literal(true),
    servedCount: z.number().int().nonnegative(),
    servings: z.array(
      z
        .object({
          id: z.string().min(1),
          registrationId: z.string().min(1),
          servedAt: z
            .string()
            .datetime({ offset: false })
            .refine((value) => value.endsWith('Z')),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.servedCount !== response.servings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['servedCount'],
        message: 'servedCount must equal servings.length',
      });
    }
  });

export type GenerateQrResponse = z.infer<typeof GenerateQrResponseSchema>;
export type ConfirmPickupResponse = z.infer<typeof ConfirmPickupResponseSchema>;

type PickupFallbackKey =
  | 'errors.loadPickup'
  | 'errors.generateQr'
  | 'errors.resolvePickup'
  | 'errors.confirmPickup';

async function fetchOrThrow(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackKey: PickupFallbackKey,
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
function assertExactRegistrationIds(
  response: GenerateQrResponse,
  requestedIds: readonly string[],
): GenerateQrResponse {
  const expected = [...requestedIds];
  const actual = response.registrationIds;
  const isCanonical =
    actual.length > 0 &&
    actual.every(
      (registrationId, index) =>
        index === 0 || actual[index - 1] < registrationId,
    );
  if (!isCanonical || actual.join('\u0000') !== expected.join('\u0000')) {
    throw new MobileApiError(
      'INVALID_RESPONSE',
      'errors.invalidResponse',
      response,
    );
  }
  return response;
}

export const pickupAPI = {
  getPickupOptions: async (token: string): Promise<PickupOptionsResponse> => {
    const payload = await fetchOrThrow(
      `${API_BASE}/me/pickup-options`,
      { headers: authHeaders(token) },
      'errors.loadPickup',
    );
    return parseResponse(v1.PickupOptionsResponseSchema, payload);
  },

  generateQr: async (
    token: string,
    input: GenerateQrInput,
  ): Promise<GenerateQrResponse> => {
    const registrationIds = [...input.registrationIds].sort((left, right) =>
      left.localeCompare(right),
    );
    const parsedInput = v1.GenerateQrSchema.safeParse({
      ...input,
      registrationIds,
    });
    if (!parsedInput.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsedInput.error,
      );
    }
    const payload = await fetchOrThrow(
      `${API_BASE}/me/qr`,
      {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(parsedInput.data),
      },
      'errors.generateQr',
    );
    const response = parseResponse(GenerateQrResponseSchema, payload);
    return assertExactRegistrationIds(
      response,
      parsedInput.data.registrationIds,
    );
  },

  resolvePickup: async (
    token: string,
    input: ResolvePickupInput,
  ): Promise<ResolvePickupResponse> => {
    const parsedInput = v1.ResolvePickupSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsedInput.error,
      );
    }
    const payload = await fetchOrThrow(
      `${API_BASE}/serving/resolve`,
      {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(parsedInput.data),
      },
      'errors.resolvePickup',
    );
    return parseResponse(v1.ResolveServingResponseSchema, payload);
  },

  confirmPickup: async (
    token: string,
    input: ConfirmPickupInput,
  ): Promise<ConfirmPickupResponse> => {
    const parsedInput = v1.ConfirmPickupSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new MobileApiError(
        'INVALID_RESPONSE',
        'errors.invalidResponse',
        parsedInput.error,
      );
    }
    const payload = await fetchOrThrow(
      `${API_BASE}/serving/confirm`,
      {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(parsedInput.data),
      },
      'errors.confirmPickup',
    );
    return parseResponse(ConfirmPickupResponseSchema, payload);
  },
};
