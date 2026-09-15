import type { DelegationResponse } from '../../api/delegationAPI';

export type DelegationTab = 'OUTGOING' | 'INCOMING';

export type DelegationTabCache = {
  data: DelegationResponse[];
  loaded: boolean;
};

export type DelegationCache = Record<DelegationTab, DelegationTabCache>;

export function createDelegationCache(): DelegationCache {
  return {
    OUTGOING: { data: [], loaded: false },
    INCOMING: { data: [], loaded: false },
  };
}

export function cacheDelegations(
  cache: DelegationCache,
  tab: DelegationTab,
  data: DelegationResponse[],
): DelegationCache {
  return {
    ...cache,
    [tab]: { data, loaded: true },
  };
}

export function getDelegationsForTab(
  cache: DelegationCache,
  tab: DelegationTab,
): DelegationResponse[] {
  return cache[tab].data;
}
