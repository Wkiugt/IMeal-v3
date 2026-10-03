import type { MobileApiErrorCode } from '../api/mobileApiError';

export type CheckInAttempt = {
  sessionId: string;
  idempotencyKey: string;
};

export function canStartCheckInScan(
  isFocused: boolean,
  isResolving: boolean,
  hasReview: boolean,
): boolean {
  return isFocused && !isResolving && !hasReview;
}

export function canStartCheckInConfirm(
  isFocused: boolean,
  isConfirming: boolean,
  isExpired: boolean,
): boolean {
  return isFocused && !isConfirming && !isExpired;
}

export function createCheckInAttempt(
  sessionId: string,
  existingIdempotencyKey: string | null,
  createIdempotencyKey: () => string,
): CheckInAttempt {
  return {
    sessionId,
    idempotencyKey: existingIdempotencyKey ?? createIdempotencyKey(),
  };
}

export function isCheckInSessionExpired(
  expiresAt: string,
  now = Date.now(),
): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}

export function needsFreshCheckInGps(code: MobileApiErrorCode): boolean {
  return (
    code === 'GPS_REQUIRED' ||
    code === 'GPS_STALE' ||
    code === 'GPS_INACCURATE' ||
    code === 'OUTSIDE_GEOFENCE' ||
    code === 'LOCATION_MISMATCH'
  );
}
