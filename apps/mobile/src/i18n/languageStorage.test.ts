import { afterEach, describe, expect, it, vi } from 'vitest';

const { platform, secureStore } = vi.hoisted(() => ({
  platform: { OS: 'web' as string },
  secureStore: {
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
  },
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-secure-store', () => secureStore);

import { readLanguage, writeLanguage } from './languageStorage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  platform.OS = 'web';
  secureStore.getItemAsync.mockReset();
  secureStore.setItemAsync.mockReset();
  secureStore.deleteItemAsync.mockReset();
});


describe('language storage', () => {
  it('returns a valid web language preference', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'en'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    await expect(readLanguage()).resolves.toBe('en');
  });

  it('deletes invalid web values and falls back to the default', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'fr'),
      setItem: vi.fn(),
      removeItem,
    });

    await expect(readLanguage()).resolves.toBeNull();
    expect(removeItem).toHaveBeenCalledWith('imeal.ui.language');
  });

  it('persists native preferences through secure storage', async () => {
    platform.OS = 'native';
    vi.stubGlobal('localStorage', undefined);
    secureStore.setItemAsync.mockResolvedValue(undefined);
    await writeLanguage('vi');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('imeal.ui.language', 'vi');
  });
});
