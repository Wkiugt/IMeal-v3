import { describe, expect, it } from 'vitest';
import { getConfirmAttempt } from './kitchenScannerRules';

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
});
