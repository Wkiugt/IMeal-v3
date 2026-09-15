import { describe, expect, it } from 'vitest';
import {
  cacheDelegations,
  createDelegationCache,
  getDelegationsForTab,
  type DelegationCache,
} from './delegationState';
import type { DelegationResponse } from '../../api/delegationAPI';

const outgoing: DelegationResponse = {
  id: 'outgoing-1',
  registrationId: 'registration-1',
  delegateUserId: 'outgoing-person',
  status: 'PENDING',
  createdAt: '2026-09-14T08:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
};

const incoming: DelegationResponse = {
  id: 'incoming-1',
  registrationId: 'registration-2',
  delegateUserId: 'incoming-person',
  status: 'PENDING',
  createdAt: '2026-09-14T08:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
};

describe('delegation tab cache', () => {
  it('does not expose outgoing data while an uncached incoming tab loads', () => {
    let cache = createDelegationCache();
    cache = cacheDelegations(cache, 'OUTGOING', [outgoing]);

    expect(getDelegationsForTab(cache, 'INCOMING')).toEqual([]);
    expect(cache.INCOMING.loaded).toBe(false);
  });

  it('keeps cached data for the selected tab during background refresh', () => {
    let cache: DelegationCache = createDelegationCache();
    cache = cacheDelegations(cache, 'OUTGOING', [outgoing]);
    cache = cacheDelegations(cache, 'INCOMING', [incoming]);

    expect(getDelegationsForTab(cache, 'OUTGOING')).toEqual([outgoing]);
    expect(getDelegationsForTab(cache, 'INCOMING')).toEqual([incoming]);
  });

  it('keeps rapid-switch responses isolated to their own tab cache', () => {
    let cache = createDelegationCache();
    cache = cacheDelegations(cache, 'OUTGOING', [outgoing]);
    cache = cacheDelegations(cache, 'INCOMING', [incoming]);
    cache = cacheDelegations(cache, 'OUTGOING', []);

    expect(getDelegationsForTab(cache, 'INCOMING')).toEqual([incoming]);
    expect(getDelegationsForTab(cache, 'OUTGOING')).toEqual([]);
  });
});
