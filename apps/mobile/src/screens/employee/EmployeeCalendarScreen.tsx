import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI, type RegistrationRecord } from '../../api/registrationAPI';
import { addDays, formatDay, formatMonth, formatShortDate, parseDateKey, startOfWeek, toDateKey } from '../../businessDate';
import { PrototypeCard, Eyebrow, Pill, PillText } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, employeeNav, hybridEmployeeNav, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EmployeeCalendar'>;

type WeekState = Record<string, boolean>;

export function EmployeeCalendarScreen({ navigation }: Props) {
  const { token, canUseKitchen } = useSession();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weekState, setWeekState] = useState<WeekState>({});
  const [monthRegistrations, setMonthRegistrations] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingDate, setSavingDate] = useState<string | null>(null);

  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const loadMonth = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const firstWeek = startOfWeek(month);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const starts: string[] = [];
      for (let cursor = firstWeek; cursor <= lastDay; cursor = addDays(cursor, 7)) starts.push(toDateKey(cursor));
      const responses = await Promise.all(starts.map((startDate) => registrationAPI.getWeek(startDate, token)));
      const registrations: RegistrationRecord[] = responses.flatMap((response) => response.registrations);
      setMonthRegistrations(new Set(registrations.filter((registration) => registration.status === 'ACTIVE').map((registration) => registration.mealDate.slice(0, 10))));
      const currentWeekResponse = await registrationAPI.getWeek(toDateKey(weekStart), token);
      const nextWeek: WeekState = {};
      for (let index = 0; index < 7; index += 1) {
        const dateKey = toDateKey(addDays(weekStart, index));
        nextWeek[dateKey] = currentWeekResponse.registrations.some((registration) => registration.mealDate.slice(0, 10) === dateKey && registration.status === 'ACTIVE');
      }
      setWeekState(nextWeek);
    } catch (error: unknown) {
      Alert.alert('Calendar unavailable', error instanceof Error ? error.message : 'Unable to load meal registrations');
    } finally {
      setLoading(false);
    }
  }, [month, token, weekStart]);

  useEffect(() => { void loadMonth(); }, [loadMonth]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const result: Array<Date | null> = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); day += 1) result.push(new Date(month.getFullYear(), month.getMonth(), day));
    return result;
  }, [month]);

  const toggleRegistration = async (dateKey: string) => {
    if (!token || savingDate) return;
    const previous = weekState[dateKey] || false;
    const next = !previous;
    setWeekState((current) => ({ ...current, [dateKey]: next }));
    setSavingDate(dateKey);
    try {
      const results = await registrationAPI.batchRegister([{ mealDate: dateKey, status: next ? 'ACTIVE' : 'CANCELLED' }], token);
      const result = results.find((entry) => entry.date === dateKey);
      if (!result?.success) {
        setWeekState((current) => ({ ...current, [dateKey]: previous }));
        Alert.alert('Registration not changed', result?.reason || 'Unable to update this day');
        return;
      }
      setMonthRegistrations((current) => {
        const updated = new Set(current);
        if (next) updated.add(dateKey); else updated.delete(dateKey);
        return updated;
      });
    } catch (error: unknown) {
      setWeekState((current) => ({ ...current, [dateKey]: previous }));
      Alert.alert('Registration not changed', error instanceof Error ? error.message : 'Unable to update this day');
    } finally {
      setSavingDate(null);
    }
  };

  const navItems = canUseKitchen ? hybridEmployeeNav : employeeNav;
  const go = (route: keyof RootStackParamList) => navigation.navigate(route as never);
  const todayKey = toDateKey(new Date());

  return (
    <PrototypeFrame activeRoute="EmployeeCalendar" navItems={navItems} onNavigate={go}>
      <View style={styles.header}>
        <Text style={styles.month}>{formatMonth(month)}</Text>
        <View style={styles.monthNav}>
          <Pressable accessibilityLabel="Previous month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={styles.monthButton}><ChevronLeft size={16} color={theme.colors.accentDeep} /></Pressable>
          <Pressable accessibilityLabel="Next month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={styles.monthButton}><ChevronRight size={16} color={theme.colors.accentDeep} /></Pressable>
        </View>
      </View>
      <PrototypeCard style={styles.calendarCard}>
        <View style={styles.weekdayRow}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.dayGrid}>
          {days.map((day, index) => {
            if (!day) return <View key={`empty-${index}`} style={styles.dayCell} />;
            const key = toDateKey(day);
            const booked = monthRegistrations.has(key);
            const today = key === todayKey;
            return <View key={key} style={[styles.dayCell, booked && styles.bookedDay, today && styles.todayDay]}><Text style={[styles.dayNumber, booked && styles.bookedText]}>{day.getDate()}</Text>{booked && <View style={styles.dot} />}</View>;
          })}
        </View>
      </PrototypeCard>
      <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.swatch, styles.bookedSwatch]} /><Text style={styles.legendText}>Booked</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.todaySwatch]} /><Text style={styles.legendText}>Today</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.availableSwatch]} /><Text style={styles.legendText}>Available</Text></View></View>

      <View style={styles.weekHeader}><PrototypeSectionTitle title="Weekly Meal Registration" subtitle={`${formatShortDate(weekStart)}–${formatShortDate(addDays(weekStart, 6))} · Toggle a day on to register lunch`} /></View>
      {loading ? <ActivityIndicator color={theme.colors.accentDeep} style={styles.loader} /> : Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index);
        const dateKey = toDateKey(date);
        const active = Boolean(weekState[dateKey]);
        return <View key={dateKey} style={[styles.weekRow, dateKey === todayKey && styles.todayRow]}><View style={styles.weekInfo}><View style={styles.weekDayLine}><Text style={styles.weekDay}>{formatDay(date)}</Text>{dateKey === todayKey && <Pill><PillText>Today</PillText></Pill>}</View><Text style={styles.weekDate}>{formatShortDate(date)}</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: active }} accessibilityLabel={`Toggle lunch registration for ${formatDay(date)}`} disabled={savingDate !== null} onPress={() => void toggleRegistration(dateKey)} style={[styles.toggle, active && styles.toggleActive, savingDate === dateKey && styles.toggleSaving]}><View style={[styles.toggleThumb, active && styles.toggleThumbActive]} /></Pressable></View>;
      })}
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 },
  month: { color: theme.colors.fg, fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  monthNav: { flexDirection: 'row', gap: 8 },
  monthButton: { width: 36, height: 36, borderRadius: theme.radii.pill, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  calendarCard: { paddingHorizontal: 16, paddingVertical: 18, marginBottom: 20 },
  weekdayRow: { flexDirection: 'row', marginBottom: 8 },
  weekday: { flex: 1, color: theme.colors.muted, fontFamily: theme.typography.fontMono, fontSize: 11, textAlign: 'center' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dayCell: { width: '13.25%', aspectRatio: 1, borderRadius: theme.radii.pill, alignItems: 'center', justifyContent: 'center' },
  bookedDay: { backgroundColor: theme.colors.accentSoft },
  todayDay: { borderWidth: 2, borderColor: theme.colors.accentDeep },
  dayNumber: { color: theme.colors.fg, fontSize: 14 },
  bookedText: { color: theme.colors.accentDeep, fontWeight: '700' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentDeep, marginTop: 3 },
  legend: { flexDirection: 'row', gap: 18, paddingHorizontal: 4, paddingBottom: 28 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  bookedSwatch: { backgroundColor: theme.colors.accentSoft, borderWidth: 1.5, borderColor: theme.colors.accentDeep },
  todaySwatch: { borderWidth: 1.5, borderColor: theme.colors.accentDeep },
  availableSwatch: { backgroundColor: theme.colors.border },
  legendText: { color: theme.colors.muted, fontSize: 12 },
  weekHeader: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  loader: { marginVertical: 24 },
  weekRow: { minHeight: 64, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  todayRow: { backgroundColor: theme.colors.accentTint, marginHorizontal: -theme.spacing.gutter, paddingHorizontal: theme.spacing.gutter },
  weekInfo: { gap: 5 },
  weekDayLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekDay: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  weekDate: { color: theme.colors.muted, fontSize: 13 },
  toggle: { width: 48, height: 28, padding: 3, justifyContent: 'center', borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  toggleActive: { backgroundColor: theme.colors.accentDeep },
  toggleSaving: { opacity: 0.5 },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
  toggleThumbActive: { alignSelf: 'flex-end' },
});
