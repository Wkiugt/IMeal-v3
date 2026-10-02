import { v1 } from '@imeal/contracts';
import { API_BASE } from './apiConfig';
import { fetchWithTimeout } from './requestWithTimeout';
import {
  MobileApiError,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from './mobileApiError';

const EMPLOYEE_ACTIVITY_TIMEOUT_MS = 10_000;
type ActivityFallbackKey =
  | 'errors.loadActivityStats'
  | 'errors.loadMealHistory'
  | 'errors.loadPenalties'
  | 'errors.loadPenalty';
const penaltyIdSchema = v1.SelfPenaltySchema.shape.id.trim().min(1);

export type EmployeeRegistrationActivity = v1.EmployeeRegistrationActivity;
export type EmployeePenaltySummary = v1.EmployeePenaltySummary;
export type SelfPenalty = v1.SelfPenalty;
export type RegistrationStats = v1.RegistrationStats;
export type ActivityPageMeta = v1.PagePaginationMeta;
export type RegistrationHistoryResponse = v1.RegistrationHistoryResponse;
export type RegistrationStatsResponse = v1.RegistrationStatsResponse;
export type SelfPenaltyListResponse = v1.SelfPenaltyListResponse;
export type SelfPenaltyDetailResponse = v1.SelfPenaltyDetailResponse;

async function request(
  path: string,
  token: string,
  fallbackKey: ActivityFallbackKey,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${API_BASE}${path}`,
      { headers: { Authorization: `Bearer ${token}` } },
      EMPLOYEE_ACTIVITY_TIMEOUT_MS,
    );
  } catch (error: unknown) {
    throw toMobileApiError(error, fallbackKey);
  }
  if (!response.ok)
    await throwMobileResponseError(response, fallbackKey, { token });
  return readMobileResponseJson(response, fallbackKey);
}

function parseOrThrow<T>(
  schema: {
    safeParse: (
      payload: unknown,
    ) => { success: true; data: T } | { success: false; error: unknown };
  },
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new MobileApiError(
    'INVALID_RESPONSE',
    'errors.invalidResponse',
    parsed.error,
  );
}

function invalidInput(cause: unknown): never {
  throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', cause);
}

function parseHistoryQuery(input: {
  page?: number;
  limit?: number;
}): v1.RegistrationHistoryQuery {
  const parsed = v1.RegistrationHistoryQuerySchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return parsed.data;
}

function parsePenaltyQuery(input: {
  page?: number;
  limit?: number;
  status?: v1.PenaltyStatus;
}): v1.SelfPenaltyListQuery {
  const parsed = v1.SelfPenaltyListQuerySchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return parsed.data;
}

function queryString(
  values: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

export const employeeActivityAPI = {
  getStats: async (
    token: string,
    options: { month?: string } = {},
  ): Promise<RegistrationStatsResponse> => {
    const parsedQuery = v1.RegistrationStatsQuerySchema.safeParse(options);
    if (!parsedQuery.success) return invalidInput(parsedQuery.error);
    const query = queryString({ month: parsedQuery.data.month });
    const payload = await request(
      `/registrations/stats${query ? `?${query}` : ''}`,
      token,
      'errors.loadActivityStats',
    );
    return parseOrThrow(v1.RegistrationStatsResponseSchema, payload);
  },

  getHistory: async (
    token: string,
    input: { page?: number; limit?: number } = {},
  ): Promise<RegistrationHistoryResponse> => {
    const query = parseHistoryQuery(input);
    const payload = await request(
      `/registrations/history?${queryString(query)}`,
      token,
      'errors.loadMealHistory',
    );
    return parseOrThrow(v1.RegistrationHistoryResponseSchema, payload);
  },

  getPenaltyList: async (
    token: string,
    input: { page?: number; limit?: number; status?: v1.PenaltyStatus } = {},
  ): Promise<SelfPenaltyListResponse> => {
    const query = parsePenaltyQuery(input);
    const payload = await request(
      `/penalties?${queryString(query)}`,
      token,
      'errors.loadPenalties',
    );
    return parseOrThrow(v1.SelfPenaltyListResponseSchema, payload);
  },

  getPenaltyDetail: async (
    penaltyId: string,
    token: string,
  ): Promise<SelfPenaltyDetailResponse> => {
    const parsedId = penaltyIdSchema.safeParse(penaltyId);
    if (!parsedId.success) return invalidInput(parsedId.error);
    const payload = await request(
      `/penalties/${encodeURIComponent(parsedId.data)}`,
      token,
      'errors.loadPenalty',
    );
    return parseOrThrow(v1.SelfPenaltyDetailResponseSchema, payload);
  },
};
