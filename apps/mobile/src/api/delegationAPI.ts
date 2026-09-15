import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export type CreateDelegationRequest = v1.CreateDelegationRequest;
export type DelegationResponse = v1.DelegationResponse;

type DelegationErrorKey = 'errors.loadDelegations' | 'errors.delegationAction';

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackKey: DelegationErrorKey,
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

function parseDelegation(payload: unknown): DelegationResponse {
  const parsed = v1.DelegationResponseSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
}

export const delegationAPI = {
  createDelegation: async (
    data: CreateDelegationRequest,
    token: string,
  ): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    }, 'errors.delegationAction'),
  ),

  acceptDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
  ),

  declineDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/decline`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
  ),

  revokeDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/revoke`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
  ),

  getDelegations: async (
    token: string,
    type: 'incoming' | 'outgoing',
  ): Promise<DelegationResponse[]> => {
    const payload = await requestJson(
      `${API_BASE}/delegations?type=${encodeURIComponent(type)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      'errors.loadDelegations',
    );
    const parsed = v1.DelegationResponseSchema.array().safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
    }
    return parsed.data;
  },
};
