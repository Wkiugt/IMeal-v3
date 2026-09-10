import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI, type RegistrationRecord, type WeekRegistrationResponse } from '../../api/registrationAPI';
import { addDays, formatDay, formatMonth, formatShortDate, startOfWeek, toDateKey } from '../../businessDate';
import { PrototypeCard, Pill, PillText } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useMinimumVisibleLoading } from '../../ui/useMinimumVisibleLoading';
import { useNotice } from '../../ui/BrandNotice';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'EmployeeCalendar'>;
type WeekState = Record<string, boolean>;
type WindowDay = { cutoffAt: number; editable: boolean };
type WindowSnapshot = { serverNowAt: number; receiptAt: number; days: Record<string, WindowDay> };

function getWindowSnapshot(response: WeekRegistrationResponse, receiptAt: number): WindowSnapshot | null {
  const serverNowAt = Date.parse(response.registrationWindow?.serverNow || '');
  const days = response.registrationWindow?.days;
  if (!Number.isFinite(serverNowAt) || !Array.isArray(days) || days.length !== 7) return null;
  const parsedDays: Record<string, WindowDay> = {};
  for (const day of days) {
    const cutoffAt = Date.parse(day.cutoffAt);
    if (!day.mealDate || !Number.isFinite(cutoffAt) || typeof day.editable !== 'boolean') return null;
    parsedDays[day.mealDate] = { cutoffAt, editable: day.editable };
  }
  return { serverNowAt, receiptAt, days: parsedDays };
}

function registrationsForWeek(response: WeekRegistrationResponse, weekStart: Date): WeekState {
  const next: WeekState = {};
  for (let index = 0; index < 7; index += 1) {
    const dateKey = toDateKey(addDays(weekStart, index));
    next[dateKey] = response.registrations.some(
      (registration) => registration.mealDate.slice(0, 10) === dateKey && registration.status === 'ACTIVE',
    );
  }
  return next;
}

export function EmployeeCalendarScreen(_props: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weekState, setWeekState] = useState<WeekState>({});
  const [monthRegistrations, setMonthRegistrations] = useState<Set<string>>(new Set());
  const [windowSnapshot, setWindowSnapshot] = useState<WindowSnapshot | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(true);
  const loading = monthLoading || weekLoading;
  const visibleLoading = useMinimumVisibleLoading(loading);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const cutoffWarnings = useRef(new Set<string>());
  const monthRequestId = useRef(0);
  const weekRequestId = useRef(0);
  const weekStart = useMemo(() => startOfWeek(new Date()), []);

  const applyCurrentWeek = useCallback((response: WeekRegistrationResponse, receiptAt: number) => {
    setWeekState(registrationsForWeek(response, weekStart));
    const snapshot = getWindowSnapshot(response, receiptAt);
    if (!snapshot) {
      setAvailabilityError('Cutoff availability could not be loaded.');
      return false;
    }
    setWindowSnapshot(snapshot);
    setAvailabilityError(null);
    return true;
  }, [weekStart]);

  const refreshCurrentWeek = useCallback(async () => {
    if (!token) return;
    const requestId = ++weekRequestId.current;
    try {
      const receiptAt = Date.now();
      const response = await registrationAPI.getWeek(toDateKey(weekStart), token);
      if (requestId !== weekRequestId.current) return;
      if (!applyCurrentWeek(response, receiptAt)) {
        showNotice({ title: 'Calendar unavailable', message: 'Cutoff availability could not be loaded.', tone: 'error' });
      }
    } catch (error: unknown) {
      if (requestId !== weekRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load meal registrations';
      setAvailabilityError(message);
      showNotice({ title: 'Calendar unavailable', message, tone: 'error' });
    } finally {
      if (requestId === weekRequestId.current) setWeekLoading(false);
    }
  }, [applyCurrentWeek, showNotice, token, weekStart]);

  const loadMonth = useCallback(async () => {
    if (!token) return;
    const currentMonthRequestId = ++monthRequestId.current;
    const currentWeekRequestId = ++weekRequestId.current;
    let phase: 'month' | 'week' = 'month';
    setMonthLoading(true);
    setWeekLoading(true);
    try {
      const firstWeek = startOfWeek(month);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const starts: string[] = [];
      for (let cursor = firstWeek; cursor <= lastDay; cursor = addDays(cursor, 7)) starts.push(toDateKey(cursor));
      const responses = await Promise.all(starts.map((startDate) => registrationAPI.getWeek(startDate, token)));
      if (currentMonthRequestId !== monthRequestId.current) return;
      const registrations: RegistrationRecord[] = responses.flatMap((response) => response.registrations);
      setMonthRegistrations(new Set(registrations.filter((registration) => registration.status === 'ACTIVE').map((registration) => registration.mealDate.slice(0, 10))));

      if (currentWeekRequestId !== weekRequestId.current) return;
      phase = 'week';
      const receiptAt = Date.now();
      const currentWeekResponse = await registrationAPI.getWeek(toDateKey(weekStart), token);
      if (currentWeekRequestId !== weekRequestId.current) return;
      if (!applyCurrentWeek(currentWeekResponse, receiptAt)) {
        showNotice({ title: 'Calendar unavailable', message: 'Cutoff availability could not be loaded.', tone: 'error' });
      }
    } catch (error: unknown) {
      const requestIsCurrent = phase === 'month'
        ? currentMonthRequestId === monthRequestId.current
        : currentWeekRequestId === weekRequestId.current;
      if (!requestIsCurrent) return;
      const message = error instanceof Error ? error.message : 'Unable to load meal registrations';
      setAvailabilityError(message);
      showNotice({ title: 'Calendar unavailable', message, tone: 'error' });
    } finally {
      if (currentMonthRequestId === monthRequestId.current) setMonthLoading(false);
      if (currentWeekRequestId === weekRequestId.current) setWeekLoading(false);
    }
  }, [applyCurrentWeek, month, showNotice, token, weekStart]);

  useEffect(() => {
    void loadMonth();
    return () => {
      monthRequestId.current += 1;
      weekRequestId.current += 1;
    };
  }, [loadMonth]);
  useFocusEffect(useCallback(() => {
    void refreshCurrentWeek();
    return () => {
      weekRequestId.current += 1;
    };
  }, [refreshCurrentWeek]));

  useEffect(() => {
    if (!windowSnapshot) return;
    const futureDays = Object.values(windowSnapshot.days).filter((day) => day.editable);
    if (futureDays.length === 0) return;
    const nextCutoffAt = Math.min(...futureDays.map((day) => day.cutoffAt));
    const remaining = nextCutoffAt - windowSnapshot.serverNowAt - (Date.now() - windowSnapshot.receiptAt);
    const timer = setTimeout(() => { void refreshCurrentWeek(); }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [refreshCurrentWeek, windowSnapshot]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const result: Array<Date | null> = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); day += 1) result.push(new Date(month.getFullYear(), month.getMonth(), day));
    return result;
  }, [month]);

  const handleCutoffFailure = useCallback((dateKey: string, previous: boolean) => {
    setWeekState((current) => ({ ...current, [dateKey]: previous }));
    setWindowSnapshot((current) => current ? { ...current, days: { ...current.days, [dateKey]: { ...(current.days[dateKey] || { cutoffAt: Date.now(), editable: false }), editable: false } } } : current);
    if (!cutoffWarnings.current.has(dateKey)) {
      cutoffWarnings.current.add(dateKey);
      showNotice({ title: 'Registration locked', message: 'The cutoff time has passed for this day.', tone: 'warning' });
    }
    void refreshCurrentWeek();
  }, [refreshCurrentWeek, showNotice]);

  const toggleRegistration = async (dateKey: string) => {
    if (!token || savingDate) return;
    const windowDay = windowSnapshot?.days[dateKey];
    if (!windowDay?.editable) return;
    const previous = weekState[dateKey] || false;
    const next = !previous;
    setWeekState((current) => ({ ...current, [dateKey]: next }));
    setSavingDate(dateKey);
    try {
      const results = await registrationAPI.batchRegister([{ mealDate: dateKey, status: next ? 'ACTIVE' : 'CANCELLED' }], token);
      const result = results.find((entry) => entry.date === dateKey);
      if (!result?.success) {
        if (result?.reason === 'Cutoff time exceeded') handleCutoffFailure(dateKey, previous);
        else {
          setWeekState((current) => ({ ...current, [dateKey]: previous }));
          showNotice({ title: 'Registration not changed', message: result?.reason || 'Unable to update this day', tone: 'error' });
        }
        return;
      }
      setMonthRegistrations((current) => {
        const updated = new Set(current);
        if (next) updated.add(dateKey); else updated.delete(dateKey);
        return updated;
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to update this day';
      if (message === 'Cutoff time exceeded') handleCutoffFailure(dateKey, previous);
      else {
        setWeekState((current) => ({ ...current, [dateKey]: previous }));
        showNotice({ title: 'Registration not changed', message, tone: 'error' });
      }
    } finally {
      setSavingDate(null);
    }
  };

  const todayKey = toDateKey(new Date());
  return (
    <PrototypeFrame>
      <View style={styles.header}>
        <Text style={styles.month}>{formatMonth(month)}</Text>
        <View style={styles.monthNav}>
          <Pressable accessibilityLabel="Previous month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={styles.monthButton}><ChevronLeft size={16} color={theme.colors.accentDeep} /></Pressable>
          <Pressable accessibilityLabel="Next month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={styles.monthButton}><ChevronRight size={16} color={theme.colors.accentDeep} /></Pressable>
        </View>
      </View>
      <PrototypeCard style={styles.calendarCard}>
        <View style={styles.weekdayRow}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.dayGrid}>{days.map((day, index) => { if (!day) return <View key={`empty-${index}`} style={styles.dayCell} />; const key = toDateKey(day); const booked = monthRegistrations.has(key); const today = key === todayKey; return <View key={key} style={[styles.dayCell, booked && styles.bookedDay, today && styles.todayDay]}><Text style={[styles.dayNumber, booked && styles.bookedText]}>{day.getDate()}</Text>{booked && <View style={styles.dot} />}</View>; })}</View>
      </PrototypeCard>
      <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.swatch, styles.bookedSwatch]} /><Text style={styles.legendText}>Booked</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.todaySwatch]} /><Text style={styles.legendText}>Today</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.availableSwatch]} /><Text style={styles.legendText}>Available</Text></View></View>
      <View style={styles.weekHeader}><PrototypeSectionTitle title="Weekly Meal Registration" subtitle={`${formatShortDate(weekStart)}–${formatShortDate(addDays(weekStart, 6))} · Toggle a day on to register lunch`} /></View>
      <StateTransition stateKey={visibleLoading ? 'loading' : availabilityError && !windowSnapshot ? 'error' : 'ready'}>
        {visibleLoading ? (
          <BrandLoader label="Loading meal calendar…" />
        ) : availabilityError && !windowSnapshot ? (
          <Pressable accessibilityRole="button" onPress={() => void loadMonth()} style={styles.retry}>
            <Text style={styles.retryText}>{availabilityError}</Text>
            <Text style={styles.retryAction}>Retry</Text>
          </Pressable>
        ) : (
          Array.from({ length: 7 }, (_, index) => {
            const date = addDays(weekStart, index);
            const dateKey = toDateKey(date);
            const active = Boolean(weekState[dateKey]);
            const editable = windowSnapshot?.days[dateKey]?.editable === true;
            const locked = !editable;
            const disabled = savingDate !== null || locked;
            return (
              <View key={dateKey} style={[styles.weekRow, dateKey === todayKey && styles.todayRow]}>
                <View style={styles.weekInfo}>
                  <View style={styles.weekDayLine}>
                    <Text style={styles.weekDay}>{formatDay(date)}</Text>
                    {dateKey === todayKey && <Pill><PillText>Today</PillText></Pill>}
                    {locked && <Pill tone="warn"><Text style={styles.lockedLabel}>Locked</Text></Pill>}
                  </View>
                  <Text style={styles.weekDate}>{formatShortDate(date)}</Text>
                </View>
                <AnimatedMealToggle
                  value={active}
                  disabled={disabled}
                  saving={savingDate === dateKey}
                  accessibilityLabel={`Toggle lunch registration for ${formatDay(date)}${locked ? ', locked after cutoff' : ''}`}
                  onPress={() => void toggleRegistration(dateKey)}
                />
              </View>
            );
          })
        )}
      </StateTransition>
    </PrototypeFrame>
  );
}

function AnimatedMealToggle({ value, disabled, saving, accessibilityLabel, onPress }: { value: boolean; disabled: boolean; saving: boolean; accessibilityLabel: string; onPress: () => void }) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    const toValue = value ? 1 : 0;
    if (reducedMotion) { progress.setValue(toValue); return; }
    Animated.timing(progress, { toValue, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, reducedMotion, value]);
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={[styles.toggle, value && styles.toggleActive, (disabled || saving) && styles.toggleSaving]}><Animated.View style={[styles.toggleThumb, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} /></Pressable>;
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
  retry: { padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.statusBadDeep, borderRadius: theme.radii.md, backgroundColor: theme.colors.statusBadTint, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retryText: { flex: 1, color: theme.colors.statusBadDeep, fontSize: 13, lineHeight: 19 },
  retryAction: { color: theme.colors.statusBadDeep, fontSize: 13, fontWeight: '700' },
  weekRow: { minHeight: 64, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  todayRow: { backgroundColor: theme.colors.accentTint, marginHorizontal: -theme.spacing.gutter, paddingHorizontal: theme.spacing.gutter },
  weekInfo: { flex: 1, gap: 5 },
  weekDayLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  weekDay: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  weekDate: { color: theme.colors.muted, fontSize: 13 },
  lockedLabel: { color: theme.colors.statusWarnDeep, fontSize: 12, fontWeight: '700' },
  toggle: { width: 48, height: 28, padding: 3, justifyContent: 'center', borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  toggleActive: { backgroundColor: theme.colors.accentDeep },
  toggleSaving: { opacity: 0.5 },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
});
