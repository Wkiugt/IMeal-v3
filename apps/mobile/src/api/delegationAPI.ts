import { API_BASE } from './apiConfig';

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

// NOTE: Uses fetch for network requests.
// Ensure your app passes auth tokens via headers if needed.
export const delegationAPI = {
  createDelegation: async (
    data: CreateDelegationRequest,
    token: string,
  ): Promise<DelegationResponse> => {
    const res = await fetch(`${API_BASE}/delegations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to create delegation');
    }
    return res.json();
  },

  acceptDelegation: async (
    id: string,
    token: string,
  ): Promise<DelegationResponse> => {
    const res = await fetch(`${API_BASE}/delegations/${id}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to accept delegation');
    }
    return res.json();
  },

  declineDelegation: async (
    id: string,
    token: string,
  ): Promise<DelegationResponse> => {
    const res = await fetch(`${API_BASE}/delegations/${id}/decline`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to decline delegation');
    }
    return res.json();
  },

  revokeDelegation: async (
    id: string,
    token: string,
  ): Promise<DelegationResponse> => {
    const res = await fetch(`${API_BASE}/delegations/${id}/revoke`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to revoke delegation');
    }
    return res.json();
  },

  getDelegations: async (
    token: string,
    type: 'incoming' | 'outgoing',
  ): Promise<DelegationResponse[]> => {
    const res = await fetch(
      `${API_BASE}/delegations?type=${encodeURIComponent(type)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      throw new Error('Failed to load delegations');
    }
    return res.json();
  },
};
