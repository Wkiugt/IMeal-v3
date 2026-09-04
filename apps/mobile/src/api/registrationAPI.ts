const API_ROOT = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '');

export type RegistrationStatus = 'ACTIVE' | 'CANCELLED';

export interface RegistrationRecord {
  id: string;
  mealDate: string;
  status: RegistrationStatus;
}

export interface DailyMenuRecord {
  date: string;
  isHoliday: boolean;
  isEnabled: boolean;
  mealDays?: Array<{ mealType: string; isServingReady: boolean }>;
}

export interface WeekRegistrationResponse {
  menu: { dailyMenus: DailyMenuRecord[] } | null;
  registrations: RegistrationRecord[];
}

export interface BatchRegistrationResult {
  date: string;
  success: boolean;
  reason?: string;
}

export const registrationAPI = {
  getWeek: async (startDate: string, token: string): Promise<WeekRegistrationResponse> => {
    const response = await fetch(`${API_ROOT}/registrations/week?startDate=${encodeURIComponent(startDate)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to load meal registrations');
    }
    return response.json();
  },

  batchRegister: async (
    registrations: Array<{ mealDate: string; status: RegistrationStatus }>,
    token: string,
  ): Promise<BatchRegistrationResult[]> => {
    const response = await fetch(`${API_ROOT}/registrations/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ registrations }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update meal registrations');
    }
    return response.json();
  },
};
