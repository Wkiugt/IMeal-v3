import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useFonts } from 'expo-font';
import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
} from '@expo-google-fonts/be-vietnam-pro';
import {
  NavigationContainer,
  useIsFocused,
  useNavigation,
  type LinkingOptions,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LanguageProvider, useLanguage } from './src/i18n/LanguageProvider';
import { SessionProvider, useSession } from './src/auth/session';
import { translate } from './src/i18n/translations';
import { DelegationScreen } from './src/screens/delegation/DelegationScreen';
import { EmployeeCalendarScreen } from './src/screens/employee/EmployeeCalendarScreen';
import { EmployeeDashboardScreen } from './src/screens/employee/EmployeeDashboardScreen';
import { EmployeeProfileScreen } from './src/screens/employee/EmployeeProfileScreen';
import { NotificationDetailScreen } from './src/screens/notifications/NotificationDetailScreen';
import { NotificationListScreen } from './src/screens/notifications/NotificationListScreen';
import { KitchenScannerScreen } from './src/screens/kitchen/KitchenScannerScreen';
import { KitchenDashboardScreen } from './src/screens/kitchen/KitchenDashboardScreen';
import { KitchenProfileScreen } from './src/screens/kitchen/KitchenProfileScreen';
import { PickupIntentScreen } from './src/screens/pickup/PickupIntentScreen';
import { flushPendingNotificationNavigation, navigationRef } from './src/navigation';
import type {
  AppTabParamList,
  AuthScreenProps,
  NotificationStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './src/navigation';
import { ActionButton, AppText, TextField } from './src/ui/components';
import {
  employeeNav,
  hybridEmployeeNav,
  kitchenNav,
  AppTabBar,
} from './src/ui/AppShell';
import { NoticeProvider } from './src/ui/BrandNotice';
import { ScreenLoading, BrandMark, StateTransition } from './src/ui/BrandMotion';
import { useMinimumVisibleLoading } from './src/ui/useMinimumVisibleLoading';
import { useScreenLoadingGate } from './src/ui/useScreenLoadingGate';
import { designTokens, getElevationStyle } from './src/ui/designTokens';
import { NotificationProvider } from './src/notifications/NotificationProvider';
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<AppTabParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const NotificationStack = createNativeStackNavigator<NotificationStackParamList>();
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
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const isFocused = useIsFocused();
  const visibleRestoring = useScreenLoadingGate(isFocused, !isRestoring);
  const visibleSigningIn = useMinimumVisibleLoading(isSigningIn, 1_500);
  useEffect(() => {
    if (!token || !profile || isSigningIn || visibleRestoring || visibleSigningIn) return;
    if (canUseEmployee) {
      navigation.replace('AppTabs', { screen: 'EmployeeDashboard' });
    } else if (canUseKitchen) {
      navigation.replace('AppTabs', { screen: 'KitchenDashboard' });
    }
  }, [canUseEmployee, canUseKitchen, isSigningIn, navigation, profile, token, visibleRestoring, visibleSigningIn]);

  const noMobileAccess =
    Boolean(token && profile) && !canUseEmployee && !canUseKitchen;
  const authState = visibleRestoring
    ? 'restoring'
    : visibleSigningIn
      ? 'signing-in'
      : noMobileAccess
        ? 'no-access'
        : 'sign-in';

  return (
    <SafeAreaView style={styles.authSafeArea}>
      <KeyboardAvoidingView
        style={styles.authKeyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <StateTransition stateKey={authState} style={styles.stateTransition}>
            {visibleRestoring ? (
              <ScreenLoading label={t('auth.restoreSession')} />
            ) : visibleSigningIn ? (
              <ScreenLoading label={t('auth.signingIn')} />
            ) : noMobileAccess ? (
              <View style={styles.authCanvas}>
                <View style={styles.authCard}>
                  <BrandMark size={32} containerSize={72} style={styles.authMark} />
                  <AppText variant="pageTitle" style={styles.title}>{t('auth.welcome')}</AppText>
                  <AppText variant="body" tone="secondary" style={styles.subtitle}>
                    {t('auth.noMobileAccess')}
                  </AppText>
                  <ActionButton
                    variant="secondary"
                    size="md"
                    label={t('auth.logOut')}
                    onPress={() => void logout()}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.authCanvas}>
                <View style={styles.authCard}>
                  <BrandMark size={32} containerSize={72} style={styles.authMark} />
                  <AppText variant="pageTitle" style={styles.title}>{t('auth.welcome')}</AppText>
                  <AppText variant="body" tone="secondary" style={styles.subtitle}>
                    {t('auth.localSignInHint')}
                  </AppText>
                  <TextField
                    label={t('auth.username')}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    containerStyle={styles.field}
                  />
                  <TextField
                    label={t('auth.password')}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="password"
                    containerStyle={styles.field}
                  />
                  <ActionButton
                    variant="primary"
                    size="lg"
                    label={t('auth.signIn')}
                    disabled={isSigningIn || !username || !password}
                    onPress={() => void signIn(username, password)}
                    style={styles.loginButton}
                  />
                  <AppText variant="caption" tone="secondary" style={styles.footnote}>
                    {t('auth.credentialsHint')}
                  </AppText>
                  {authError && (
                    <AppText variant="supporting" tone="critical" style={styles.error}>
                      {authError}
                    </AppText>
                  )}
                </View>
              </View>
            )}
          </StateTransition>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, isRestoring } = useSession();
  const { t } = useLanguage();
  const isFocused = useIsFocused();
  const noSession = !isRestoring && !token;
  const visibleRestoring = useScreenLoadingGate(isFocused, !isRestoring);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (noSession) {
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    }
  }, [navigation, noSession]);

  if (visibleRestoring) {
    return <ScreenLoading label={t('auth.restoreSession')} />;
  }
  if (noSession) return null;
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

function NotificationStackNavigator() {
  return (
    <NotificationStack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <NotificationStack.Screen name="NotificationList" component={NotificationListScreen} />
      <NotificationStack.Screen name="NotificationDetail" component={NotificationDetailScreen} />
    </NotificationStack.Navigator>
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
      tabBar={(props) => <AppTabBar {...props} navItems={navItems} />}
    >
      {canUseEmployee && (
        <>
          <Tabs.Screen name="EmployeeDashboard" component={EmployeeDashboardScreen} />
          <Tabs.Screen name="EmployeeCalendar" component={EmployeeCalendarScreen} />
          <Tabs.Screen name="PickupIntent" component={PickupIntentScreen} />
          <Tabs.Screen name="Notifications" component={NotificationStackNavigator} />
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
          <Tabs.Screen name="KitchenProfile" component={KitchenProfileScreen} />
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
            Notifications: {
              screens: {
                NotificationList: 'notifications',
                NotificationDetail: 'notifications/:notificationId',
              },
            },
            EmployeeProfile: {
              screens: {
                ProfileHome: 'profile',
                Delegation: 'delegations',
              },
            },
            KitchenDashboard: 'kitchen-dashboard',
            KitchenScanner: 'scanner',
            KitchenProfile: 'kitchen-profile',
          },
        },
      },
    },
  };
}

function NavigationRoot() {
  const { isRestoring, t } = useLanguage();
  const visibleRestoring = useMinimumVisibleLoading(isRestoring, 1_500);
  if (visibleRestoring) {
    return <ScreenLoading label={t('bootstrap.restoringLanguage')} />;
  }

  return (
    <NavigationContainer linking={linkingConfig()} ref={navigationRef} onReady={flushPendingNotificationNavigation}>
      <RootStack.Navigator
        screenOptions={{ headerShown: false, animation: 'none' }}
      >
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
  );
}

function FontBootstrapError() {
  return (
    <View style={styles.bootstrapError}>
      <AppText variant="sectionTitle" style={styles.bootstrapErrorTitle}>
        {translate('bootstrap.fontErrorTitle')}
      </AppText>
      <AppText variant="body" tone="secondary" style={styles.bootstrapErrorText}>
        {translate('bootstrap.fontErrorText')}
      </AppText>
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  if (fontError) return <FontBootstrapError />;
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SessionProvider>
          <NotificationProvider>
            <NoticeProvider>
              <NavigationRoot />
            </NoticeProvider>
          </NotificationProvider>
        </SessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  authSafeArea: {
    flex: 1,
    backgroundColor: designTokens.color.background.page,
  },
  authKeyboard: {
    flex: 1,
  },
  authScrollContent: {
    flexGrow: 1,
    padding: designTokens.space['2xl'],
  },
  stateTransition: {
    flexGrow: 1,
  },
  authCanvas: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authCard: {
    width: '100%',
    maxWidth: 346,
    padding: 26,
    borderWidth: 1,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.floating,
    backgroundColor: designTokens.color.surface.standard,
    ...getElevationStyle(1),
  },
  authMark: {
    alignSelf: 'center',
    marginBottom: 18,
    borderRadius: designTokens.radius.full,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: designTokens.space.sm,
    marginBottom: designTokens.space['2xl'],
  },
  field: { marginBottom: 14 },
  loginButton: { marginTop: 4 },
  footnote: {
    flexShrink: 1,
    textAlign: 'center',
    marginTop: 18,
  },
  error: {
    textAlign: 'center',
    marginTop: 16,
  },
  bootstrapError: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: designTokens.space['2xl'],
    backgroundColor: designTokens.color.background.page,
  },
  bootstrapErrorTitle: {
    textAlign: 'center',
  },
  bootstrapErrorText: {
    marginTop: 8,
    textAlign: 'center',
  },
});
