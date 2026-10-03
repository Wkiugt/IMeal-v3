import { describe, expect, it } from 'vitest';
import {
  canStartCheckInScan,
  canStartCheckInConfirm,
  createCheckInAttempt,
  isCheckInSessionExpired,
  needsFreshCheckInGps,
} from './checkInRules';

describe('staff check-in flow rules', () => {
  it('blocks another scan while resolving or reviewing a session', () => {
    expect(canStartCheckInScan(true, false, false)).toBe(true);
    expect(canStartCheckInScan(true, true, false)).toBe(false);
    expect(canStartCheckInScan(true, false, true)).toBe(false);
    expect(canStartCheckInScan(false, false, false)).toBe(false);
  });

  it('blocks confirmation when the review session is gone or expired', () => {
    expect(canStartCheckInConfirm(true, false, false)).toBe(true);
    expect(canStartCheckInConfirm(true, true, false)).toBe(false);
    expect(canStartCheckInConfirm(false, false, false)).toBe(false);
    expect(canStartCheckInConfirm(true, false, true)).toBe(false);
  });

  it('reuses the same idempotency key for an in-flight confirmation retry', () => {
    const first = createCheckInAttempt('session-1', null, () => 'key-1');
    const retry = createCheckInAttempt('session-1', first.idempotencyKey, () => 'key-2');

    expect(first).toEqual({ sessionId: 'session-1', idempotencyKey: 'key-1' });
    expect(retry).toEqual(first);
  });

  it('treats a session at or after its server expiry as unusable', () => {
    expect(isCheckInSessionExpired('2026-10-03T04:00:00.000Z', Date.parse('2026-10-03T04:00:00.000Z'))).toBe(true);
    expect(isCheckInSessionExpired('2026-10-03T04:00:01.000Z', Date.parse('2026-10-03T04:00:00.000Z'))).toBe(false);
    expect(isCheckInSessionExpired('not-a-date', Date.parse('2026-10-03T04:00:00.000Z'))).toBe(true);
  });

  it('requires a new GPS capture for server-rejected GPS evidence', () => {
    expect(needsFreshCheckInGps('GPS_STALE')).toBe(true);
    expect(needsFreshCheckInGps('GPS_INACCURATE')).toBe(true);
    expect(needsFreshCheckInGps('OUTSIDE_GEOFENCE')).toBe(true);
    expect(needsFreshCheckInGps('INVALID_QR')).toBe(false);
  });
});
