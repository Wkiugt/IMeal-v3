import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider, useLanguage } from './src/i18n/LanguageProvider';
import { SessionProvider, useSession } from './src/auth/session';
import { translate } from './src/i18n/translations';
import { EmployeeCalendarScreen } from './src/screens/employee/EmployeeCalendarScreen';
import { EmployeeDashboardScreen } from './src/screens/employee/EmployeeDashboardScreen';
import { EmployeeProfileScreen } from './src/screens/employee/EmployeeProfileScreen';
import { MealHistoryScreen } from './src/screens/employee/MealHistoryScreen';
import { PenaltyListScreen } from './src/screens/employee/PenaltyListScreen';
import { PenaltyDetailScreen } from './src/screens/employee/PenaltyDetailScreen';
import { NotificationDetailScreen } from './src/screens/notifications/NotificationDetailScreen';
import { NotificationListScreen } from './src/screens/notifications/NotificationListScreen';
import { KitchenQrScreen } from './src/screens/kitchen/KitchenQrScreen';
import { KitchenDashboardScreen } from './src/screens/kitchen/KitchenDashboardScreen';
import { KitchenProfileScreen } from './src/screens/kitchen/KitchenProfileScreen';
import { SelfCheckInScreen } from './src/screens/checkIn/SelfCheckInScreen';
import { EmailOtpScreen } from './src/screens/auth/EmailOtpScreen';
import {
  flushPendingNotificationNavigation,
  navigationRef,
} from './src/navigation';
import type {
  AppTabParamList,
  AuthScreenProps,
  NotificationStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './src/navigation';
import { ActionButton, AppText } from './src/ui/components';
import {
  employeeNav,
  hybridEmployeeNav,
  kitchenNav,
  AppTabBar,
} from './src/ui/AppShell';
import { NoticeProvider } from './src/ui/BrandNotice';
import { ScreenLoading } from './src/ui/BrandMotion';
import { useMinimumVisibleLoading } from './src/ui/useMinimumVisibleLoading';
import { useScreenLoadingGate } from './src/ui/useScreenLoadingGate';
import { designTokens } from './src/ui/designTokens';
import { NotificationProvider } from './src/notifications/NotificationProvider';
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<AppTabParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const NotificationStack =
  createNativeStackNavigator<NotificationStackParamList>();
const prefix = Linking.createURL('/');

function AuthScreen({ navigation }: AuthScreenProps) {
  const {
    token,
    profile,
    isRestoring,
    isVerifyingOtp,
    authError,
    canUseEmployee,
    canUseKitchen,
    logout,
  } = useSession();
  const isFocused = useIsFocused();
  const visibleRestoring = useScreenLoadingGate(isFocused, !isRestoring);
  const noMobileAccess =
    Boolean(token && profile) && !canUseEmployee && !canUseKitchen;
  const { t } = useLanguage();

  useEffect(() => {
    if (!token || !profile || isVerifyingOtp || visibleRestoring) return;
    if (canUseEmployee) {
      navigation.replace('AppTabs', { screen: 'EmployeeDashboard' });
    } else if (canUseKitchen) {
      navigation.replace('AppTabs', { screen: 'KitchenDashboard' });
    }
  }, [
    canUseEmployee,
    canUseKitchen,
    isVerifyingOtp,
    navigation,
    profile,
    token,
    visibleRestoring,
  ]);
  if (visibleRestoring)
    return <ScreenLoading label={translate('auth.restoreSession')} />;
  if (noMobileAccess) {
    return (
      <View style={styles.authNoAccess}>
        <AppText variant="pageTitle" style={styles.authNoAccessTitle}>
          {t('auth.welcome')}
        </AppText>
        <AppText
          variant="body"
          tone="secondary"
          style={styles.authNoAccessText}
        >
          {t('auth.noMobileAccess')}
        </AppText>
        {authError && (
          <AppText variant="supporting" tone="critical">
            {authError}
          </AppText>
        )}
        <ActionButton
          variant="secondary"
          size="md"
          label={t('auth.logOut')}
          onPress={() => void logout()}
        />
      </View>
    );
  }
  return <EmailOtpScreen />;
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
      initialRouteName="ProfileHome"
      screenOptions={{ headerShown: false, animation: 'none' }}
    >
      <ProfileStack.Screen
        name="ProfileHome"
        component={EmployeeProfileScreen}
      />
      <ProfileStack.Screen name="MealHistory" component={MealHistoryScreen} />
      <ProfileStack.Screen name="PenaltyList" component={PenaltyListScreen} />
      <ProfileStack.Screen
        name="PenaltyDetail"
        component={PenaltyDetailScreen}
      />
    </ProfileStack.Navigator>
  );
}

function NotificationStackNavigator() {
  return (
    <NotificationStack.Navigator
      screenOptions={{ headerShown: false, animation: 'none' }}
    >
      <NotificationStack.Screen
        name="NotificationList"
        component={NotificationListScreen}
      />
      <NotificationStack.Screen
        name="NotificationDetail"
        component={NotificationDetailScreen}
      />
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
          <Tabs.Screen
            name="EmployeeDashboard"
            component={EmployeeDashboardScreen}
          />
          <Tabs.Screen
            name="EmployeeCalendar"
            component={EmployeeCalendarScreen}
          />
          <Tabs.Screen name="SelfCheckIn" component={SelfCheckInScreen} />
          <Tabs.Screen
            name="Notifications"
            component={NotificationStackNavigator}
          />
          <Tabs.Screen
            name="EmployeeProfile"
            component={ProfileStackNavigator}
          />
        </>
      )}
      {!canUseEmployee && canUseKitchen && (
        <>
          <Tabs.Screen
            name="KitchenDashboard"
            component={KitchenDashboardScreen}
          />
          <Tabs.Screen name="KitchenQr" component={KitchenQrScreen} />
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
            SelfCheckIn: 'check-in',
            Notifications: {
              screens: {
                NotificationList: 'notifications',
                NotificationDetail: 'notifications/:notificationId',
              },
            },
            EmployeeProfile: {
              screens: {
                ProfileHome: 'profile',
                MealHistory: 'profile/meal-history',
                PenaltyList: 'profile/penalties',
                PenaltyDetail: 'profile/penalties/:penaltyId',
              },
            },
            KitchenDashboard: 'kitchen-dashboard',
            KitchenQr: 'kitchen-qr',
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
    <NavigationContainer
      linking={linkingConfig()}
      ref={navigationRef}
      onReady={flushPendingNotificationNavigation}
    >
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
      <AppText
        variant="body"
        tone="secondary"
        style={styles.bootstrapErrorText}
      >
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
  authNoAccess: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.md,
    padding: designTokens.space['2xl'],
    backgroundColor: designTokens.color.background.page,
  },
  authNoAccessTitle: {
    textAlign: 'center',
  },
  authNoAccessText: {
    textAlign: 'center',
  },
});
