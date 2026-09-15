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
  MobileApiError,
  getMobileErrorMessage,
  readMobileResponseJson,
  throwMobileResponseError,
  toMobileApiError,
} from '../api/mobileApiError';
import { RequestTimeoutError, fetchWithTimeout } from '../api/requestWithTimeout';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Translate } from '../i18n/translations';
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

type AuthErrorFallbackKey = 'errors.restoreSession' | 'errors.signIn';
type AuthErrorState = { error: unknown; fallbackKey: AuthErrorFallbackKey };

function getAuthErrorMessage(error: unknown, fallbackKey: AuthErrorFallbackKey, t: Translate): string {
  if (error instanceof RequestTimeoutError) {
    return t('errors.apiTimeout');
  }
  return getMobileErrorMessage(error, t, fallbackKey);
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
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${API_ROOT}/auth/me`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      AUTH_REQUEST_TIMEOUT_MS,
    );
  } catch (error: unknown) {
    throw toMobileApiError(error, 'errors.restoreSession');
  }
  if (!response.ok) await throwMobileResponseError(response, 'errors.restoreSession');
  const payload = await readMobileResponseJson(response, 'errors.restoreSession');
  if (!isMobileProfile(payload)) {
    throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
  }
  return payload;
}

async function loginLocal(
  username: string,
  password: string,
): Promise<{ accessToken: string; profile: MobileProfile }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
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
  } catch (error: unknown) {
    throw toMobileApiError(error, 'errors.signIn');
  }
  const payload = response.ok
    ? await readMobileResponseJson(response, 'errors.signIn')
    : await throwMobileResponseError(response, 'errors.signIn');
  if (!payload || typeof payload !== 'object') {
    throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
  }
  const accessToken = 'accessToken' in payload ? payload.accessToken : undefined;
  const profile = 'user' in payload ? payload.user : undefined;
  if (typeof accessToken !== 'string' || !isMobileProfile(profile)) {
    throw new MobileApiError('INVALID_RESPONSE', 'errors.invalidResponse', payload);
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
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authErrorState, setAuthErrorState] = useState<AuthErrorState | null>(null);

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
          setAuthErrorState(null);
        }
      } catch (error: unknown) {
        if (Platform.OS === 'web')
          globalThis.localStorage?.removeItem(SESSION_KEY);
        else await SecureStore.deleteItemAsync(SESSION_KEY);
        if (mounted) {
          setAuthErrorState({ error, fallbackKey: 'errors.restoreSession' });
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
    setAuthErrorState(null);
    try {
      const result = await loginLocal(username, password);
      if (Platform.OS === 'web')
        globalThis.localStorage?.setItem(SESSION_KEY, result.accessToken);
      else await SecureStore.setItemAsync(SESSION_KEY, result.accessToken);
      setToken(result.accessToken);
      setProfile(result.profile);
    } catch (error: unknown) {
      setAuthErrorState({ error, fallbackKey: 'errors.signIn' });
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(SESSION_KEY);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setProfile(null);
    setAuthErrorState(null);
  };

  const value = useMemo<SessionContextValue>(() => {
    const roles = profile?.roles.map((role) => role.toLowerCase()) || [];
    return {
      token,
      profile,
      isRestoring,
      isSigningIn,
      canSignIn: true,
      authError: authErrorState
        ? getAuthErrorMessage(authErrorState.error, authErrorState.fallbackKey, t)
        : null,
      canUseEmployee: roles.includes('staff'),
      canUseKitchen: roles.includes('kitchen'),
      signIn,
      logout,
    };
  }, [authErrorState, isRestoring, isSigningIn, profile, t, token]);
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
