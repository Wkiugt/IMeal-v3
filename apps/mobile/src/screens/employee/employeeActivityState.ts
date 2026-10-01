import type { v1 } from '@imeal/contracts';
import type { SemanticTone } from '../../ui/designTokens';

export type ActivityPageResponse<T> = {
  data: T[];
  meta: { pagination: v1.PagePaginationMeta };
};

export type ActivityPageState<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
};
export type ActivityRequestToken = {
  generation: number;
  filter: string;
};

export function nextActivityRequestToken(
  current: ActivityRequestToken,
  filter: string,
): ActivityRequestToken {
  return { generation: current.generation + 1, filter };
}

export function isCurrentActivityRequest(
  request: ActivityRequestToken,
  current: ActivityRequestToken,
): boolean {
  return (
    request.generation === current.generation &&
    request.filter === current.filter
  );
}

export function createActivityPageState<T>(): ActivityPageState<T> {
  return {
    items: [],
    page: 0,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
  };
}

function stateFromResponse<T>(
  response: ActivityPageResponse<T>,
): ActivityPageState<T> {
  const pagination = response.meta.pagination;
  return {
    items: response.data,
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
  };
}

export function replaceActivityPage<T>(
  response: ActivityPageResponse<T>,
): ActivityPageState<T> {
  return stateFromResponse(response);
}

export function appendActivityPage<T extends { id: string }>(
  current: ActivityPageState<T>,
  response: ActivityPageResponse<T>,
): ActivityPageState<T> {
  const pagination = response.meta.pagination;
  if (pagination.page !== current.page + 1) return current;
  const existingIds = new Set(current.items.map((item) => item.id));
  const nextItems = response.data.filter((item) => !existingIds.has(item.id));
  return {
    ...current,
    items: [...current.items, ...nextItems],
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
  };
}

export function getSnapshotValue(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

export function formatVnd(amount: number, locale: string): string {
  return `${amount.toLocaleString(locale)} VND`;
}

export function getActivityStatusTone(
  status: v1.RegistrationRecordStatus,
): SemanticTone {
  switch (status) {
    case 'ACTIVE':
      return 'information';
    case 'SERVED':
      return 'success';
    case 'NO_SHOW':
      return 'warning';
    case 'CANCELLED':
      return 'neutral';
  }
}

export function getPenaltyStatusTone(status: v1.PenaltyStatus): SemanticTone {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'WAIVED':
      return 'neutral';
  }
}
