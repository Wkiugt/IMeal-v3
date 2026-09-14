import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_ROOT } from '../api/apiConfig';
import {
  RequestTimeoutError,
  fetchWithTimeout,
} from '../api/requestWithTimeout';

const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MESSAGE =
  'The API did not respond. Check the API tunnel and try again.';

function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestTimeoutError) return API_TIMEOUT_MESSAGE;
  return error instanceof Error ? error.message : fallback;
}
const SESSION_KEY = 'imeal.local.access-token';

export interface MobileProfile {
  id: string;
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  permissions: string[];
}

function isMobileProfile(value: unknown): value is MobileProfile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MobileProfile>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.email === 'string' &&
    Array.isArray(candidate.roles) &&
    candidate.roles.every((role) => typeof role === 'string') &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every((permission) => typeof permission === 'string')
  );
}

async function loadProfile(accessToken: string): Promise<MobileProfile> {
  const response = await fetchWithTimeout(
    `${API_ROOT}/auth/me`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    AUTH_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error('The saved session is no longer valid');
  const payload: unknown = await response.json();
  if (!isMobileProfile(payload))
    throw new Error('The profile response is invalid');
  return payload;
}

async function loginLocal(
  username: string,
  password: string,
): Promise<{ accessToken: string; profile: MobileProfile }> {
  const response = await fetchWithTimeout(
    `${API_ROOT}/auth/local-login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username, password }),
    },
    AUTH_REQUEST_TIMEOUT_MS,
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = 'Local sign-in failed';
    if (payload && typeof payload === 'object' && 'message' in payload) {
      message = String(payload.message);
    }
    throw new Error(message);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('The local sign-in response is invalid');
  }
  const accessToken =
    'accessToken' in payload ? payload.accessToken : undefined;
  const profile = 'user' in payload ? payload.user : undefined;
  if (typeof accessToken !== 'string' || !isMobileProfile(profile)) {
    throw new Error('The local sign-in response is invalid');
  }
  return { accessToken, profile };
}

type SessionContextValue = {
  token: string | null;
  profile: MobileProfile | null;
  isRestoring: boolean;
  isSigningIn: boolean;
  canSignIn: boolean;
  authError: string | null;
  canUseEmployee: boolean;
  canUseKitchen: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const savedToken =
        Platform.OS === 'web'
          ? (globalThis.localStorage?.getItem(SESSION_KEY) ?? null)
          : await SecureStore.getItemAsync(SESSION_KEY);
      if (!savedToken) {
        if (mounted) setIsRestoring(false);
        return;
      }
      try {
        const savedProfile = await loadProfile(savedToken);
        if (mounted) {
          setToken(savedToken);
          setProfile(savedProfile);
          setAuthError(null);
        }
      } catch (error: unknown) {
        if (Platform.OS === 'web')
          globalThis.localStorage?.removeItem(SESSION_KEY);
        else await SecureStore.deleteItemAsync(SESSION_KEY);
        if (mounted) {
          setAuthError(getAuthErrorMessage(error, 'Unable to restore session'));
        }
      } finally {
        if (mounted) setIsRestoring(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async (username: string, password: string) => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await loginLocal(username, password);
      if (Platform.OS === 'web')
        globalThis.localStorage?.setItem(SESSION_KEY, result.accessToken);
      else await SecureStore.setItemAsync(SESSION_KEY, result.accessToken);
      setToken(result.accessToken);
      setProfile(result.profile);
    } catch (error: unknown) {
      setAuthError(getAuthErrorMessage(error, 'Local sign-in failed'));
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(SESSION_KEY);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setProfile(null);
    setAuthError(null);
  };

  const value = useMemo<SessionContextValue>(() => {
    const roles = profile?.roles.map((role) => role.toLowerCase()) || [];
    return {
      token,
      profile,
      isRestoring,
      isSigningIn,
      canSignIn: true,
      authError,
      canUseEmployee: roles.includes('staff'),
      canUseKitchen: roles.includes('kitchen'),
      signIn,
      logout,
    };
  }, [authError, isRestoring, isSigningIn, profile, token]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error('useSession must be used inside SessionProvider');
  return context;
}
