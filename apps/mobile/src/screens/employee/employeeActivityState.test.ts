import { describe, expect, it } from 'vitest';
import type { v1 } from '@imeal/contracts';
import {
  appendActivityPage,
  formatVnd,
  getActivityStatusTone,
  getSnapshotValue,
  isCurrentActivityRequest,
  nextActivityRequestToken,
  replaceActivityPage,
} from './employeeActivityState';

const activity = (id: string): v1.EmployeeRegistrationActivity => ({
  id,
  mealDate: '2026-09-30',
  status: 'SERVED',
  mealChoice: 'REGULAR',
  menuRevisionId: null,
  menuNameSnapshot: null,
  menuDescriptionSnapshot: null,
  menuImageSnapshot: null,
  serviceLocationId: null,
  serviceLocationAssignmentId: null,
  serviceLocationCode: null,
  serviceLocationName: null,
  serviceLocationAddress: null,
  serviceLocationEffectiveFrom: null,
  serviceLocationSnapshotAt: null,
  registeredAt: '2026-09-29T03:00:00.000Z',
  cancelledAt: null,
  noShowAt: null,
  servedAt: '2026-09-30T05:00:00.000Z',
  createdAt: '2026-09-29T03:00:00.000Z',
  updatedAt: '2026-09-30T05:00:00.000Z',
  penalties: [],
});

const page = (
  items: v1.EmployeeRegistrationActivity[],
  pageNumber: number,
  hasNextPage: boolean,
) => ({
  data: items,
  meta: {
    pagination: {
      page: pageNumber,
      limit: 20,
      total: 3,
      totalPages: 2,
      hasNextPage,
    },
  },
});

describe('employee activity state', () => {
  it('replaces on refresh and appends each later page only once', () => {
    const first = replaceActivityPage(page([activity('one')], 1, true));
    const second = appendActivityPage(first, page([activity('two')], 2, false));
    const duplicate = appendActivityPage(
      second,
      page([activity('two')], 2, false),
    );
    const reset = replaceActivityPage(page([activity('fresh')], 1, false));

    expect(second.items.map((item) => item.id)).toEqual(['one', 'two']);
    expect(duplicate).toEqual(second);
    expect(reset.items.map((item) => item.id)).toEqual(['fresh']);
    expect(reset.page).toBe(1);
  });

  it('rejects stale filter generations, including a repeated filter, and mismatches', () => {
    const all = { generation: 0, filter: 'ALL' };
    const pendingAll = nextActivityRequestToken(all, 'ALL');
    const pendingPaid = nextActivityRequestToken(pendingAll, 'PAID');
    const pendingAllAgain = nextActivityRequestToken(pendingPaid, 'ALL');

    expect(isCurrentActivityRequest(pendingAll, pendingPaid)).toBe(false);
    expect(isCurrentActivityRequest(pendingAll, pendingAllAgain)).toBe(false);
    expect(
      isCurrentActivityRequest(pendingPaid, {
        generation: pendingPaid.generation,
        filter: 'ALL',
      }),
    ).toBe(false);
    expect(
      isCurrentActivityRequest(pendingAllAgain, { ...pendingAllAgain }),
    ).toBe(true);
  });

  it('does not synthesize missing historical snapshots', () => {
    expect(getSnapshotValue(null, 'Location unavailable')).toBe(
      'Location unavailable',
    );
    expect(getSnapshotValue('Stored location', 'Location unavailable')).toBe(
      'Stored location',
    );
  });

  it('maps server statuses to semantic tones without changing labels', () => {
    expect(getActivityStatusTone('SERVED')).toBe('success');
    expect(getActivityStatusTone('ACTIVE')).toBe('information');
    expect(getActivityStatusTone('NO_SHOW')).toBe('warning');
    expect(getActivityStatusTone('CANCELLED')).toBe('neutral');
  });

  it('formats VND as a labeled integer amount', () => {
    expect(formatVnd(50000, 'en-US')).toBe('50,000 VND');
  });
});
