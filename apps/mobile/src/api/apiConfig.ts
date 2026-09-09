import Constants from 'expo-constants';

const LOCAL_API_BASE = 'http://localhost:3000/api';
const API_CONFIGURATION_ERROR =
  'EXPO_PUBLIC_API_URL is required outside Expo development.';

type WebLocation = {
  hostname?: string;
};

function normalizeExplicitApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function formatHostname(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;
}

function discoverHostFromMetro(): string | undefined {
  const hostUri = Constants.expoConfig?.hostUri?.trim();

  if (hostUri) {
    try {
      const uri = /^[a-z][a-z\d+.-]*:\/\//i.test(hostUri)
        ? hostUri
        : `http://${hostUri}`;
      const hostname = new URL(uri).hostname;

      if (hostname) {
        return formatHostname(hostname);
      }
    } catch {
      // Fall through to the Expo web hostname or localhost.
    }
  }

  const location = (globalThis as typeof globalThis & {
    location?: WebLocation;
  }).location;
  const hostname = location?.hostname?.trim();

  return hostname ? formatHostname(hostname) : undefined;
}

function resolveApiBase(): string {
  const explicitApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (explicitApiUrl) {
    return normalizeExplicitApiUrl(explicitApiUrl);
  }

  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (!isDevelopment) {
    throw new Error(API_CONFIGURATION_ERROR);
  }

  const discoveredHost = discoverHostFromMetro();
  return discoveredHost
    ? `http://${discoveredHost}:3000/api`
    : LOCAL_API_BASE;
}

export const API_BASE: string = resolveApiBase();
export const API_ROOT: string = API_BASE.replace(/\/api$/, '');
