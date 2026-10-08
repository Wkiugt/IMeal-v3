import type { v1 } from '@imeal/contracts';
import { toBusinessDateKey } from '../../businessDate';

export type ProfileStatsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  sessionKey: string | null;
  data: v1.RegistrationStats | null;
  error: unknown;
};

export function createProfileStatsState(): ProfileStatsState {
  return {
    status: 'idle',
    sessionKey: null,
    data: null,
    error: null,
  };
}

export function beginProfileStatsLoad(
  current: ProfileStatsState,
  sessionKey: string,
): ProfileStatsState {
  const sameSession = current.sessionKey === sessionKey;
  return {
    status: 'loading',
    sessionKey,
    data: sameSession ? current.data : null,
    error: null,
  };
}

export function resolveProfileStats(
  current: ProfileStatsState,
  data: v1.RegistrationStats,
  sessionKey: string,
): ProfileStatsState {
  if (current.sessionKey !== sessionKey) return current;
  return {
    status: 'ready',
    sessionKey,
    data,
    error: null,
  };
}

export function failProfileStats(
  current: ProfileStatsState,
  error: unknown,
  sessionKey: string,
): ProfileStatsState {
  if (current.sessionKey !== sessionKey) return current;
  return {
    status: 'error',
    sessionKey,
    data: current.data,
    error,
  };
}

export function getProfileStatsData(
  state: ProfileStatsState,
  sessionKey: string | null,
): v1.RegistrationStats | null {
  return state.sessionKey === sessionKey ? state.data : null;
}

export function getProfileStatsValues(
  state: ProfileStatsState,
  sessionKey: string | null,
): {
  booked: number | null;
  enjoyed: number | null;
} {
  const data = getProfileStatsData(state, sessionKey);
  if (data === null) return { booked: null, enjoyed: null };
  return { booked: data.booked, enjoyed: data.enjoyed };
}
export function getProfileProgressValues(
  completed: number,
  total: number,
): { completed: number; total: number; percentage: number } {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  return {
    completed: safeCompleted,
    total: safeTotal,
    percentage:
      safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100),
  };
}

export function isStatsPeriodCurrent(month: string, nowIso: string): boolean {
  const businessMonth = toBusinessDateKey(nowIso).slice(0, 7);
  return businessMonth.length === 7 && month === businessMonth;
}
