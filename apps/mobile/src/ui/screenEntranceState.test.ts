import { describe, expect, it } from 'vitest';
import { shouldAnimateScreenEntrance } from './screenEntranceState';

describe('ScreenEntrance lifecycle', () => {
  it('animates the first active mount', () => {
    expect(shouldAnimateScreenEntrance(true, false)).toBe(true);
  });

  it('does not replay after a retained instance regains focus', () => {
    const hasEntered = true;

    expect(shouldAnimateScreenEntrance(false, hasEntered)).toBe(false);
    expect(shouldAnimateScreenEntrance(true, hasEntered)).toBe(false);
  });

  it('animates a genuinely new mounted instance', () => {
    expect(shouldAnimateScreenEntrance(true, false)).toBe(true);
  });
});
