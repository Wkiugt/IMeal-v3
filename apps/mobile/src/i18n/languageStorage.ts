import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AppLanguage } from './translations';

export const LANGUAGE_STORAGE_KEY = 'imeal.ui.language';

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === 'vi' || value === 'en';
}

async function removeStoredLanguage(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(LANGUAGE_STORAGE_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(LANGUAGE_STORAGE_KEY);
}

export async function readLanguage(): Promise<AppLanguage | null> {
  let stored: string | null = null;
  try {
    stored = Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null)
      : await SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }

  if (isAppLanguage(stored)) return stored;
  try {
    await removeStoredLanguage();
  } catch {
    // A malformed value is never accepted even if cleanup fails.
  }
  return null;
}

export async function writeLanguage(language: AppLanguage): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
    return;
  }
  await SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, language);
}
