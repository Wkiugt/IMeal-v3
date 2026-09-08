import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import {
  NavigationContainer,
  useNavigation,
  type LinkingOptions,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Utensils } from 'lucide-react-native';
import { SessionProvider, useSession } from './src/auth/session';
import { DelegationScreen } from './src/screens/delegation/DelegationScreen';
import { EmployeeCalendarScreen } from './src/screens/employee/EmployeeCalendarScreen';
import { EmployeeDashboardScreen } from './src/screens/employee/EmployeeDashboardScreen';
import { EmployeeProfileScreen } from './src/screens/employee/EmployeeProfileScreen';
import { KitchenScannerScreen } from './src/screens/kitchen/KitchenScannerScreen';
import { KitchenDashboardScreen } from './src/screens/kitchen/KitchenDashboardScreen';
import { PickupIntentScreen } from './src/screens/pickup/PickupIntentScreen';
import type {
  AppTabParamList,
  AuthScreenProps,
  ProfileStackParamList,
  RootStackParamList,
} from './src/navigation';
import { PrototypeButton, PrototypeField } from './src/ui/PrototypePrimitives';
import {
  employeeNav,
  hybridEmployeeNav,
  kitchenNav,
  PrototypeTabBar,
} from './src/ui/PrototypeShell';
import { NoticeProvider } from './src/ui/BrandNotice';
import { theme } from './src/theme';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<AppTabParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const prefix = Linking.createURL('/');

function AuthScreen({ navigation }: AuthScreenProps) {
  const {
    token,
    profile,
    isRestoring,
    isSigningIn,
    authError,
    canUseEmployee,
    canUseKitchen,
    signIn,
    logout,
  } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!token || !profile) return;
    if (canUseEmployee) {
      navigation.replace('AppTabs', { screen: 'EmployeeDashboard' });
    } else if (canUseKitchen) {
      navigation.replace('AppTabs', { screen: 'KitchenDashboard' });
    }
  }, [canUseEmployee, canUseKitchen, navigation, profile, token]);

  if (isRestoring) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.accentDeep} />
      </View>
    );
  }
  if (token && profile && !canUseEmployee && !canUseKitchen) {
    return (
      <View style={styles.authCanvas}>
        <View style={styles.authCard}>
          <View style={styles.loginMark}>
            <Utensils
              size={28}
              color={theme.colors.accentDeep}
              strokeWidth={1.6}
            />
          </View>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>
            No mobile access is assigned to this account.
          </Text>
          <PrototypeButton variant="secondary" onPress={() => void logout()}>
            Log out
          </PrototypeButton>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.authCanvas}>
      <View style={styles.authCard}>
        <View style={styles.loginMark}>
          <Utensils
            size={28}
            color={theme.colors.accentDeep}
            strokeWidth={1.6}
          />
        </View>
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>
          Sign in with a local staff or kitchen account.
        </Text>
        <PrototypeField
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          style={styles.field}
        />
        <PrototypeField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          style={styles.field}
        />
        <PrototypeButton
          disabled={isSigningIn || !username || !password}
          onPress={() => void signIn(username, password)}
          style={styles.loginButton}
        >
          {isSigningIn ? 'Signing in…' : 'Sign in'}
        </PrototypeButton>
        <Text style={styles.footnote}>
          Credentials are loaded from the backend local .env configuration.
        </Text>
        {authError && <Text style={styles.error}>{authError}</Text>}
      </View>
    </View>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, isRestoring } = useSession();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (!isRestoring && !token) {
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    }
  }, [isRestoring, navigation, token]);

  if (isRestoring || !token) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.accentDeep} />
      </View>
    );
  }
  return <>{children}</>;
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{ headerShown: false, animation: 'none' }}
    >
      <ProfileStack.Screen name="ProfileHome" component={EmployeeProfileScreen} />
      <ProfileStack.Screen name="Delegation" component={DelegationScreen} />
    </ProfileStack.Navigator>
  );
}

function AppTabsNavigator() {
  const { canUseEmployee, canUseKitchen } = useSession();
  const navItems = canUseEmployee
    ? canUseKitchen
      ? hybridEmployeeNav
      : employeeNav
    : kitchenNav;

  return (
    <Tabs.Navigator
      screenOptions={{ headerShown: false, unmountOnBlur: false }}
      tabBar={(props) => <PrototypeTabBar {...props} navItems={navItems} />}
    >
      {canUseEmployee && (
        <>
          <Tabs.Screen name="EmployeeDashboard" component={EmployeeDashboardScreen} />
          <Tabs.Screen name="EmployeeCalendar" component={EmployeeCalendarScreen} />
          <Tabs.Screen name="PickupIntent" component={PickupIntentScreen} />
          {canUseKitchen && (
            <Tabs.Screen name="KitchenScanner" component={KitchenScannerScreen} />
          )}
          <Tabs.Screen name="EmployeeProfile" component={ProfileStackNavigator} />
        </>
      )}
      {!canUseEmployee && canUseKitchen && (
        <>
          <Tabs.Screen name="KitchenDashboard" component={KitchenDashboardScreen} />
          <Tabs.Screen name="KitchenScanner" component={KitchenScannerScreen} />
        </>
      )}
    </Tabs.Navigator>
  );
}

function linkingConfig(): LinkingOptions<RootStackParamList> {
  return {
    prefixes: [prefix, 'imeal://'],
    config: {
      screens: {
        Auth: 'auth',
        AppTabs: {
          screens: {
            EmployeeDashboard: 'dashboard',
            EmployeeCalendar: 'calendar',
            PickupIntent: 'pickup',
            EmployeeProfile: {
              screens: {
                ProfileHome: 'profile',
                Delegation: 'delegations',
              },
            },
            KitchenDashboard: 'kitchen-dashboard',
            KitchenScanner: 'scanner',
          },
        },
      },
    },
  };
}

export default function App() {
  return (
    <SessionProvider>
      <NoticeProvider>
        <NavigationContainer linking={linkingConfig()}>
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Auth" component={AuthScreen} />
            <RootStack.Screen name="AppTabs">
              {() => (
                <ProtectedRoute>
                  <AppTabsNavigator />
                </ProtectedRoute>
              )}
            </RootStack.Screen>
          </RootStack.Navigator>
        </NavigationContainer>
      </NoticeProvider>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  authCanvas: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.gutter,
    backgroundColor: theme.colors.canvas,
  },
  authCard: {
    width: '100%',
    maxWidth: 346,
    padding: 26,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.sm,
  },
  loginMark: {
    width: 58,
    height: 58,
    alignSelf: 'center',
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSoft,
    marginBottom: 18,
  },
  title: {
    color: theme.colors.fg,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  field: { marginBottom: 14 },
  loginButton: { marginTop: 4 },
  footnote: {
    color: theme.colors.muted,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 18,
  },
  error: {
    color: theme.colors.statusBadDeep,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
});
