import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';

export type RegistrationStatus = v1.RegistrationStatus;
export type MealChoice = v1.MealChoice;
export type RegistrationRecord = v1.RegistrationRecord;
export type DailyMenuRecord = v1.WeekDailyMenu;
export type RegistrationWindowDay = v1.RegistrationWindowDay;
export type RegistrationWindow = v1.RegistrationWindow;
export type WeekRegistrationResponse = v1.WeekRegistrationResponse;
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
    const payload: unknown = await response.json().catch(() => null);
    const parsed = v1.WeekRegistrationResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error('The registration response is invalid');
    return parsed.data;
  },

  batchRegister: async (
    registrations: v1.BatchRegistrationItem[],
    token: string,
  ): Promise<v1.BatchRegistrationResult[]> => {

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
