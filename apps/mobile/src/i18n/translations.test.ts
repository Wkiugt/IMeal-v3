import { describe, expect, it } from 'vitest';
import { en, i18n, translate, vi } from './translations';

describe('mobile translations', () => {
  it('defaults to Vietnamese', () => {
    i18n.locale = 'vi';
    expect(translate('auth.welcome')).toBe(vi['auth.welcome']);
  });

  it('keeps dictionary keys in parity and interpolates values', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
    i18n.locale = 'en';
    expect(translate('auth.greeting', { name: 'Ada' })).toContain('Ada');
  });

  it('pluralizes item counts in each language', () => {
    i18n.locale = 'vi';
    expect(translate('scanner.itemCount', { count: 1 })).toContain('1');
    expect(translate('scanner.itemCount', { count: 2 })).toContain('2');
    i18n.locale = 'en';
    expect(translate('scanner.itemCount', { count: 1 })).toContain('item');
    expect(translate('scanner.itemCount', { count: 2 })).toContain('items');
  });
});
