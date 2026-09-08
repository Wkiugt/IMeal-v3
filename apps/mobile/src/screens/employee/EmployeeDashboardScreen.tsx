import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, CalendarDays, MapPin, QrCode } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI } from '../../api/registrationAPI';
import { startOfWeek, toDateKey, initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'EmployeeDashboard'>;

export function EmployeeDashboardScreen({ navigation }: Props) {
  const { token, profile } = useSession();
  const [todayRegistered, setTodayRegistered] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    setLoading(true);
    void registrationAPI.getWeek(toDateKey(startOfWeek(new Date())), token)
      .then(({ registrations }) => {
        if (mounted) {
          const today = toDateKey(new Date());
          setTodayRegistered(registrations.some((registration) => registration.mealDate.slice(0, 10) === today && registration.status === 'ACTIVE'));
        }
      })
      .catch(() => {
        if (mounted) setTodayRegistered(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [token]);

  const greetingName = profile?.name || profile?.email.split('@')[0] || 'there';
  const status = loading ? 'Loading…' : todayRegistered === true ? 'Confirmed' : todayRegistered === false ? 'Not registered' : 'Unavailable';
  const statusTone = loading || todayRegistered === true ? 'soft' : 'warn';
  const today = new Date();
  return (
    <PrototypeFrame>
      <View style={styles.greeting}>
        <View>
          <Eyebrow>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</Eyebrow>
          <Text style={styles.greetingName}>Hi, {greetingName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => navigation.navigate('EmployeeProfile')}
          style={({ pressed }) => [styles.avatarButton, pressed && styles.avatarPressed]}
        >
          <Avatar initials={initials(profile?.name, 'ME')} />
        </Pressable>
      </View>
      <PrototypeCard style={styles.mealCard}>
        <View style={styles.topRow}>
          <Pill><PillText>Lunch · 12:00–13:00</PillText></Pill>
          <StateTransition stateKey={loading ? 'loading' : todayRegistered === null ? 'unavailable' : 'loaded'} style={styles.statusTransition}>
            {loading ? <BrandLoader compact label="Loading today’s registration…" /> : <Pill tone={statusTone}><PillText>{status}</PillText></Pill>}
          </StateTransition>
        </View>
        <Text style={styles.mealTitle}>Grilled Chicken Rice Bowl</Text>
        <Text style={styles.mealSub}>Steamed rice, grilled chicken thigh, stir-fried greens</Text>
        <View style={styles.divider} />
        <View style={styles.metaRow}><MapPin size={16} color={theme.colors.accentDeep} strokeWidth={1.6} /><Text style={styles.metaText}>Canteen A · Counter 2</Text></View>
      </PrototypeCard>

      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('PickupIntent')} style={styles.scanCta}>
        <View style={styles.scanIcon}><QrCode size={24} color={theme.colors.surface} strokeWidth={1.6} /></View>
        <View style={styles.scanCopy}><Text style={styles.scanTitle}>Open meal ticket</Text><Text style={styles.scanSub}>Show your dynamic QR at the canteen</Text></View>
        <ArrowRight size={18} color={theme.colors.surface} strokeWidth={1.6} />
      </Pressable>

      <Pressable onPress={() => navigation.navigate('EmployeeCalendar')} style={styles.calendarLink}>
        <CalendarDays size={16} color={theme.colors.accentDeep} /><Text style={styles.calendarLinkText}>Manage weekly registration</Text>
      </Pressable>
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  greeting: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 26 },
  avatarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radii.pill },
  avatarPressed: { opacity: 0.7 },
  greetingName: { marginTop: 6, color: theme.colors.fg, fontSize: 24, fontWeight: '700', letterSpacing: -0.25 },
  mealCard: { marginBottom: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  statusTransition: { alignItems: 'flex-end' },
  mealTitle: { color: theme.colors.fg, fontSize: 21, fontWeight: '700', lineHeight: 27, letterSpacing: -0.2 },
  mealSub: { marginTop: 6, color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaText: { color: theme.colors.muted, fontSize: 13 },
  scanCta: { minHeight: 86, paddingHorizontal: 22, paddingVertical: 20, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, flexDirection: 'row', alignItems: 'center', gap: 16, ...theme.shadows.md },
  scanIcon: { width: 46, height: 46, borderRadius: theme.radii.sm, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  scanCopy: { flex: 1 },
  scanTitle: { color: theme.colors.surface, fontSize: 16, fontWeight: '700' },
  scanSub: { marginTop: 2, color: 'rgba(255,255,255,0.78)', fontSize: 13 },
  calendarLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 22 },
  calendarLinkText: { color: theme.colors.accentDeep, fontSize: 13, fontWeight: '700' },
});
