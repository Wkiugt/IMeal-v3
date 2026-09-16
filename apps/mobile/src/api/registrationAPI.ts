import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

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
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/registrations/week?startDate=${encodeURIComponent(startDate)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error: unknown) {
      throw toMobileApiError(error, 'errors.loadCalendar');
    }
    if (!response.ok) await throwMobileResponseError(response, 'errors.loadCalendar');
    const payload = await readMobileResponseJson(response, 'errors.loadCalendar');
    const parsed = v1.WeekRegistrationResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
    }
    return parsed.data;
  },

  batchRegister: async (
    registrations: v1.BatchRegistrationItem[],
    token: string,
  ): Promise<v1.BatchRegistrationResult[]> => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/registrations/batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ registrations }),
      });
    } catch (error: unknown) {
      throw toMobileApiError(error, 'errors.updateRegistration');
    }
    if (!response.ok) await throwMobileResponseError(response, 'errors.updateRegistration');

    const payload = await readMobileResponseJson(response, 'errors.updateRegistration');
    const parsed = v1.BatchRegistrationResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', parsed.error);
    }
    return parsed.data;
  },
};
