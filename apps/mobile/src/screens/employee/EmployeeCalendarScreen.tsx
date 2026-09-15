import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronLeft, ChevronRight, Leaf } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI, type RegistrationRecord, type WeekRegistrationResponse } from '../../api/registrationAPI';
import { addDays, formatDay, formatMonth, formatShortDate, startOfWeek, toDateKey } from '../../businessDate';
import { buildMonthRows } from './calendarGrid';
import {
  CalendarMutationTracker,
  createWeekState,
  getMutationPayload,
  reconcileWeekState,
  type DraftChoiceByDate,
  type MealChoice,
  type WeekState,
} from './calendarRegistrationState';
import { PrototypeCard, Pill, PillText } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useInitialLoadingGate } from '../../ui/useInitialLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { theme } from '../../theme';

const CALENDAR_COPY = {
  vi: {
    mealChoiceGroup: 'Loại suất ăn',
    mealChoice: { REGULAR: 'Mặn', VEGETARIAN: 'Chay' },
    lunarDayOne: 'Mùng 1 âm lịch',
    lunarDayFifteen: 'Rằm · 15 âm lịch',
  },
  en: {
    mealChoiceGroup: 'Meal choice',
    mealChoice: { REGULAR: 'Regular', VEGETARIAN: 'Vegetarian' },
    lunarDayOne: 'Lunar day 1',
    lunarDayFifteen: 'Full moon · lunar day 15',
  },
} as const;

type Props = AppTabScreenProps<'EmployeeCalendar'>;
type WindowDay = { cutoffAt: number; editable: boolean; lunarDay: number; availableMealChoices: readonly MealChoice[] };
type WindowSnapshot = { serverNowAt: number; receiptAt: number; days: Record<string, WindowDay> };

function getWindowSnapshot(response: WeekRegistrationResponse, receiptAt: number): WindowSnapshot | null {
  const serverNowAt = Date.parse(response.registrationWindow?.serverNow || '');
  const days = response.registrationWindow?.days;
  if (!Number.isFinite(serverNowAt) || !Array.isArray(days) || days.length !== 7) return null;
  const parsedDays: Record<string, WindowDay> = {};
  for (const day of days) {
    const cutoffAt = Date.parse(day.cutoffAt);
    if (
      !day.mealDate ||
      !Number.isFinite(cutoffAt) ||
      typeof day.editable !== 'boolean' ||
      !day.lunarDate ||
      !Number.isInteger(day.lunarDate.day) ||
      !Array.isArray(day.availableMealChoices) ||
      day.availableMealChoices.length === 0
    ) return null;
    parsedDays[day.mealDate] = {
      cutoffAt,
      editable: day.editable,
      lunarDay: day.lunarDate.day,
      availableMealChoices: day.availableMealChoices,
    };
  }
  return { serverNowAt, receiptAt, days: parsedDays };
}


export function EmployeeCalendarScreen(_props: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weekState, setWeekState] = useState<WeekState>({});
  const [draftChoiceByDate, setDraftChoiceByDate] = useState<DraftChoiceByDate>({});
  const [monthRegistrations, setMonthRegistrations] = useState<Set<string>>(new Set());
  const [windowSnapshot, setWindowSnapshot] = useState<WindowSnapshot | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(true);
  const monthLoaded = useRef(false);
  const loading = monthLoading || weekLoading;
  const initialGate = useInitialLoadingGate(
    loading,
    Boolean(availabilityError && !windowSnapshot),
  );
  const hasUsableCalendarData = monthLoaded.current && windowSnapshot !== null;
  const draftChoiceRef = useRef<DraftChoiceByDate>({});
  draftChoiceRef.current = draftChoiceByDate;
  const showLoading = initialGate || (!hasUsableCalendarData && loading);
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const mutationTracker = useRef(new CalendarMutationTracker()).current;
  const cutoffWarnings = useRef(new Set<string>());
  const monthRequestId = useRef(0);
  const weekRequestId = useRef(0);
  const weekStart = useMemo(() => startOfWeek(new Date()), []);

  const applyCurrentWeek = useCallback((
    response: WeekRegistrationResponse,
    receiptAt: number,
    mutationIdsAtRequest: Readonly<Record<string, number>>,
    inFlightAtRequest: ReadonlySet<string>,
  ) => {
    const snapshot = getWindowSnapshot(response, receiptAt);
    if (!snapshot) {
      setAvailabilityError('Cutoff availability could not be loaded.');
      return false;
    }

    const serverState = createWeekState(response.registrations, weekStart);
    const shouldPreserveDate = (dateKey: string) =>
      (mutationIdsAtRequest[dateKey] ?? 0) !== mutationTracker.latestRequestId(dateKey)
      || inFlightAtRequest.has(dateKey);
    const reconciledWeekState = reconcileWeekState(
      serverState,
      draftChoiceRef.current,
      response,
      weekStart,
    ).weekState;
    setWeekState((current) => {
      const reconciled = { ...reconciledWeekState };
      for (const dateKey of Object.keys(reconciledWeekState)) {
        if (shouldPreserveDate(dateKey) && current[dateKey]) reconciled[dateKey] = current[dateKey];
      }
      return reconciled;
    });
    setDraftChoiceByDate((current) => {
      const reconciled = reconcileWeekState(serverState, current, response, weekStart);
      const next = { ...reconciled.draftChoiceByDate };
      for (const dateKey of Object.keys(serverState)) {
        if (shouldPreserveDate(dateKey) && current[dateKey]) next[dateKey] = current[dateKey];
      }
      return next;
    });
    setWindowSnapshot(snapshot);
    setAvailabilityError(null);
    return true;
  }, [weekStart]);

  const refreshCurrentWeek = useCallback(async () => {
    if (!token) return;
    const requestId = ++weekRequestId.current;
    const mutationIdsAtRequest = mutationTracker.snapshotRequestIds();
    const inFlightAtRequest = mutationTracker.snapshotInFlight();
    setWeekLoading(true);
    try {
      const receiptAt = Date.now();
      const response = await registrationAPI.getWeek(toDateKey(weekStart), token);
      if (requestId !== weekRequestId.current) return;
      if (!applyCurrentWeek(response, receiptAt, mutationIdsAtRequest, inFlightAtRequest)) {
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
    setMonthLoading(true);
    try {
      const firstWeek = startOfWeek(month);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const starts: string[] = [];
      for (let cursor = firstWeek; cursor <= lastDay; cursor = addDays(cursor, 7)) starts.push(toDateKey(cursor));
      const responses = await Promise.all(starts.map((startDate) => registrationAPI.getWeek(startDate, token)));
      if (currentMonthRequestId !== monthRequestId.current) return;
      const registrations: RegistrationRecord[] = responses.flatMap((response) => response.registrations);
      setMonthRegistrations(new Set(registrations.filter((registration) => registration.status === 'ACTIVE').map((registration) => registration.mealDate.slice(0, 10))));
      monthLoaded.current = true;
    } catch (error: unknown) {
      if (currentMonthRequestId !== monthRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load meal registrations';
      setAvailabilityError(message);
      showNotice({ title: 'Calendar unavailable', message, tone: 'error' });
    } finally {
      if (currentMonthRequestId === monthRequestId.current) setMonthLoading(false);
    }
  }, [month, showNotice, token]);

  useEffect(() => {
    void loadMonth();
    return () => {
      monthRequestId.current += 1;
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

  const monthRows = useMemo(() => buildMonthRows(month), [month]);
  const handleCutoffFailure = useCallback((
    dateKey: string,
    previousState: WeekState[string],
    previousDraft: MealChoice | undefined,
    requestId: number,
  ) => {
    if (!mutationTracker.isCurrent(dateKey, requestId)) return;
    setWeekState((current) => ({ ...current, [dateKey]: previousState }));
    setDraftChoiceByDate((current) => {
      const next = { ...current };
      if (previousDraft) next[dateKey] = previousDraft;
      else delete next[dateKey];
      return next;
    });
    setWindowSnapshot((current) => current ? {
      ...current,
      days: {
        ...current.days,
        [dateKey]: {
          ...(current.days[dateKey] || {
            cutoffAt: Date.now(),
            lunarDay: 0,
            availableMealChoices: ['REGULAR'],
            editable: false,
          }),
          editable: false,
        },
      },
    } : current);
    if (!cutoffWarnings.current.has(dateKey)) {
      cutoffWarnings.current.add(dateKey);
      showNotice({ title: 'Registration locked', message: 'The cutoff time has passed for this day.', tone: 'warning' });
    }
    void refreshCurrentWeek();
  }, [refreshCurrentWeek, showNotice]);

  const mutateRegistration = useCallback(async (
    dateKey: string,
    nextActive: boolean,
    choiceOverride?: MealChoice,
  ) => {
    if (!token || mutationTracker.isInFlight(dateKey)) return;
    const windowDay = windowSnapshot?.days[dateKey];
    if (!windowDay?.editable) return;

    const previousState = weekState[dateKey] || { active: false, mealChoice: 'REGULAR' as MealChoice };
    const previousDraft = draftChoiceByDate[dateKey];
    const payloadDrafts = choiceOverride
      ? { ...draftChoiceByDate, [dateKey]: choiceOverride }
      : draftChoiceByDate;
    const payload = getMutationPayload(dateKey, weekState, payloadDrafts, nextActive);
    const nextChoice = payload.status === 'ACTIVE' ? payload.mealChoice : previousState.mealChoice;
    const nextState = { active: nextActive, mealChoice: nextActive ? nextChoice : 'REGULAR' as MealChoice };
    const requestId = mutationTracker.begin(dateKey);
    if (requestId === null) return;
    setSavingDates((current) => new Set(current).add(dateKey));
    setWeekState((current) => ({ ...current, [dateKey]: nextState }));
    setDraftChoiceByDate((current) => {
      const next = { ...current };
      if (nextActive) delete next[dateKey];
      else if (nextChoice !== 'REGULAR' && windowDay.availableMealChoices.includes(nextChoice)) next[dateKey] = nextChoice;
      else delete next[dateKey];
      return next;
    });

    const rollback = () => {
      if (!mutationTracker.isCurrent(dateKey, requestId)) return false;
      setWeekState((current) => ({ ...current, [dateKey]: previousState }));
      setDraftChoiceByDate((current) => {
        const next = { ...current };
        if (previousDraft) next[dateKey] = previousDraft;
        else delete next[dateKey];
        return next;
      });
      return true;
    };

    try {
      const results = await registrationAPI.batchRegister([payload], token);
      if (!mutationTracker.isCurrent(dateKey, requestId)) return;
      const result = results.find((entry) => entry.date === dateKey);
      if (!result?.success) {
        const code = result && !result.success ? result.code : 'REGISTRATION_FAILED';
        if (code === 'CUTOFF_PASSED') {
          handleCutoffFailure(dateKey, previousState, previousDraft, requestId);
        } else if (rollback()) {
          let message = 'Unable to update this day.';
          switch (code) {
            case 'MEAL_CHOICE_UNAVAILABLE':
              message = 'That meal choice is not available for this day.';
              break;
            case 'REGISTRATION_FINALIZED':
              message = 'This registration has already been finalized.';
              break;
            case 'INVALID_MEAL_DATE':
              message = 'This meal date is invalid.';
              break;
            case 'REGISTRATION_FAILED':
              message = 'The meal registration could not be updated.';
              break;
          }
          showNotice({ title: 'Registration not changed', message, tone: 'error' });
        }
        return;
      }
      setMonthRegistrations((current) => {
        const updated = new Set(current);
        if (nextActive) updated.add(dateKey);
        else updated.delete(dateKey);
        return updated;
      });
    } catch (error: unknown) {
      if (!mutationTracker.isCurrent(dateKey, requestId)) return;
      let errorCode: unknown;
      if (error && typeof error === 'object' && 'code' in error) errorCode = error.code;
      if (errorCode === 'CUTOFF_PASSED') {
        handleCutoffFailure(dateKey, previousState, previousDraft, requestId);
      } else if (rollback()) {
        const message = error instanceof TypeError
          ? 'Unable to reach the meal registration service. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to update this day.';
        showNotice({ title: 'Registration not changed', message, tone: 'error' });
      }
    } finally {
      if (mutationTracker.finish(dateKey, requestId)) {
        setSavingDates((current) => {
          const next = new Set(current);
          next.delete(dateKey);
          return next;
        });
      }
    }
  }, [
    draftChoiceByDate,
    handleCutoffFailure,
    showNotice,
    token,
    weekState,
    windowSnapshot,
  ]);

  const toggleRegistration = useCallback((dateKey: string) => {
    const current = weekState[dateKey] || { active: false, mealChoice: 'REGULAR' as MealChoice };
    void mutateRegistration(dateKey, !current.active);
  }, [mutateRegistration, weekState]);

  const selectMealChoice = useCallback((dateKey: string, choice: MealChoice) => {
    if (mutationTracker.isInFlight(dateKey)) return;
    const windowDay = windowSnapshot?.days[dateKey];
    if (!windowDay?.editable || !windowDay.availableMealChoices.includes(choice)) return;
    const current = weekState[dateKey] || { active: false, mealChoice: 'REGULAR' as MealChoice };
    if (!current.active) {
      setDraftChoiceByDate((drafts) => ({ ...drafts, [dateKey]: choice }));
      setWeekState((states) => ({ ...states, [dateKey]: { active: false, mealChoice: 'REGULAR' } }));
      return;
    }
    void mutateRegistration(dateKey, true, choice);
  }, [mutateRegistration, weekState, windowSnapshot]);

  const todayKey = toDateKey(new Date());
  return (
    <PrototypeFrame bottomClearance={0}>
      <StateTransition
        stateKey={
          showLoading
            ? 'loading'
            : availabilityError && !windowSnapshot
              ? 'error'
              : 'ready'
        }
      >
        {showLoading ? (
          <BrandLoader label="Loading meal calendar…" />
        ) : availabilityError && !windowSnapshot ? (
          <Pressable accessibilityRole="button" onPress={() => void loadMonth()} style={styles.retry}>
            <Text style={styles.retryText}>{availabilityError}</Text>
            <Text style={styles.retryAction}>Retry</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.month}>{formatMonth(month)}</Text>
              <View style={styles.monthNav}>
                <Pressable accessibilityLabel="Previous month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={styles.monthButton}><ChevronLeft size={16} color={theme.colors.accentDeep} /></Pressable>
                <Pressable accessibilityLabel="Next month" onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={styles.monthButton}><ChevronRight size={16} color={theme.colors.accentDeep} /></Pressable>
              </View>
            </View>
            <PrototypeCard style={styles.calendarCard}>
              <View style={styles.weekdayRow}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <View key={day} style={styles.calendarColumn}><Text style={styles.weekday}>{day}</Text></View>)}</View>
              <View style={styles.dayGrid}>{monthRows.map((row, rowIndex) => <View key={`week-${rowIndex}`} style={styles.dayGridRow}>{row.map((day, columnIndex) => { if (!day) return <View key={`empty-${rowIndex}-${columnIndex}`} style={styles.calendarColumn} />; const key = toDateKey(day); const booked = monthRegistrations.has(key); const today = key === todayKey; return <View key={key} style={styles.calendarColumn}><View style={[styles.dayMarker, booked && styles.bookedDay, today && styles.todayDay]}><Text style={[styles.dayNumber, booked && styles.bookedText]}>{day.getDate()}</Text>{booked && <View style={styles.dot} />}</View></View>; })}</View>)}</View>
            </PrototypeCard>
            <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.swatch, styles.bookedSwatch]} /><Text style={styles.legendText}>Booked</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.todaySwatch]} /><Text style={styles.legendText}>Today</Text></View><View style={styles.legendItem}><View style={[styles.swatch, styles.availableSwatch]} /><Text style={styles.legendText}>Available</Text></View></View>
            <View style={styles.weekHeader}><PrototypeSectionTitle title="Weekly Meal Registration" subtitle={`${formatShortDate(weekStart)}–${formatShortDate(addDays(weekStart, 6))} · Toggle a day on to register lunch`} /></View>
            {Array.from({ length: 7 }, (_, index) => {
              const date = addDays(weekStart, index);
              const dateKey = toDateKey(date);
              const state = weekState[dateKey] || { active: false, mealChoice: 'REGULAR' as MealChoice };
              const windowDay = windowSnapshot?.days[dateKey];
              const active = state.active;
              const locked = windowDay?.editable !== true;
              const isSaving = savingDates.has(dateKey);
              const selectedChoice = active
                ? state.mealChoice
                : draftChoiceByDate[dateKey] || 'REGULAR';
              const choicesAvailable = windowDay?.availableMealChoices.includes('VEGETARIAN') === true;
              return (
                <View key={dateKey} style={[styles.weekRow, dateKey === todayKey && styles.todayRow]}>
                  <View style={styles.weekInfo}>
                    <View style={styles.weekDayLine}>
                      <Text style={styles.weekDay}>{formatDay(date)}</Text>
                      {dateKey === todayKey && <Pill><PillText>Today</PillText></Pill>}
                      {locked && <Pill tone="warn"><Text style={styles.lockedLabel}>Locked</Text></Pill>}
                      {windowDay?.lunarDay === 1 && (
                        <View style={styles.lunarBadge}>
                          <Leaf size={13} color={theme.colors.accentDeep} />
                          <Text style={styles.lunarBadgeText}>{CALENDAR_COPY.en.lunarDayOne}</Text>
                        </View>
                      )}
                      {windowDay?.lunarDay === 15 && (
                        <View style={styles.lunarBadge}>
                          <Leaf size={13} color={theme.colors.accentDeep} />
                          <Text style={styles.lunarBadgeText}>{CALENDAR_COPY.en.lunarDayFifteen}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.weekDate}>{formatShortDate(date)}</Text>
                  </View>
                  <View style={styles.weekControls}>
                    {choicesAvailable && (
                      <MealChoiceSelector
                        value={selectedChoice}
                        disabled={locked || isSaving}
                        onChange={(choice) => selectMealChoice(dateKey, choice)}
                      />
                    )}
                    <AnimatedMealToggle
                      value={active}
                      disabled={locked || isSaving}
                      saving={isSaving}
                      accessibilityLabel={`Toggle lunch registration for ${formatDay(date)}${locked ? ', locked after cutoff' : ''}`}
                      onPress={() => toggleRegistration(dateKey)}
                    />
                  </View>
                </View>
              );
            })}
          </>
        )}
      </StateTransition>
    </PrototypeFrame>
  );
}

type MealChoiceSelectorProps = {
  value: MealChoice;
  disabled: boolean;
  onChange: (choice: MealChoice) => void;
};

function MealChoiceSelector({ value, disabled, onChange }: MealChoiceSelectorProps) {
  const groupLabel = CALENDAR_COPY.en.mealChoiceGroup;
  return (
    <View style={styles.choiceSelectorWrap}>
      <Text
        accessible={true}
        accessibilityRole="text"
        accessibilityLabel={groupLabel}
        style={styles.choiceGroupLabel}
      >
        {groupLabel}
      </Text>
      <View style={styles.choiceSelector}>
        {(['REGULAR', 'VEGETARIAN'] as const).map((choice) => {
          const selected = value === choice;
          const label = CALENDAR_COPY.en.mealChoice[choice];
          return (
            <Pressable
              key={choice}
              accessibilityRole="radio"
              accessibilityLabel={`${groupLabel}: ${label}`}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(choice)}
              style={[styles.choiceOption, selected && styles.choiceOptionSelected, disabled && styles.choiceOptionDisabled]}
            >
              {selected && <Check size={14} color={theme.colors.accentDeep} strokeWidth={2.4} />}
              <Text style={[styles.choiceOptionText, selected && styles.choiceOptionTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AnimatedMealToggle({ value, disabled, saving, accessibilityLabel, onPress }: { value: boolean; disabled: boolean; saving: boolean; accessibilityLabel: string; onPress: () => void }) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    progress.stopAnimation();
    const toValue = value ? 1 : 0;
    if (reducedMotion) {
      progress.setValue(toValue);
      return () => {
        progress.stopAnimation();
      };
    }
    const animation = Animated.timing(progress, { toValue, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
    };
  }, [progress, reducedMotion, value]);
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={[styles.toggle, value && styles.toggleActive, saving && styles.toggleSaving]}><Animated.View style={[styles.toggleThumb, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} /></Pressable>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 },
  month: { color: theme.colors.fg, fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  monthNav: { flexDirection: 'row', gap: 8 },
  monthButton: { width: 36, height: 36, borderRadius: theme.radii.pill, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  calendarCard: { paddingHorizontal: 16, paddingVertical: 18, marginBottom: 20 },
  weekdayRow: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  calendarColumn: { flex: 1, minWidth: 0, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  weekday: { color: theme.colors.muted, fontFamily: theme.typography.fontMono, fontSize: 11, textAlign: 'center' },
  dayGrid: { gap: 4 },
  dayGridRow: { flexDirection: 'row', gap: 4 },
  dayMarker: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  bookedDay: { backgroundColor: theme.colors.accentSoft },
  todayDay: { borderWidth: 2, borderColor: theme.colors.accentDeep },
  dayNumber: { color: theme.colors.fg, fontSize: 14 },
  bookedText: { color: theme.colors.accentDeep, fontWeight: '700' },
  dot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentDeep, bottom: 4 },
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
  weekControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceSelectorWrap: { position: 'relative' },
  choiceGroupLabel: { position: 'absolute', width: 1, height: 1, opacity: 0.01 },
  choiceSelector: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, overflow: 'hidden' },
  choiceOption: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  choiceOptionSelected: { backgroundColor: theme.colors.accentTint },
  choiceOptionDisabled: { opacity: 0.5 },
  choiceOptionText: { color: theme.colors.muted, fontSize: 12 },
  choiceOptionTextSelected: { color: theme.colors.accentDeep, fontWeight: '700' },
  weekDayLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  weekDay: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  weekDate: { color: theme.colors.muted, fontSize: 13 },
  lockedLabel: { color: theme.colors.statusWarnDeep, fontSize: 12, fontWeight: '700' },
  lunarBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: theme.radii.pill, backgroundColor: theme.colors.accentTint },
  lunarBadgeText: { color: theme.colors.accentDeep, fontSize: 11, fontWeight: '600' },
  toggle: { width: 48, height: 28, padding: 3, justifyContent: 'center', borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  toggleActive: { backgroundColor: theme.colors.accentDeep },
  toggleSaving: { opacity: 0.5 },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
});
