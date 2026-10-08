import { afterEach, describe, expect, it, vi } from 'vitest';

const expoConfig = vi.hoisted(() => ({
  hostUri: undefined as string | undefined,
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig },
}));

const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

async function loadApiConfig() {
  vi.resetModules();
  return import('./apiConfig');
}

afterEach(() => {
  if (originalApiUrl === undefined) {
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_API_URL');
  } else {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  }

  if (originalNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, 'NODE_ENV');
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  expoConfig.hostUri = undefined;
  vi.unstubAllGlobals();
});

describe('apiConfig', () => {
  it('uses an explicit API URL for API_BASE and API_ROOT', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://host/api';

    const { API_BASE, API_ROOT } = await loadApiConfig();

    expect(API_BASE).toBe('https://host/api');
    expect(API_ROOT).toBe('https://host');
  });

  it('normalizes trailing slashes on an explicit API URL', async () => {
    process.env.EXPO_PUBLIC_API_URL = '  https://host/api///  ';

    const { API_BASE, API_ROOT } = await loadApiConfig();

    expect(API_BASE).toBe('https://host/api');
    expect(API_ROOT).toBe('https://host');
  });

  it('rejects missing configuration outside development', async () => {
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_API_URL');
    process.env.NODE_ENV = 'production';

    await expect(loadApiConfig()).rejects.toThrow(
      'EXPO_PUBLIC_API_URL is required outside Expo development.',
    );
  });

  it('falls back to the local API in development when configuration is missing', async () => {
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_API_URL');
    process.env.NODE_ENV = 'development';

    const { API_BASE, API_ROOT } = await loadApiConfig();

    expect(API_BASE).toBe('http://localhost:3000/api');
    expect(API_ROOT).toBe('http://localhost:3000');
  });

  it('uses the Expo Metro host for the development fallback', async () => {
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_API_URL');
    process.env.NODE_ENV = 'development';
    expoConfig.hostUri = '192.168.1.25:8081';

    const { API_BASE, API_ROOT } = await loadApiConfig();

    expect(API_BASE).toBe('http://192.168.1.25:3000/api');
    expect(API_ROOT).toBe('http://192.168.1.25:3000');
  });
});
