export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

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

export const kitchenAPI = {
  getDashboardSnapshot: async (
    date: string | undefined,
    token: string,
  ): Promise<KitchenDashboardSnapshot> => {
    const url = date
      ? `${API_BASE}/kitchen/days/${date}/dashboard`
      : `${API_BASE}/kitchen/today/dashboard`;
    const headers = { Authorization: `Bearer ${token}` };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Failed to load dashboard snapshot');
    }
    return res.json();
  },

  toggleServingSignal: async (
    isReady: boolean,
    date: string | undefined,
    token: string,
  ): Promise<{ success: boolean; isServingReady: boolean; date?: string }> => {
    const url = date
      ? `${API_BASE}/kitchen/days/${date}/signal`
      : `${API_BASE}/kitchen/signal`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ isServingReady: isReady }),
    });
    if (!res.ok) {
      throw new Error('Failed to toggle serving signal');
    }
    return res.json();
  },
};
