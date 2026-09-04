import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { Utensils } from 'lucide-react-native';
import { SessionProvider, useSession } from './src/auth/session';
import { DelegationScreen } from './src/screens/delegation/DelegationScreen';
import { EmployeeCalendarScreen } from './src/screens/employee/EmployeeCalendarScreen';
import { EmployeeDashboardScreen } from './src/screens/employee/EmployeeDashboardScreen';
import { EmployeeProfileScreen } from './src/screens/employee/EmployeeProfileScreen';
import { KitchenScannerScreen } from './src/screens/kitchen/KitchenScannerScreen';
import { KitchenDashboardScreen } from './src/screens/kitchen/KitchenDashboardScreen';
import { PickupIntentScreen } from './src/screens/pickup/PickupIntentScreen';
import type { RootStackParamList } from './src/navigation';
import { PrototypeButton } from './src/ui/PrototypePrimitives';
import { theme } from './src/theme';

WebBrowser.maybeCompleteAuthSession();

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefix = Linking.createURL('/');

type AuthScreenProps = NativeStackScreenProps<RootStackParamList, 'Auth'>;

function AuthScreen({ navigation }: AuthScreenProps) {
  const { token, profile, isRestoring, isSigningIn, canSignIn, authError, canUseEmployee, canUseKitchen, signIn, logout } = useSession();

  useEffect(() => {
    if (!token || !profile) return;
    if (canUseEmployee) navigation.replace('EmployeeDashboard');
    else if (canUseKitchen) navigation.replace('KitchenDashboard');
  }, [canUseEmployee, canUseKitchen, navigation, profile, token]);

  if (isRestoring) return <View style={styles.loading}><ActivityIndicator color={theme.colors.accentDeep} /></View>;
  if (token && profile && !canUseEmployee && !canUseKitchen) {
    return <View style={styles.authCanvas}><View style={styles.authCard}><View style={styles.loginMark}><Utensils size={28} color={theme.colors.accentDeep} strokeWidth={1.6} /></View><Text style={styles.title}>Welcome</Text><Text style={styles.subtitle}>No mobile access is assigned to this account.</Text><PrototypeButton variant="secondary" onPress={() => void logout()}>Log out</PrototypeButton></View></View>;
  }
  return <View style={styles.authCanvas}><View style={styles.authCard}><View style={styles.loginMark}><Utensils size={28} color={theme.colors.accentDeep} strokeWidth={1.6} /></View><Text style={styles.title}>Welcome</Text><Text style={styles.subtitle}>Sign in with your work account to register meals and check in at the canteen.</Text><Pressable disabled={isSigningIn || !canSignIn} onPress={() => void signIn()} style={[styles.microsoftButton, (isSigningIn || !canSignIn) && styles.disabled]}><View style={styles.microsoftLogo}><View style={styles.msSquareRow}><View style={[styles.msSquare, styles.msRed]} /><View style={[styles.msSquare, styles.msGreen]} /></View><View style={styles.msSquareRow}><View style={[styles.msSquare, styles.msBlue]} /><View style={[styles.msSquare, styles.msYellow]} /></View></View><Text style={styles.microsoftText}>{isSigningIn ? 'Signing in…' : 'Login with Microsoft'}</Text></Pressable><Text style={styles.footnote}>Access is limited to employees with a company Microsoft account.</Text>{authError && <Text style={styles.error}>{authError}</Text>}</View></View>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, isRestoring } = useSession();
  const navigation = useNavigation();
  useEffect(() => {
    if (!isRestoring && !token) navigation.navigate('Auth' as never);
  }, [isRestoring, navigation, token]);
  if (isRestoring || !token) return <View style={styles.loading}><ActivityIndicator color={theme.colors.accentDeep} /></View>;
  return <>{children}</>;
}

function linkingConfig() {
  return {
    prefixes: [prefix, 'imeal://'],
    config: { screens: { Auth: 'auth', EmployeeDashboard: 'dashboard', EmployeeCalendar: 'calendar', PickupIntent: 'pickup', EmployeeProfile: 'profile', Delegation: 'delegations', KitchenDashboard: 'kitchen-dashboard', KitchenScanner: 'scanner' } },
  };
}

export default function App() {
  return <SessionProvider><NavigationContainer linking={linkingConfig()}><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Auth" component={AuthScreen} /><Stack.Screen name="EmployeeDashboard">{(props) => <ProtectedRoute><EmployeeDashboardScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="EmployeeCalendar">{(props) => <ProtectedRoute><EmployeeCalendarScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="PickupIntent">{(props) => <ProtectedRoute><PickupIntentScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="EmployeeProfile">{(props) => <ProtectedRoute><EmployeeProfileScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="Delegation">{(props) => <ProtectedRoute><DelegationScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="KitchenDashboard">{(props) => <ProtectedRoute><KitchenDashboardScreen {...props} /></ProtectedRoute>}</Stack.Screen><Stack.Screen name="KitchenScanner">{(props) => <ProtectedRoute><KitchenScannerScreen {...props} /></ProtectedRoute>}</Stack.Screen></Stack.Navigator></NavigationContainer></SessionProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg },
  authCanvas: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.gutter, backgroundColor: theme.colors.canvas },
  authCard: { width: '100%', maxWidth: 346, alignItems: 'center', padding: 26, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
  loginMark: { width: 58, height: 58, borderRadius: theme.radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft, marginBottom: 18 },
  title: { color: theme.colors.fg, fontSize: 30, fontWeight: '700' },
  subtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  microsoftButton: { width: '100%', minHeight: 52, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...theme.shadows.sm },
  microsoftLogo: { width: 18, height: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
  msSquareRow: { flexDirection: 'row', gap: 1 },
  msSquare: { width: 8.5, height: 8.5 },
  msRed: { backgroundColor: '#f25022' },
  msGreen: { backgroundColor: '#7fba00' },
  msBlue: { backgroundColor: '#00a4ef' },
  msYellow: { backgroundColor: '#ffb900' },
  microsoftText: { color: theme.colors.fg, fontSize: 14, fontWeight: '600' },
  footnote: { color: theme.colors.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  error: { color: theme.colors.statusBadDeep, fontSize: 13, textAlign: 'center', marginTop: 16 },
  disabled: { opacity: 0.5 },
});
