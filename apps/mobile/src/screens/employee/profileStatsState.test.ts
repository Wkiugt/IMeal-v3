import { describe, expect, it } from 'vitest';
import type { v1 } from '@imeal/contracts';
import {
  beginProfileStatsLoad,
  createProfileStatsState,
  failProfileStats,
  getProfileStatsValues,
  isStatsPeriodCurrent,
  getProfileProgressValues,
  resolveProfileStats,
} from './profileStatsState';

const stats = (
  month: string,
  booked = 0,
  enjoyed = 0,
): v1.RegistrationStats => ({
  period: { month, startDate: `${month}-01`, endDate: `${month}-30` },
  booked,
  enjoyed,
});

describe('profile stats state', () => {
  it('does not expose fake zeroes while loading or after an initial error', () => {
    const loading = beginProfileStatsLoad(createProfileStatsState(), 'token-a');
    const failed = failProfileStats(loading, new Error('offline'), 'token-a');

    expect(getProfileStatsValues(loading, 'token-a')).toEqual({
      booked: null,
      enjoyed: null,
    });
    expect(getProfileStatsValues(failed, 'token-a')).toEqual({
      booked: null,
      enjoyed: null,
    });
  });

  it('retains the last successful values for the same session after revalidation failure', () => {
    const ready = resolveProfileStats(
      beginProfileStatsLoad(createProfileStatsState(), 'token-a'),
      stats('2026-09', 12, 8),
      'token-a',
    );
    const failed = failProfileStats(
      beginProfileStatsLoad(ready, 'token-a'),
      new Error('offline'),
      'token-a',
    );

    expect(getProfileStatsValues(failed, 'token-a')).toEqual({
      booked: 12,
      enjoyed: 8,
    });
    expect(failed.data?.period.month).toBe('2026-09');
  });

  it('clears the prior user values when the authenticated token changes', () => {
    const ready = resolveProfileStats(
      beginProfileStatsLoad(createProfileStatsState(), 'token-a'),
      stats('2026-09', 12, 8),
      'token-a',
    );
    const nextUser = beginProfileStatsLoad(ready, 'token-b');

    expect(nextUser.data).toBeNull();
    expect(getProfileStatsValues(nextUser, 'token-b')).toEqual({
      booked: null,
      enjoyed: null,
    });
  });

  it('preserves actual server zero counts as ready values', () => {
    const ready = resolveProfileStats(
      beginProfileStatsLoad(createProfileStatsState(), 'token-a'),
      stats('2026-10', 0, 0),
      'token-a',
    );

    expect(ready.status).toBe('ready');
    expect(getProfileStatsValues(ready, 'token-a')).toEqual({
      booked: 0,
      enjoyed: 0,
    });
  });
  it('hides prior-session values immediately until the active token has data', () => {
    const ready = resolveProfileStats(
      beginProfileStatsLoad(createProfileStatsState(), 'token-a'),
      stats('2026-09', 12, 8),
      'token-a',
    );

    expect(getProfileStatsValues(ready, 'token-b')).toEqual({
      booked: null,
      enjoyed: null,
    });
  });
  it('keeps zero progress accessible without inventing a unit total', () => {
    expect(getProfileProgressValues(0, 0)).toEqual({
      completed: 0,
      total: 0,
      percentage: 0,
    });
  });
  it('marks retained stats stale when their server period is no longer the current business month', () => {
    expect(isStatsPeriodCurrent('2026-09', '2026-10-01T00:00:00.000Z')).toBe(
      false,
    );
    expect(isStatsPeriodCurrent('2026-10', '2026-10-01T00:00:00.000Z')).toBe(
      true,
    );
  });
});
