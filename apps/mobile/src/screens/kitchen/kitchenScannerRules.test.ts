import { describe, expect, it } from 'vitest';
import {
  canResetScan,
  getConfirmAttempt,
  isCurrentScanOperation,
} from './kitchenScannerRules';

describe('KitchenScanner confirmation retry rules', () => {
  it('reuses the resolved session and idempotency key after response loss', () => {
    const first = getConfirmAttempt('pickup-session-1', null, () => 'key-1');
    const retry = getConfirmAttempt(
      'pickup-session-1',
      first.idempotencyKey,
      () => 'key-2',
    );

    expect(first).toEqual({
      pickupSessionId: 'pickup-session-1',
      idempotencyKey: 'key-1',
    });
    expect(retry).toEqual(first);
  });

  it('ignores an old confirmation result after cancel starts a new scan', () => {
    expect(isCurrentScanOperation(2, 1)).toBe(false);
    expect(isCurrentScanOperation(2, 2)).toBe(true);
  });

  it('blocks cancel while confirmation is in flight', () => {
    expect(canResetScan(true)).toBe(false);
    expect(canResetScan(false)).toBe(true);
  });
});
