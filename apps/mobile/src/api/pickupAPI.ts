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

export const pickupAPI = {
  getPickupOptions: async (token: string): Promise<PickupOptionsResponse> => {
    const res = await fetch(`${API_BASE}/me/pickup-options`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to get pickup options');
    }
    return res.json();
  },

  generateQr: async (
    token: string,
    registrationIds: string[],
  ): Promise<GenerateQrResponse> => {
    const res = await fetch(`${API_BASE}/me/qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ registrationIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to generate QR');
    }
    return res.json();
  },
};
