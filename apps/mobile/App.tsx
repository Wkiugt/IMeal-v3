import React, { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  exchangeCodeAsync,
  makeRedirectUri,
  useAuthRequest,
  useAutoDiscovery,
} from 'expo-auth-session';

import { DelegationScreen } from './src/screens/delegation/DelegationScreen';
import { KitchenScannerScreen } from './src/screens/kitchen/KitchenScannerScreen';
import { KitchenDashboardScreen } from './src/screens/kitchen/KitchenDashboardScreen';
import { PickupIntentScreen } from './src/screens/pickup/PickupIntentScreen';
import type { RootStackParamList } from './src/navigation';

WebBrowser.maybeCompleteAuthSession();

const TENANT_ID = process.env.EXPO_PUBLIC_ENTRA_TENANT_ID;
const CLIENT_ID = process.env.EXPO_PUBLIC_ENTRA_CLIENT_ID;
const API_SCOPE = process.env.EXPO_PUBLIC_ENTRA_API_SCOPE;
if (!TENANT_ID || !CLIENT_ID || !API_SCOPE) {
  throw new Error(
    'EXPO_PUBLIC_ENTRA_TENANT_ID, EXPO_PUBLIC_ENTRA_CLIENT_ID, and EXPO_PUBLIC_ENTRA_API_SCOPE are required',
  );
}
const ENTRA_CONFIG = {
  tenantId: TENANT_ID,
  clientId: CLIENT_ID,
  apiScope: API_SCOPE,
};

const SESSION_KEY = 'imeal.entra.access-token';
const API_ROOT = (
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api'
).replace(/\/api\/?$/, '');

interface UserProfile {
  roles: string[];
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefix = Linking.createURL('/');

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object' || !('roles' in value)) {
    return false;
  }
  return (
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === 'string')
  );
}

async function loadProfile(accessToken: string): Promise<UserProfile> {
  const response = await fetch(`${API_ROOT}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('The saved session is no longer valid');
  }
  const payload: unknown = await response.json();
  if (!isUserProfile(payload)) {
    throw new Error('The profile response is invalid');
  }
  return payload;
}

type AuthScreenProps = NativeStackScreenProps<RootStackParamList, 'Auth'>;

function AuthScreen({ navigation }: AuthScreenProps) {
  const [token, setToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const discovery = useAutoDiscovery(
    `https://login.microsoftonline.com/${ENTRA_CONFIG.tenantId}/v2.0`,
  );
  const redirectUri = makeRedirectUri({
    scheme: 'imeal',
    path: 'oauth2redirect',
  });
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: ENTRA_CONFIG.clientId,
      scopes: [
        'openid',
        'profile',
        'email',
        'offline_access',
        ENTRA_CONFIG.apiScope,
      ],
      redirectUri,
    },
    discovery,
  );

  useEffect(() => {
    void (async () => {
      const savedToken = await SecureStore.getItemAsync(SESSION_KEY);
      if (!savedToken) {
        return;
      }
      try {
        const profile = await loadProfile(savedToken);
        setToken(savedToken);
        setRoles(profile.roles);
      } catch (error: unknown) {
        await SecureStore.deleteItemAsync(SESSION_KEY);
        setAuthError(
          error instanceof Error ? error.message : 'Unable to restore session',
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (response?.type !== 'success' || !discovery) {
      return;
    }

    void (async () => {
      try {
        const exchanged = await exchangeCodeAsync(
          {
            clientId: ENTRA_CONFIG.clientId,
            code: response.params.code,
            redirectUri,
            extraParams: request?.codeVerifier
              ? { code_verifier: request.codeVerifier }
              : undefined,
          },
          discovery,
        );
        const profile = await loadProfile(exchanged.accessToken);
        await SecureStore.setItemAsync(SESSION_KEY, exchanged.accessToken);
        setToken(exchanged.accessToken);
        setRoles(profile.roles);
        setAuthError(null);
      } catch (error: unknown) {
        setAuthError(
          error instanceof Error ? error.message : 'Microsoft login failed',
        );
      }
    })();
  }, [discovery, redirectUri, request?.codeVerifier, response]);

  const logout = async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setRoles([]);
  };
  const hasKitchenAccess = roles.some((role) =>
    ['admin', 'kitchen'].includes(role.toLowerCase()),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>IMeal</Text>
      {!token ? (
        <Button
          disabled={!request}
          title="Login with Microsoft Entra"
          onPress={() => promptAsync()}
        />
      ) : (
        <View style={styles.actions}>
          <Button
            title="Open Pickup QR"
            onPress={() => navigation.navigate('PickupIntent', { token })}
          />
          <Button
            title="Go to Delegations"
            onPress={() => navigation.navigate('Delegation', { token })}
          />
          {hasKitchenAccess && (
            <>
              <Button
                title="Open Kitchen Dashboard"
                onPress={() =>
                  navigation.navigate('KitchenDashboard', { token })
                }
              />
              <Button
                title="Open Kitchen Scanner"
                onPress={() => navigation.navigate('KitchenScanner', { token })}
              />
            </>
          )}
          <Button title="Logout" onPress={logout} />
        </View>
      )}
      {authError && <Text style={styles.error}>{authError}</Text>}
    </View>
  );
}

export default function App() {
  const linking = {
    prefixes: [prefix, 'imeal://'],
    config: {
      screens: {
        Auth: 'auth',
        Delegation: 'delegations',
        KitchenDashboard: 'kitchen-dashboard',
        KitchenScanner: 'scanner',
        PickupIntent: 'pickup',
      },
    },
  };

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="PickupIntent" component={PickupIntentScreen} />
        <Stack.Screen name="Delegation" component={DelegationScreen} />
        <Stack.Screen
          name="KitchenDashboard"
          component={KitchenDashboardScreen}
        />
        <Stack.Screen name="KitchenScanner" component={KitchenScannerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  actions: {
    gap: 16,
    width: '100%',
  },
  error: {
    color: '#b91c1c',
    marginTop: 16,
    textAlign: 'center',
  },
});
