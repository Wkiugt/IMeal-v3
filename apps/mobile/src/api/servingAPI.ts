const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

export interface ResolveServingRequest {
  qrPayload: string;
}

export interface ServingItem {
  id: string;
  itemName: string;
  quantity: number;
}

export interface ResolveServingResponse {
  pickupSessionToken: string;
  session: {
    expiresAt: string;
  };
  intent: {
    userId: string;
    items: ServingItem[];
    totalCount: number;
    isProxy: boolean;
  };
}

export interface ConfirmServingRequest {
  pickupSessionToken: string;
}

export interface ConfirmServingResponse {
  success: boolean;
  message?: string;
}

export const servingAPI = {
  resolveServing: async (
    data: ResolveServingRequest,
    token: string,
  ): Promise<ResolveServingResponse> => {
    const res = await fetch(`${API_BASE}/serving/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          'Access Denied. Ensure you are on the internal LAN and have Kitchen permissions.',
        );
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to resolve serving');
    }
    return res.json();
  },

  confirmServing: async (
    data: ConfirmServingRequest,
    token: string,
  ): Promise<ConfirmServingResponse> => {
    const res = await fetch(`${API_BASE}/serving/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Check for duplicate serving
      if (err.code === 'DUPLICATE_SERVING') {
        throw new Error('Warning: This serving has already been fulfilled.');
      }
      throw new Error(err.message || 'Failed to confirm serving');
    }
    return res.json();
  },
};
