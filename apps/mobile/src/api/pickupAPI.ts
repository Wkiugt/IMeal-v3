import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';

export interface PickupOption {
  type: 'OWN' | 'DELEGATED';
  registrationId: string;
  mealDate: string;
  delegationId?: string;
  owner?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface PickupOptionsResponse {
  options: PickupOption[];
}

export interface GenerateQrResponse {
  qr: string;
  exp: number;
  ttl: number;
}

export class PickupAvailabilityApiError extends Error {
  readonly code: v1.PickupAvailabilityCode;
  readonly status: number;
  readonly details: v1.PickupAvailabilityError['details'];

  constructor(payload: v1.PickupAvailabilityError, status: number) {
    super(payload.message);
    this.name = 'PickupAvailabilityApiError';
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
  }
}

async function throwPickupError(
  response: Response,
  fallbackMessage: string,
): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  const bodyObject =
    body !== null && typeof body === 'object'
      ? (body as { message?: unknown; error?: unknown })
      : undefined;
  const candidates = [body, bodyObject?.message, bodyObject?.error];
  const parsedPayload = candidates
    .map((candidate) =>
      v1.PickupAvailabilityErrorSchema.safeParse(candidate),
    )
    .find((result) => result.success);
  if (response.status === 403 && parsedPayload?.success) {
    throw new PickupAvailabilityApiError(parsedPayload.data, response.status);
  }

  const message =
    typeof bodyObject?.message === 'string' ? bodyObject.message : undefined;
  throw new Error(message || fallbackMessage);
}

async function fetchOrThrow(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackMessage: string,
): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      return await throwPickupError(response, fallbackMessage);
    }
    return response;
  } catch (error: unknown) {
    if (error instanceof PickupAvailabilityApiError) {
      throw error;
    }
    throw new Error(fallbackMessage);
  }
}

export const pickupAPI = {
  getPickupOptions: async (token: string): Promise<PickupOptionsResponse> => {
    const res = await fetchOrThrow(
      `${API_BASE}/me/pickup-options`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      'Failed to get pickup options',
    );
    return res.json();
  },

  generateQr: async (
    token: string,
    registrationIds: string[],
  ): Promise<GenerateQrResponse> => {
    const res = await fetchOrThrow(
      `${API_BASE}/me/qr`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ registrationIds }),
      },
      'Failed to generate QR',
    );
    return res.json();
  },
};
