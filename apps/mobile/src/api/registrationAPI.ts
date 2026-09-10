import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';

export type RegistrationStatus = v1.RegistrationStatus;

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

export interface RegistrationWindowDay {
  mealDate: string;
  cutoffAt: string;
  editable: boolean;
}

export interface RegistrationWindow {
  serverNow: string;
  timeZone: 'Asia/Ho_Chi_Minh';
  days: RegistrationWindowDay[];
}

export interface WeekRegistrationResponse {
  menu: { dailyMenus: DailyMenuRecord[] } | null;
  registrations: RegistrationRecord[];
  registrationWindow: RegistrationWindow;
}

export type BatchRegistrationResult = v1.BatchRegistrationResult;

export const registrationAPI = {
  getWeek: async (startDate: string, token: string): Promise<WeekRegistrationResponse> => {
    const response = await fetch(`${API_BASE}/registrations/week?startDate=${encodeURIComponent(startDate)}`, {
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
    const response = await fetch(`${API_BASE}/registrations/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ registrations }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update meal registrations');
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = v1.BatchRegistrationResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error('The registration response is invalid');
    }
    return parsed.data;
  },
};
