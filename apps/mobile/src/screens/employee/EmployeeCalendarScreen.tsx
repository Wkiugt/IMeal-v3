import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  XCircle,
} from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { v1 } from '@imeal/contracts';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import {
  registrationAPI,
  type WeekRegistrationResponse,
} from '../../api/registrationAPI';
import {
  addDays,
  formatBusinessInstant,
  formatDay,
  formatMonth,
  formatShortDate,
  parseDateKey,
  startOfWeek,
  toBusinessDateKey,
  toDateKey,
} from '../../businessDate';
import { buildMonthRows } from './calendarGrid';
import { weekHeadingCopyStyle, weekHeadingRowStyle } from './calendarLayout';
import {
  CalendarBatchTracker,
  buildDirtyBatchPayload,
  createDraftState,
  getDirtyDates,
  getDirtyDatesForWeek,
  isDateSelectable,
  isDateSelectAllEligible,
  mergeAuthoritativeWeek,
  reconcileBatchResults,
  selectAllEligible,
  setDraftDay,
  type CalendarDayState,
  type CalendarDraftState,
  type CalendarServerState,
  type MealChoice,
} from './calendarRegistrationState';
import {
  ActionButton,
  AppText,
  Divider,
  MealSelectionCard,
  MealTypeChip,
  StatusBadge,
  Surface,
  Toggle,
} from '../../ui/components';
import type { MealSelectionCardState } from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import type { TranslationKey } from '../../i18n/translations';
import { ProfileLogoutModal } from '../profile/ProfileComposition';
import { designTokens } from '../../ui/designTokens';

type Props = AppTabScreenProps<'EmployeeCalendar'>;
type CalendarDay = v1.WeekRegistrationDay;
type WindowSnapshot = {
  serverNowAt: number;
  receiptAt: number;
  days: Record<string, CalendarDay>;
};
type CalendarError =
  | { error: unknown; fallbackKey: 'errors.loadCalendar' }
  | { key: 'calendar.registrationUnavailable' };

const EMPTY_DAY_STATE: CalendarDayState = {
  active: false,
  mealChoice: 'REGULAR',
};

function getWindowSnapshot(
  response: WeekRegistrationResponse,
  receiptAt: number,
): WindowSnapshot | null {
  const serverNowAt = Date.parse(response.registrationWindow.serverNow);
  if (!Number.isFinite(serverNowAt) || response.days.length !== 7) return null;
  const days: Record<string, CalendarDay> = {};
  for (const day of response.days) {
    if (!Number.isFinite(Date.parse(day.cutoffAt))) return null;
    days[day.mealDate] = day;
  }
  return { serverNowAt, receiptAt, days };
}

function createServerState(days: readonly CalendarDay[]): CalendarServerState {
  const state: Record<string, CalendarDayState> = {};
  for (const day of days) {
    state[day.mealDate] = {
      active: day.registration?.status === 'ACTIVE',
      mealChoice: day.registration?.mealChoice ?? 'REGULAR',
    };
  }
  return state;
}

function reasonKey(
  reason: v1.RegistrationDayUnavailableReason,
): TranslationKey {
  switch (reason) {
    case 'HOLIDAY':
      return 'calendar.reasonHoliday';
    case 'DISABLED':
      return 'calendar.reasonDisabled';
    case 'NO_PUBLISHED_MENU':
      return 'calendar.reasonNoPublishedMenu';
    case 'LOCATION_UNAVAILABLE':
      return 'calendar.reasonLocationUnavailable';
    case 'LOCATION_AMBIGUOUS':
      return 'calendar.reasonLocationAmbiguous';
    case 'CUTOFF_PASSED':
      return 'calendar.reasonCutoffPassed';
    case 'REGISTRATION_FINALIZED':
      return 'calendar.reasonFinalized';
    case 'ALREADY_ACTIVE':
      return 'calendar.reasonAlreadyActive';
    case 'NOT_ACTIVE':
      return 'calendar.reasonNotActive';
    case 'NO_ALTERNATIVE_MEAL_CHOICE':
      return 'calendar.reasonNoAlternativeMealChoice';
  }
}

function getDayReason(
  day: CalendarDay,
  serverDay: CalendarDayState,
  draftDay: CalendarDayState,
): v1.RegistrationDayUnavailableReason | null {
  const reasons = serverDay.active
    ? draftDay.active
      ? day.unavailableReasons.changeMealChoice
      : day.unavailableReasons.cancel
    : day.unavailableReasons.activate;
  return reasons[0] ?? null;
}

function failureKey(code: v1.RegistrationFailureCode): TranslationKey {
  switch (code) {
    case 'CUTOFF_PASSED':
      return 'calendar.reasonCutoffPassed';
    case 'MEAL_CHOICE_UNAVAILABLE':
      return 'calendar.reasonNoAlternativeMealChoice';
    case 'REGISTRATION_FINALIZED':
      return 'calendar.reasonFinalized';
    case 'INVALID_MEAL_DATE':
      return 'calendar.reasonInvalidDate';
    case 'REGISTRATION_FAILED':
      return 'calendar.reasonRegistrationFailed';
  }
}
function isBeforeCutoff(day: CalendarDay, nowAt: number): boolean {
  const cutoffAt = Date.parse(day.cutoffAt);
  return Number.isFinite(cutoffAt) && nowAt < cutoffAt;
}
export function EmployeeCalendarScreen({ navigation, route }: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [serverState, setServerState] = useState<CalendarServerState>({});
  const [draftState, setDraftState] = useState<CalendarDraftState>({});
  const [dayByDate, setDayByDate] = useState<Record<string, CalendarDay>>({});
  const [monthRegistrations, setMonthRegistrations] = useState<Set<string>>(
    new Set(),
  );
  const [monthDataKey, setMonthDataKey] = useState<string | null>(null);
  const [windowSnapshot, setWindowSnapshot] = useState<WindowSnapshot | null>(
    null,
  );
  const [availabilityError, setAvailabilityError] =
    useState<CalendarError | null>(null);
  const [monthError, setMonthError] = useState<CalendarError | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const [provisionalDates, setProvisionalDates] = useState<Set<string>>(
    new Set(),
  );
  const [refreshIssue, setRefreshIssue] = useState(false);
  const [delegationWarning, setDelegationWarning] = useState<{
    dateKey: string;
    delegateName: string;
  } | null>(null);
  const [weekDiscardWarning, setWeekDiscardWarning] = useState<Date | null>(
    null,
  );
  const serverStateRef = useRef<CalendarServerState>({});
  const draftStateRef = useRef<CalendarDraftState>({});
  const savingRef = useRef(false);
  const tracker = useRef(new CalendarBatchTracker()).current;
  const monthRequestId = useRef(0);
  const weekRequestId = useRef(0);
  const alignedWeekRef = useRef(false);
  serverStateRef.current = serverState;
  draftStateRef.current = draftState;
  const pendingRouteWeekRef = useRef<Date | null>(null);
  const resetWeekState = useCallback(
    (nextWeekStart: Date) => {
      if (toDateKey(nextWeekStart) === toDateKey(weekStart)) return;
      weekRequestId.current += 1;
      tracker.beginLoad();
      serverStateRef.current = {};
      draftStateRef.current = {};
      setServerState({});
      setDraftState({});
      setDayByDate({});
      setWindowSnapshot(null);
      setAvailabilityError(null);
      setProvisionalDates(new Set());
      setWeekLoading(true);
      setWeekStart(nextWeekStart);
      alignedWeekRef.current = true;
    },
    [tracker, weekStart],
  );

  useEffect(() => {
    if (savingRef.current) return;
    const mealDate = route.params?.mealDate;
    if (!mealDate) return;
    const date = parseDateKey(mealDate);
    if (Number.isNaN(date.getTime())) {
      navigation.setParams({ mealDate: undefined });
      return;
    }
    const nextWeekStart = startOfWeek(date);
    const sameWeek = toDateKey(nextWeekStart) === toDateKey(weekStart);
    if (!sameWeek) {
      const hasDirtyCurrentWeek = getDirtyDates(
        serverStateRef.current,
        draftStateRef.current,
      ).some((dateKey) => dayByDate[dateKey] !== undefined);
      if (hasDirtyCurrentWeek) {
        pendingRouteWeekRef.current = nextWeekStart;
        setWeekDiscardWarning(nextWeekStart);
      } else {
        resetWeekState(nextWeekStart);
      }
    }
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    navigation.setParams({ mealDate: undefined });
  }, [
    dayByDate,
    navigation,
    resetWeekState,
    route.params?.mealDate,
    saving,
    weekStart,
  ]);

  const applyCurrentWeek = useCallback(
    (response: WeekRegistrationResponse, receiptAt: number) => {
      const snapshot = getWindowSnapshot(response, receiptAt);
      if (!snapshot) {
        setAvailabilityError({ key: 'calendar.registrationUnavailable' });
        return false;
      }
      const nextServerState = createServerState(response.days);
      const merged = mergeAuthoritativeWeek(
        nextServerState,
        serverStateRef.current,
        draftStateRef.current,
      );
      const nextDraftState = merged.draftState;
      serverStateRef.current = nextServerState;
      draftStateRef.current = nextDraftState;
      setServerState(nextServerState);
      setDraftState(nextDraftState);
      setDayByDate(snapshot.days);
      setWindowSnapshot(snapshot);
      setAvailabilityError(null);
      setRefreshIssue(false);
      setProvisionalDates(new Set());
      return true;
    },
    [],
  );

  const refreshCurrentWeek = useCallback(
    async (allowDuringSave = false): Promise<boolean> => {
      if (!token || (savingRef.current && !allowDuringSave)) return false;
      const requestId = ++weekRequestId.current;
      const loadId = tracker.beginLoad();
      setWeekLoading(true);
      try {
        const response = await registrationAPI.getWeek(
          toDateKey(weekStart),
          token,
        );
        const receiptAt = Date.now();
        if (
          requestId !== weekRequestId.current ||
          !tracker.isCurrentLoad(loadId)
        )
          return false;
        const serverDate = toBusinessDateKey(
          response.registrationWindow.serverNow,
        );
        const serverWeekStart = toDateKey(
          startOfWeek(parseDateKey(serverDate)),
        );
        if (
          !alignedWeekRef.current &&
          serverWeekStart !== toDateKey(weekStart)
        ) {
          alignedWeekRef.current = true;
          setWeekStart(parseDateKey(serverWeekStart));
          return true;
        }
        alignedWeekRef.current = true;
        return applyCurrentWeek(response, receiptAt);
      } catch (error: unknown) {
        if (
          requestId !== weekRequestId.current ||
          !tracker.isCurrentLoad(loadId)
        )
          return false;
        const message = getMobileErrorMessage(error, t, 'errors.loadCalendar');
        setAvailabilityError(
          (current) => current ?? { error, fallbackKey: 'errors.loadCalendar' },
        );
        setRefreshIssue(true);
        showNotice({
          title: t('calendar.registrationUnavailable'),
          message,
          tone: 'error',
        });
        return false;
      } finally {
        if (requestId === weekRequestId.current) setWeekLoading(false);
      }
    },
    [applyCurrentWeek, showNotice, t, token, tracker, weekStart],
  );

  const loadMonth = useCallback(async () => {
    if (!token) return;
    const requestId = ++monthRequestId.current;
    const requestedMonthKey = toDateKey(month);
    setMonthLoading(true);
    setMonthError(null);
    try {
      const firstWeek = startOfWeek(month);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const starts: string[] = [];
      for (
        let cursor = firstWeek;
        cursor <= lastDay;
        cursor = addDays(cursor, 7)
      ) {
        starts.push(toDateKey(cursor));
      }
      const responses = await Promise.all(
        starts.map((startDate) => registrationAPI.getWeek(startDate, token)),
      );
      if (requestId !== monthRequestId.current) return;
      const dates = responses.flatMap((response) =>
        response.days
          .filter((day) => day.registration?.status === 'ACTIVE')
          .map((day) => day.mealDate),
      );
      setMonthRegistrations(new Set(dates));
      setMonthDataKey(requestedMonthKey);
    } catch (error: unknown) {
      if (requestId !== monthRequestId.current) return;
      const message = getMobileErrorMessage(error, t, 'errors.loadCalendar');
      setMonthError({ error, fallbackKey: 'errors.loadCalendar' });
      showNotice({
        title: t('calendar.registrationUnavailable'),
        message,
        tone: 'error',
      });
    } finally {
      if (requestId === monthRequestId.current) setMonthLoading(false);
    }
  }, [month, showNotice, t, token]);

  useEffect(() => {
    void loadMonth();
    return () => {
      monthRequestId.current += 1;
    };
  }, [loadMonth]);

  useFocusEffect(
    useCallback(() => {
      void refreshCurrentWeek();
      return () => {
        weekRequestId.current += 1;
      };
    }, [refreshCurrentWeek]),
  );

  useEffect(() => {
    if (!windowSnapshot || !isFocused || saving || weekLoading) return;
    const estimatedServerNow =
      windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt);
    const cutoffTimes = Object.values(windowSnapshot.days)
      .filter(
        (day) => day.canActivate || day.canCancel || day.canChangeMealChoice,
      )
      .map((day) => Date.parse(day.cutoffAt))
      .filter((value) => Number.isFinite(value) && value > estimatedServerNow);
    if (cutoffTimes.length === 0) return;
    const remaining = Math.min(...cutoffTimes) - estimatedServerNow;
    const timer = setTimeout(
      () => {
        if (!savingRef.current) void refreshCurrentWeek();
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [isFocused, refreshCurrentWeek, saving, weekLoading, windowSnapshot]);

  const dirtyDates = useMemo(
    () => getDirtyDates(serverState, draftState),
    [draftState, serverState],
  );
  const currentWeekDirtyDates = useMemo(
    () => dirtyDates.filter((dateKey) => dayByDate[dateKey] !== undefined),
    [dayByDate, dirtyDates],
  );
  const nowAt = windowSnapshot
    ? windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt)
    : Date.now();
  const monthRows = useMemo(() => buildMonthRows(month), [month]);
  const hasMonthData = monthDataKey === toDateKey(month);
  const hasInitialWeekResult = Object.keys(dayByDate).length > 0;
  const initialWeekLoading = weekLoading && !hasInitialWeekResult;
  const initialWeekError = availabilityError !== null && !hasInitialWeekResult;
  const screenLoadingGate = useScreenLoadingGate(
    isFocused,
    !initialWeekLoading,
  );
  const screenLoading = !initialWeekError && screenLoadingGate;
  const todayKey = windowSnapshot
    ? toBusinessDateKey(new Date(windowSnapshot.serverNowAt).toISOString())
    : toBusinessDateKey(new Date().toISOString());
  const presentationState = useMemo(
    () => ({ ...serverState, ...draftState }),
    [draftState, serverState],
  );
  const selectedCount = Object.values(presentationState).filter(
    (day) => day.active,
  ).length;
  const hasSelectableDay = Object.entries(dayByDate).some(([dateKey, day]) =>
    isDateSelectAllEligible(serverState[dateKey], day, nowAt),
  );

  const updateDraftDay = useCallback(
    (dateKey: string, nextDay: CalendarDayState) => {
      const nextDraft = setDraftDay(draftStateRef.current, dateKey, nextDay);
      draftStateRef.current = nextDraft;
      setDraftState(nextDraft);
    },
    [],
  );

  const navigateToWeek = useCallback(
    (nextWeekStart: Date) => {
      if (
        savingRef.current ||
        toDateKey(nextWeekStart) === toDateKey(weekStart)
      )
        return;
      if (currentWeekDirtyDates.length > 0) {
        setWeekDiscardWarning(nextWeekStart);
        return;
      }
      resetWeekState(nextWeekStart);
    },
    [currentWeekDirtyDates, resetWeekState, weekStart],
  );

  const confirmWeekDiscard = useCallback(() => {
    const nextWeekStart = pendingRouteWeekRef.current ?? weekDiscardWarning;
    if (!nextWeekStart || savingRef.current) return;
    pendingRouteWeekRef.current = null;
    setWeekDiscardWarning(null);
    resetWeekState(nextWeekStart);
  }, [resetWeekState, weekDiscardWarning]);

  const toggleRegistration = useCallback(
    (dateKey: string) => {
      if (savingRef.current) return;
      const day = dayByDate[dateKey];
      if (!day) return;
      const serverDay = serverStateRef.current[dateKey] ?? EMPTY_DAY_STATE;
      const currentDay = draftStateRef.current[dateKey] ?? serverDay;
      const nextActive = !currentDay.active;
      const estimatedNowAt = windowSnapshot
        ? windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt)
        : Date.now();
      const allowed =
        isBeforeCutoff(day, estimatedNowAt) &&
        (serverDay.active ? day.canCancel : day.canActivate);
      if (!allowed) return;
      const apply = () =>
        updateDraftDay(dateKey, { ...currentDay, active: nextActive });
      const delegation = day.delegation;
      if (
        serverDay.active &&
        currentDay.active &&
        !nextActive &&
        delegation &&
        (delegation.status === 'PENDING' || delegation.status === 'ACCEPTED')
      ) {
        setDelegationWarning({
          dateKey,
          delegateName:
            delegation.delegateName || t('calendar.unknownDelegate'),
        });
        return;
      }
      apply();
    },
    [dayByDate, t, updateDraftDay, windowSnapshot],
  );

  const confirmDelegationCancel = useCallback(() => {
    const warning = delegationWarning;
    if (!warning || savingRef.current) return;
    const day = dayByDate[warning.dateKey];
    const serverDay =
      serverStateRef.current[warning.dateKey] ?? EMPTY_DAY_STATE;
    const currentDay = draftStateRef.current[warning.dateKey] ?? serverDay;
    const estimatedNowAt = windowSnapshot
      ? windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt)
      : Date.now();
    if (
      day &&
      serverDay.active &&
      currentDay.active &&
      day.canCancel &&
      isBeforeCutoff(day, estimatedNowAt)
    ) {
      updateDraftDay(warning.dateKey, { ...currentDay, active: false });
    }
    setDelegationWarning(null);
  }, [dayByDate, delegationWarning, updateDraftDay, windowSnapshot]);

  const selectMealChoice = useCallback(
    (dateKey: string, choice: MealChoice) => {
      if (savingRef.current) return;
      const day = dayByDate[dateKey];
      if (!day || !day.availableMealChoices.includes(choice)) return;
      const serverDay = serverStateRef.current[dateKey] ?? EMPTY_DAY_STATE;
      const currentDay = draftStateRef.current[dateKey] ?? serverDay;
      const estimatedNowAt = windowSnapshot
        ? windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt)
        : Date.now();
      const canChange =
        (!currentDay.active && isDateSelectable(day, estimatedNowAt)) ||
        (currentDay.active &&
          (!serverDay.active
            ? isDateSelectable(day, estimatedNowAt)
            : day.canChangeMealChoice && isBeforeCutoff(day, estimatedNowAt)));
      if (!canChange) return;
      updateDraftDay(dateKey, {
        active: currentDay.active,
        mealChoice: choice,
      });
    },
    [dayByDate, updateDraftDay, windowSnapshot],
  );

  const selectAll = useCallback(() => {
    if (savingRef.current || !windowSnapshot) return;
    const nextDraft = selectAllEligible(
      serverStateRef.current,
      draftStateRef.current,
      dayByDate,
      windowSnapshot.serverNowAt + (Date.now() - windowSnapshot.receiptAt),
    );
    draftStateRef.current = nextDraft;
    setDraftState(nextDraft);
  }, [dayByDate, windowSnapshot]);

  const saveWeek = useCallback(async () => {
    if (!token || savingRef.current) return;
    const currentServer = serverStateRef.current;
    const currentDraft = draftStateRef.current;
    const dates = getDirtyDatesForWeek(
      currentServer,
      currentDraft,
      Object.keys(dayByDate),
    );
    if (dates.length === 0) return;
    const payload = buildDirtyBatchPayload(currentServer, currentDraft, dates);
    if (payload.length === 0) return;
    const requestId = tracker.begin();
    if (requestId === null) return;
    const submittedDraft: CalendarDraftState = Object.fromEntries(
      dates.map((dateKey) => [
        dateKey,
        { ...(currentDraft[dateKey] ?? EMPTY_DAY_STATE) },
      ]),
    );
    tracker.beginLoad();
    weekRequestId.current += 1;
    setWeekLoading(false);
    savingRef.current = true;
    setSaving(true);
    setSavingDates(new Set(dates));
    setRefreshIssue(false);
    try {
      const results = await registrationAPI.batchRegister(payload, token);
      if (!tracker.isCurrent(requestId)) return;
      const submittedDates = new Set(dates);
      const scopedResults = results.filter((result) =>
        submittedDates.has(result.date),
      );
      const reconciled = reconcileBatchResults(
        currentServer,
        currentDraft,
        submittedDraft,
        scopedResults,
      );
      serverStateRef.current = reconciled.serverState;
      draftStateRef.current = reconciled.draftState;
      setServerState(reconciled.serverState);
      setDraftState(reconciled.draftState);
      setProvisionalDates(new Set(reconciled.provisionalDates));
      const resultDates = new Set(scopedResults.map((result) => result.date));
      const missingDates = dates.filter((dateKey) => !resultDates.has(dateKey));
      const failures = [
        ...scopedResults.filter(
          (
            result,
          ): result is Extract<
            v1.BatchRegistrationResult,
            { success: false }
          > => !result.success,
        ),
        ...missingDates.map((date) => ({
          date,
          success: false as const,
          code: 'REGISTRATION_FAILED' as const,
          reason: 'No result was returned for this submitted date.',
        })),
      ];
      const successCount = dates.filter((dateKey) =>
        scopedResults.some(
          (result) => result.date === dateKey && result.success,
        ),
      ).length;
      if (failures.length > 0) {
        const failureDetails = failures
          .map(
            (failure) =>
              `${formatDay(parseDateKey(failure.date), locale)}: ${t(failureKey(failure.code))}`,
          )
          .join(' · ');
        showNotice({
          title: t('calendar.registrationNotChanged'),
          message: `${t('calendar.savePartial', {
            saved: successCount,
            failed: failures.length,
          })} ${failureDetails}`,
          tone: 'warning',
        });
      } else if (successCount > 0) {
        showNotice({
          title: t('calendar.saveComplete'),
          message: t('calendar.saveSuccess', { saved: successCount }),
          tone: 'success',
        });
      }
      const refreshed = await refreshCurrentWeek(true);
      if (!refreshed) setRefreshIssue(true);
    } catch (error: unknown) {
      if (!tracker.isCurrent(requestId)) return;
      showNotice({
        title: t('calendar.registrationNotChanged'),
        message: getMobileErrorMessage(error, t, 'errors.updateRegistration'),
        tone: 'error',
      });
    } finally {
      if (tracker.finish(requestId)) {
        savingRef.current = false;
        setSaving(false);
        setSavingDates(new Set());
      }
    }
  }, [dayByDate, locale, refreshCurrentWeek, showNotice, t, token, tracker]);

  const monthKey = toDateKey(month);
  return (
    <AppFrame
      bottomClearance={170}
      screenLoadingLabel={screenLoading ? t('calendar.loading') : undefined}
    >
      <StateTransition
        stateKey={
          availabilityError && !hasInitialWeekResult ? 'error' : 'ready'
        }
      >
        {availabilityError && !hasInitialWeekResult ? (
          <Surface level={1} padding="lg" style={styles.retrySurface}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              onPress={() => void refreshCurrentWeek()}
              style={styles.retry}
            >
              <AppText
                variant="supporting"
                tone="critical"
                style={styles.retryText}
              >
                {'key' in availabilityError
                  ? t(availabilityError.key)
                  : getMobileErrorMessage(
                      availabilityError.error,
                      t,
                      availabilityError.fallbackKey,
                    )}
              </AppText>
              <AppText variant="buttonLabel" tone="critical">
                {t('common.retry')}
              </AppText>
            </Pressable>
          </Surface>
        ) : (
          <>
            <View
              style={[styles.header, compactLayout && styles.headerCompact]}
            >
              <AppText variant="sectionTitle">
                {formatMonth(month, locale)}
              </AppText>
              <View style={styles.monthNav}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('calendar.previousMonth')}
                  disabled={saving}
                  onPress={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() - 1,
                          1,
                        ),
                    )
                  }
                  style={styles.monthButton}
                >
                  <ChevronLeft
                    size={18}
                    color={designTokens.color.brand.primary}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('calendar.nextMonth')}
                  disabled={saving}
                  onPress={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() + 1,
                          1,
                        ),
                    )
                  }
                  style={styles.monthButton}
                >
                  <ChevronRight
                    size={18}
                    color={designTokens.color.brand.primary}
                  />
                </Pressable>
              </View>
            </View>
            {monthLoading && monthDataKey !== monthKey ? (
              <View style={styles.monthState}>
                <BrandLoader compact label={t('calendar.loading')} />
              </View>
            ) : monthError && monthDataKey !== monthKey ? (
              <Surface level={1} padding="lg" style={styles.monthState}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.retry')}
                  onPress={() => void loadMonth()}
                  style={styles.retry}
                >
                  <AppText
                    variant="supporting"
                    tone="critical"
                    style={styles.retryText}
                  >
                    {'key' in monthError
                      ? t(monthError.key)
                      : getMobileErrorMessage(
                          monthError.error,
                          t,
                          monthError.fallbackKey,
                        )}
                  </AppText>
                  <AppText variant="buttonLabel" tone="critical">
                    {t('common.retry')}
                  </AppText>
                </Pressable>
              </Surface>
            ) : (
              <>
                <Surface level={1} padding="lg" style={styles.calendarSurface}>
                  <View style={styles.weekdayRow}>
                    {(
                      [
                        'calendar.weekday.mo',
                        'calendar.weekday.tu',
                        'calendar.weekday.we',
                        'calendar.weekday.th',
                        'calendar.weekday.fr',
                        'calendar.weekday.sa',
                        'calendar.weekday.su',
                      ] as const
                    ).map((key) => (
                      <View key={key} style={styles.calendarColumn}>
                        <AppText
                          variant="caption"
                          tone="secondary"
                          style={styles.weekday}
                        >
                          {t(key)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                  <View style={styles.dayGrid}>
                    {monthRows.map((row, rowIndex) => (
                      <View key={`week-${rowIndex}`} style={styles.dayGridRow}>
                        {row.map((day, columnIndex) => {
                          if (!day)
                            return (
                              <View
                                key={`empty-${rowIndex}-${columnIndex}`}
                                style={styles.calendarColumn}
                              />
                            );
                          const key = toDateKey(day);
                          const booked = monthRegistrations.has(key);
                          const today = key === todayKey;
                          const unavailable =
                            dayByDate[key]?.menu?.isHoliday ||
                            dayByDate[key]?.menu?.isEnabled === false;
                          const markerLabel = [
                            unavailable
                              ? t('calendar.dayUnavailable')
                              : booked
                                ? t('calendar.booked')
                                : t('calendar.available'),
                            today ? t('common.today') : undefined,
                          ]
                            .filter(Boolean)
                            .join(', ');
                          return (
                            <Pressable
                              key={key}
                              style={styles.calendarColumn}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={markerLabel}
                              disabled={saving}
                              onPress={() => {
                                navigateToWeek(startOfWeek(day));
                              }}
                            >
                              <View
                                style={[
                                  styles.dayMarker,
                                  booked && styles.bookedDay,
                                  unavailable && styles.unavailableDay,
                                  today && styles.todayDay,
                                ]}
                              >
                                <AppText
                                  variant="caption"
                                  tone={
                                    unavailable
                                      ? 'neutral'
                                      : booked
                                        ? 'information'
                                        : 'strong'
                                  }
                                  style={styles.dayNumber}
                                >
                                  {day.getDate()}
                                </AppText>
                                {booked && <View style={styles.dot} />}
                                {unavailable ? (
                                  <XCircle
                                    size={11}
                                    color={
                                      designTokens.color.semantic.neutral.base
                                    }
                                    style={styles.dayStateIcon}
                                  />
                                ) : null}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </Surface>
                <View style={styles.legend}>
                  <AppText variant="caption" tone="secondary">
                    {t('calendar.booked')}
                  </AppText>
                  <AppText variant="caption" tone="secondary">
                    {t('calendar.dayUnavailable')}
                  </AppText>
                  <AppText variant="caption" tone="secondary">
                    {t('common.today')}
                  </AppText>
                </View>
              </>
            )}
            <View style={styles.weekHeader}>
              <Divider />
              <View style={weekHeadingRowStyle}>
                <View style={weekHeadingCopyStyle}>
                  <SectionHeader
                    title={t('calendar.weeklyRegistration')}
                    subtitle={`${formatShortDate(weekStart, locale)}–${formatShortDate(addDays(weekStart, 6), locale)} · ${t('calendar.toggleHint')}`}
                  />
                </View>
                <View style={styles.weekNav}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('calendar.previousWeek')}
                    disabled={saving}
                    onPress={() => navigateToWeek(addDays(weekStart, -7))}
                    style={styles.monthButton}
                  >
                    <ChevronLeft
                      size={18}
                      color={designTokens.color.brand.primary}
                    />
                  </Pressable>
                  <StatusBadge
                    label={t('pickup.selectedCount', { count: selectedCount })}
                    tone="information"
                    icon={CalendarDays}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('calendar.nextWeek')}
                    disabled={saving}
                    onPress={() => navigateToWeek(addDays(weekStart, 7))}
                    style={styles.monthButton}
                  >
                    <ChevronRight
                      size={18}
                      color={designTokens.color.brand.primary}
                    />
                  </Pressable>
                </View>
              </View>
            </View>
            {Object.keys(dayByDate)
              .sort()
              .map((dateKey) => {
                const day = dayByDate[dateKey];
                const serverDay = serverState[dateKey] ?? EMPTY_DAY_STATE;
                const state = draftState[dateKey] ?? serverDay;
                const isSaving = savingDates.has(dateKey);
                const nextActive = !state.active;
                const toggleEnabled =
                  isBeforeCutoff(day, nowAt) &&
                  (serverDay.active ? day.canCancel : day.canActivate);
                const availableChoices = day.availableMealChoices;
                const selectedChoice = state.mealChoice;
                const choiceCanChange =
                  (!state.active && isDateSelectable(day, nowAt)) ||
                  (state.active &&
                    (!serverDay.active
                      ? isDateSelectable(day, nowAt)
                      : day.canChangeMealChoice && isBeforeCutoff(day, nowAt)));
                const reason = getDayReason(day, serverDay, state);
                const reasonText = reason ? t(reasonKey(reason)) : undefined;
                const menuTitle =
                  day.menu?.mealName ?? t('calendar.menuUnavailable');
                const menuDescription = day.menu?.description ?? undefined;
                const locationLabel =
                  day.location?.displayName ??
                  t('calendar.locationUnavailable');
                const lunarLabel = (() => {
                  const base =
                    day.lunarDate.day === 1
                      ? t('calendar.lunarDayOne')
                      : day.lunarDate.day === 15
                        ? t('calendar.lunarDayFifteen')
                        : undefined;
                  return base && day.lunarDate.isLeapMonth
                    ? `${base} · ${t('calendar.lunarLeapMonth')}`
                    : base;
                })();
                const cutoffLabel = t('calendar.cutoffAt', {
                  time: formatBusinessInstant(day.cutoffAt, locale),
                });
                const choiceLabel = t(
                  selectedChoice === 'VEGETARIAN'
                    ? 'calendar.mealChoice.vegetarian'
                    : 'calendar.mealChoice.regular',
                );
                const rowSubtitle = [
                  menuTitle,
                  menuDescription,
                  locationLabel,
                  lunarLabel,
                  choiceLabel,
                  cutoffLabel,
                  reasonText,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const rowState: MealSelectionCardState =
                  !toggleEnabled && !state.active
                    ? 'disabled'
                    : state.active
                      ? 'selected'
                      : 'default';
                const parsedDate = parseDateKey(dateKey);
                const rowTitle =
                  dateKey === todayKey
                    ? `${formatDay(parsedDate, locale)} · ${formatShortDate(parsedDate, locale)} · ${t('common.today')}`
                    : `${formatDay(parsedDate, locale)} · ${formatShortDate(parsedDate, locale)}`;
                return (
                  <MealSelectionCard
                    key={dateKey}
                    variant="toggle-row"
                    title={rowTitle}
                    subtitle={rowSubtitle}
                    state={rowState}
                    saving={isSaving}
                    badges={
                      availableChoices.length > 1 ? (
                        <MealChoiceSelector
                          value={selectedChoice}
                          choices={availableChoices}
                          disabled={saving || !choiceCanChange}
                          onChange={(choice) =>
                            selectMealChoice(dateKey, choice)
                          }
                        />
                      ) : undefined
                    }
                    accessibilityLabel={`${rowTitle}: ${rowSubtitle}`}
                    onPress={
                      toggleEnabled && !saving
                        ? () => toggleRegistration(dateKey)
                        : undefined
                    }
                    trailing={
                      <Toggle
                        value={state.active}
                        disabled={!toggleEnabled || saving}
                        loading={isSaving}
                        label={t(
                          state.active
                            ? 'calendar.toggleEnabledAccessibility'
                            : 'calendar.toggleAccessibility',
                          { day: rowTitle },
                        )}
                        showLabel={false}
                        onValueChange={(nextValue) => {
                          if (nextValue !== state.active)
                            toggleRegistration(dateKey);
                        }}
                      />
                    }
                    style={styles.weekCard}
                  />
                );
              })}
            {refreshIssue || provisionalDates.size > 0 ? (
              <Surface level={1} padding="md" style={styles.refreshNotice}>
                <AppText variant="supporting" tone="warning">
                  {t('calendar.refreshPending')}
                </AppText>
                <ActionButton
                  variant="secondary"
                  size="md"
                  label={t('common.retry')}
                  disabled={saving}
                  onPress={() => void refreshCurrentWeek(true)}
                />
              </Surface>
            ) : null}
            <View style={styles.footerActions}>
              <ActionButton
                variant="secondary"
                size="md"
                label={t('calendar.selectWholeWeek')}
                disabled={saving || !hasSelectableDay}
                onPress={selectAll}
                style={styles.footerButton}
              />
              <ActionButton
                variant="primary"
                size="md"
                label={t('calendar.saveChanges')}
                disabled={saving || dirtyDates.length === 0}
                loading={saving}
                onPress={() => void saveWeek()}
                style={styles.footerButton}
              />
            </View>
          </>
        )}
      </StateTransition>
      <ProfileLogoutModal
        visible={delegationWarning !== null}
        title={t('calendar.cancelDelegationTitle')}
        message={t('calendar.cancelDelegationMessage', {
          delegate:
            delegationWarning?.delegateName ?? t('calendar.unknownDelegate'),
        })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.confirm')}
        processingLabel={t('common.processing')}
        processing={false}
        onClose={() => setDelegationWarning(null)}
        onConfirm={confirmDelegationCancel}
      />
      <ProfileLogoutModal
        visible={weekDiscardWarning !== null}
        title={t('calendar.discardWeekTitle')}
        message={t('calendar.discardWeekMessage')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.confirm')}
        processingLabel={t('common.processing')}
        processing={false}
        onClose={() => {
          pendingRouteWeekRef.current = null;
          setWeekDiscardWarning(null);
        }}
        onConfirm={confirmWeekDiscard}
      />
    </AppFrame>
  );
}

type MealChoiceSelectorProps = {
  value: MealChoice;
  choices: readonly MealChoice[];
  disabled: boolean;
  onChange: (choice: MealChoice) => void;
};

function MealChoiceSelector({
  value,
  choices,
  disabled,
  onChange,
}: MealChoiceSelectorProps) {
  const { t } = useLanguage();
  return (
    <View style={styles.choiceSelectorWrap}>
      <AppText
        variant="caption"
        tone="tertiary"
        style={styles.choiceGroupLabel}
      >
        {t('calendar.mealChoiceGroup')}
      </AppText>
      <View style={styles.choiceSelector}>
        {choices.map((choice) => (
          <MealTypeChip
            key={choice}
            type={choice}
            selected={value === choice}
            disabled={disabled}
            onPress={() => onChange(choice)}
            accessibilityLabel={`${t('calendar.mealChoiceGroup')}: ${t(choice === 'REGULAR' ? 'calendar.mealChoice.regular' : 'calendar.mealChoice.vegetarian')}`}
            style={styles.choiceOption}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: designTokens.space.lg,
    paddingBottom: designTokens.space.xl,
  },
  headerCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: designTokens.space.sm,
  },
  monthNav: { flexDirection: 'row', gap: designTokens.space.sm },
  monthButton: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.brand.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retrySurface: { marginBottom: designTokens.space.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  retryText: { flex: 1 },
  monthState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: designTokens.space.lg,
  },
  calendarSurface: { marginBottom: designTokens.space.md },
  weekdayRow: {
    flexDirection: 'row',
    gap: designTokens.space.xs,
    marginBottom: designTokens.space.sm,
  },
  calendarColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: designTokens.size.controlSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekday: { textAlign: 'center' },
  dayGrid: { gap: designTokens.space.xs },
  dayGridRow: { flexDirection: 'row', gap: designTokens.space.xs },
  dayMarker: {
    width: designTokens.size.controlSm,
    height: designTokens.size.controlSm,
    borderRadius: designTokens.size.controlSm / 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bookedDay: { backgroundColor: designTokens.color.brand.soft },
  unavailableDay: { backgroundColor: designTokens.color.semantic.neutral.tint },
  todayDay: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  dayNumber: { textAlign: 'center' },
  dot: {
    position: 'absolute',
    width: designTokens.space.xs,
    height: designTokens.space.xs,
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.brand.primary,
    bottom: designTokens.space.xs,
  },
  dayStateIcon: {
    position: 'absolute',
    top: designTokens.space.xs,
    right: designTokens.space.xs,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.md,
    paddingHorizontal: designTokens.space.xs,
    paddingTop: designTokens.space.md,
  },
  weekHeader: {
    marginTop: designTokens.space.xl,
    marginBottom: designTokens.space.md,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  weekCard: { marginBottom: designTokens.space.xs },
  choiceSelectorWrap: { gap: designTokens.space.xs },
  choiceGroupLabel: { marginBottom: designTokens.space.xs },
  choiceSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.xs,
  },
  choiceOption: { flexGrow: 1 },
  refreshNotice: { marginTop: designTokens.space.md },
  footerActions: {
    gap: designTokens.space.sm,
    paddingTop: designTokens.space.lg,
    paddingBottom: designTokens.space['2xl'],
  },
  footerButton: { alignSelf: 'stretch' },
});
