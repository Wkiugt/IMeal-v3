import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

export interface CreateDelegationRequest {
  registrationId: string;
  delegateUserId: string;
}

export interface DelegationResponse {
  id: string;
  registrationId: string;
  delegateUserId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
  createdAt: string;
  updatedAt: string;
}

type DelegationErrorKey = 'errors.loadDelegations' | 'errors.delegationAction';

function isDelegationResponse(payload: unknown): payload is DelegationResponse {
  if (payload === null || typeof payload !== 'object') return false;
  if (!('id' in payload) || !('registrationId' in payload) || !('delegateUserId' in payload)) return false;
  if (!('status' in payload) || !('createdAt' in payload) || !('updatedAt' in payload)) return false;
  return typeof payload.id === 'string'
    && typeof payload.registrationId === 'string'
    && typeof payload.delegateUserId === 'string'
    && (payload.status === 'PENDING' || payload.status === 'ACCEPTED' || payload.status === 'DECLINED' || payload.status === 'REVOKED')
    && typeof payload.createdAt === 'string'
    && typeof payload.updatedAt === 'string';
}

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

function parseDelegation(payload: unknown, fallbackKey: DelegationErrorKey): DelegationResponse {
  if (isDelegationResponse(payload)) return payload;
  throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', { payload, fallbackKey });
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
    'errors.delegationAction',
  ),

  acceptDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
    'errors.delegationAction',
  ),

  declineDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/decline`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
    'errors.delegationAction',
  ),

  revokeDelegation: async (id: string, token: string): Promise<DelegationResponse> => parseDelegation(
    await requestJson(`${API_BASE}/delegations/${id}/revoke`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }, 'errors.delegationAction'),
    'errors.delegationAction',
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
    if (!Array.isArray(payload) || !payload.every(isDelegationResponse)) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
    }
    return payload;
  },
};
