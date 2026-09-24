import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  authAPI,
  type MobileProfile,
  type RequestOtpResponse,
} from '../api/authAPI';
import { getMobileErrorMessage } from '../api/mobileApiError';
import { RequestTimeoutError } from '../api/requestWithTimeout';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Translate } from '../i18n/translations';
import { attemptSessionStorage } from './sessionStorage';

export type { MobileProfile } from '../api/authAPI';

type AuthErrorFallbackKey =
  | 'errors.restoreSession'
  | 'errors.requestOtp'
  | 'errors.verifyOtp'
  | 'errors.logOut';
type AuthErrorState = { error: unknown; fallbackKey: AuthErrorFallbackKey };
const SESSION_KEY = 'imeal.opaque.session-token';

function getAuthErrorMessage(
  error: unknown,
  fallbackKey: AuthErrorFallbackKey,
  t: Translate,
): string {
  if (error instanceof RequestTimeoutError) return t('errors.apiTimeout');
  return getMobileErrorMessage(error, t, fallbackKey);
}

async function readStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web')
    return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function storeToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(SESSION_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(SESSION_KEY, token);
}

async function clearStoredToken(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(SESSION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

type SessionContextValue = {
  token: string | null;
  profile: MobileProfile | null;
  isRestoring: boolean;
  isRequestingOtp: boolean;
  isVerifyingOtp: boolean;
  isSigningIn: boolean;
  canSignIn: boolean;
  authError: string | null;
  canUseEmployee: boolean;
  canUseKitchen: boolean;
  requestOtp: (email: string) => Promise<RequestOtpResponse>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authErrorState, setAuthErrorState] = useState<AuthErrorState | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const tokenResult = await attemptSessionStorage(readStoredToken);
        if (!tokenResult.ok) {
          if (mounted) {
            setAuthErrorState({
              error: tokenResult.error,
              fallbackKey: 'errors.restoreSession',
            });
          }
          return;
        }
        const savedToken = tokenResult.value;
        if (!savedToken) return;
        try {
          const savedProfile = await authAPI.bootstrapSession(savedToken);
          if (mounted) {
            setToken(savedToken);
            setProfile(savedProfile);
            setAuthErrorState(null);
          }
        } catch (error: unknown) {
          await attemptSessionStorage(clearStoredToken);
          if (mounted) {
            setAuthErrorState({ error, fallbackKey: 'errors.restoreSession' });
          }
        }
      } catch (error: unknown) {
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

  const requestOtp = async (email: string): Promise<RequestOtpResponse> => {
    setIsRequestingOtp(true);
    setAuthErrorState(null);
    try {
      return await authAPI.requestOtp(email);
    } catch (error: unknown) {
      setAuthErrorState({ error, fallbackKey: 'errors.requestOtp' });
      throw error;
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const verifyOtp = async (email: string, code: string): Promise<void> => {
    setIsVerifyingOtp(true);
    setAuthErrorState(null);
    try {
      const result = await authAPI.verifyOtp({ email, code });
      await storeToken(result.sessionToken);
      const nextProfile = await authAPI.bootstrapSession(result.sessionToken);
      setToken(result.sessionToken);
      setProfile(nextProfile);
    } catch (error: unknown) {
      await attemptSessionStorage(clearStoredToken);
      setToken(null);
      setProfile(null);
      setAuthErrorState({ error, fallbackKey: 'errors.verifyOtp' });
      throw error;
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const logout = async (): Promise<void> => {
    const currentToken = token;
    let logoutError: unknown = null;
    try {
      if (currentToken) await authAPI.logout(currentToken);
    } catch (error: unknown) {
      logoutError = error;
    }
    const clearResult = await attemptSessionStorage(clearStoredToken);
    setToken(null);
    setProfile(null);
    if (logoutError) {
      setAuthErrorState({ error: logoutError, fallbackKey: 'errors.logOut' });
    } else if (!clearResult.ok) {
      setAuthErrorState({
        error: clearResult.error,
        fallbackKey: 'errors.logOut',
      });
    } else {
      setAuthErrorState(null);
    }
  };

  const value = useMemo<SessionContextValue>(() => {
    const roles = profile?.roles.map((role) => role.toLowerCase()) ?? [];
    return {
      token,
      profile,
      isRestoring,
      isRequestingOtp,
      isVerifyingOtp,
      isSigningIn: isVerifyingOtp,
      canSignIn: true,
      authError: authErrorState
        ? getAuthErrorMessage(
            authErrorState.error,
            authErrorState.fallbackKey,
            t,
          )
        : null,
      canUseEmployee: roles.includes('staff'),
      canUseKitchen: roles.includes('kitchen'),
      requestOtp,
      verifyOtp,
      logout,
    };
  }, [
    authErrorState,
    isRequestingOtp,
    isRestoring,
    isVerifyingOtp,
    profile,
    t,
    token,
  ]);

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
