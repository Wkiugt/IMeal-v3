import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ChevronRight, LogOut, UsersRound } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, employeeNav, hybridEmployeeNav } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EmployeeProfile'>;

export function EmployeeProfileScreen({ navigation }: Props) {
  const { profile, canUseKitchen, logout } = useSession();
  const [reminders, setReminders] = useState(true);
  const navItems = canUseKitchen ? hybridEmployeeNav : employeeNav;
  const go = (route: keyof RootStackParamList) => navigation.navigate(route as never);
  const displayName = profile?.name || profile?.email.split('@')[0] || 'Employee';
  const userCode = profile?.userId || profile?.id || '—';

  const handleLogout = () => {
    Alert.alert('Log out', 'Log out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <PrototypeFrame activeRoute="EmployeeProfile" navItems={navItems} onNavigate={go}>
      <View style={styles.title}><Text style={styles.heading}>Profile</Text><Text style={styles.subtitle}>Your identity, meal activity, and preferences</Text></View>
      <PrototypeCard style={styles.identityCard}>
        <Avatar initials={initials(profile?.name, 'ME')} large />
        <View style={styles.identityInfo}><Text style={styles.identityName}>{displayName}</Text><Pill><PillText>{userCode}</PillText></Pill><Text style={styles.identityDept}>Employee account</Text></View>
      </PrototypeCard>
      <PrototypeCard style={styles.statsCard}>
        <Eyebrow>THIS MONTH</Eyebrow>
        <View style={styles.statsRow}><View style={styles.stat}><Text style={styles.statNumber}>—</Text><Text style={styles.statLabel}>Meals booked</Text></View><View style={styles.statDivider} /><View style={styles.stat}><Text style={styles.statNumber}>—</Text><Text style={styles.statLabel}>Meals enjoyed</Text></View></View>
      </PrototypeCard>
      <PrototypeCard style={styles.preferencesCard}>
        <View style={styles.preferenceRow}><View><Text style={styles.preferenceLabel}>Dietary Preferences</Text><Text style={styles.preferenceSub}>Managed by your account</Text></View><Pill><PillText>Not set</PillText></Pill></View>
        <View style={styles.divider} />
        <View style={styles.preferenceRow}><View style={styles.preferenceCopy}><Text style={styles.preferenceLabel}>Booking Reminders</Text><Text style={styles.preferenceSub}>Notify before the weekly cutoff</Text></View><Switch value={reminders} onValueChange={setReminders} trackColor={{ false: theme.colors.border, true: theme.colors.accentDeep }} thumbColor={theme.colors.surface} /></View>
      </PrototypeCard>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Delegation')} style={styles.delegationRow}><View style={styles.delegationIcon}><UsersRound size={18} color={theme.colors.accentDeep} /></View><View style={styles.delegationCopy}><Text style={styles.delegationLabel}>Delegations</Text><Text style={styles.delegationSub}>Manage meal pickup permissions</Text></View><ChevronRight size={18} color={theme.colors.muted} /></Pressable>
      <Pressable accessibilityRole="button" onPress={handleLogout} style={styles.logout}><LogOut size={18} color={theme.colors.statusBadDeep} strokeWidth={1.6} /><Text style={styles.logoutText}>Log out</Text></Pressable>
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  title: { paddingVertical: 18, gap: 5 },
  heading: { color: theme.colors.fg, fontSize: 24, fontWeight: '700' },
  subtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  identityInfo: { flex: 1, gap: 7 },
  identityName: { color: theme.colors.fg, fontSize: 18, fontWeight: '700' },
  identityDept: { color: theme.colors.muted, fontSize: 13 },
  statsCard: { marginBottom: 16 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  stat: { flex: 1, gap: 4 },
  statNumber: { color: theme.colors.fg, fontSize: 30, fontWeight: '700' },
  statLabel: { color: theme.colors.muted, fontSize: 12 },
  statDivider: { width: 1, height: 40, backgroundColor: theme.colors.border },
  preferencesCard: { gap: 18, marginBottom: 16 },
  preferenceRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: theme.colors.fg, fontSize: 14, fontWeight: '600' },
  preferenceSub: { marginTop: 4, color: theme.colors.muted, fontSize: 12 },
  divider: { height: 1, backgroundColor: theme.colors.border },
  delegationRow: { minHeight: 68, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  delegationIcon: { width: 36, height: 36, borderRadius: theme.radii.sm, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  delegationCopy: { flex: 1 },
  delegationLabel: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  delegationSub: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  logout: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logoutText: { color: theme.colors.statusBadDeep, fontSize: 14, fontWeight: '700' },
});
