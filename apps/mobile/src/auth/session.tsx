import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  exchangeCodeAsync,
  makeRedirectUri,
  useAuthRequest,
  useAutoDiscovery,
} from 'expo-auth-session';

const SESSION_KEY = 'imeal.entra.access-token';
const TENANT_ID = process.env.EXPO_PUBLIC_ENTRA_TENANT_ID;
const CLIENT_ID = process.env.EXPO_PUBLIC_ENTRA_CLIENT_ID;
const API_SCOPE = process.env.EXPO_PUBLIC_ENTRA_API_SCOPE;
const CONFIG_READY = Boolean(TENANT_ID && CLIENT_ID && API_SCOPE);
const CONFIG_ERROR = 'EXPO_PUBLIC_ENTRA_TENANT_ID, EXPO_PUBLIC_ENTRA_CLIENT_ID, and EXPO_PUBLIC_ENTRA_API_SCOPE are required';
const API_ROOT = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '');

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
  const response = await fetch(`${API_ROOT}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('The saved session is no longer valid');
  const payload: unknown = await response.json();
  if (!isMobileProfile(payload)) throw new Error('The profile response is invalid');
  return payload;
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
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {

  const discovery = useAutoDiscovery(`https://login.microsoftonline.com/${TENANT_ID || 'common'}/v2.0`);
  const redirectUri = makeRedirectUri({ scheme: 'imeal', path: 'oauth2redirect' });
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: CLIENT_ID || '',
      scopes: ['openid', 'profile', 'email', 'offline_access', API_SCOPE || ''],
      redirectUri,
    },
    discovery,
  );
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(CONFIG_READY ? null : CONFIG_ERROR);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const savedToken = Platform.OS === 'web' ? globalThis.localStorage?.getItem(SESSION_KEY) ?? null : await SecureStore.getItemAsync(SESSION_KEY);
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
        if (Platform.OS === 'web') globalThis.localStorage?.removeItem(SESSION_KEY);
        else await SecureStore.deleteItemAsync(SESSION_KEY);
        if (mounted) setAuthError(error instanceof Error ? error.message : 'Unable to restore session');
      } finally {
        if (mounted) setIsRestoring(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (response?.type !== 'success' || !discovery) return;
    void (async () => {
      setIsSigningIn(true);
      try {
        const exchanged = await exchangeCodeAsync(
          {
            clientId: CLIENT_ID || '',
            code: response.params.code,
            redirectUri,
            extraParams: request?.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
          },
          discovery,
        );
        const signedInProfile = await loadProfile(exchanged.accessToken);
        if (Platform.OS === 'web') globalThis.localStorage?.setItem(SESSION_KEY, exchanged.accessToken);
        else await SecureStore.setItemAsync(SESSION_KEY, exchanged.accessToken);
        setToken(exchanged.accessToken);
        setProfile(signedInProfile);
        setAuthError(null);
      } catch (error: unknown) {
        setAuthError(error instanceof Error ? error.message : 'Microsoft login failed');
      } finally {
        setIsSigningIn(false);
      }
    })();
  }, [discovery, redirectUri, request?.codeVerifier, response]);

  const signIn = async () => {
    if (!request) return;
    setAuthError(null);
    await promptAsync();
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
      canSignIn: Boolean(request),
      authError,
      canUseEmployee: roles.includes('staff'),
      canUseKitchen: roles.includes('kitchen'),
      signIn,
      logout,
    };
  }, [authError, isRestoring, isSigningIn, profile, request, token]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
