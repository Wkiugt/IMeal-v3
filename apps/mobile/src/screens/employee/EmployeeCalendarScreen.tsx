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
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import {
  registrationAPI,
  type RegistrationRecord,
  type WeekRegistrationResponse,
} from '../../api/registrationAPI';
import {
  addDays,
  formatDay,
  formatMonth,
  formatShortDate,
  parseDateKey,
  startOfWeek,
  toDateKey,
} from '../../businessDate';
import { buildMonthRows } from './calendarGrid';
import {
  registrationDayIndexes,
  weekHeadingCopyStyle,
  weekHeadingRowStyle,
} from './calendarLayout';
import {
  CalendarMutationTracker,
  createWeekState,
  isDefaultNonServiceDate,
  getMutationPayload,
  reconcileWeekState,
  type DraftChoiceByDate,
  type MealChoice,
  type WeekState,
} from './calendarRegistrationState';
import {
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
import {
  getMobileErrorMessage,
  mobileErrorMessageKey,
  MobileApiError,
} from '../../api/mobileApiError';
import { designTokens } from '../../ui/designTokens';

type Props = AppTabScreenProps<'EmployeeCalendar'>;
type WindowDay = {
  cutoffAt: number;
  editable: boolean;
  lunarDay: number;
  availableMealChoices: readonly MealChoice[];
};
type WindowSnapshot = {
  serverNowAt: number;
  receiptAt: number;
  days: Record<string, WindowDay>;
};
type CalendarError =
  | { error: unknown; fallbackKey: 'errors.loadCalendar' }
  | { key: 'calendar.registrationUnavailable' };

function getWindowSnapshot(
  response: WeekRegistrationResponse,
  receiptAt: number,
): WindowSnapshot | null {
  const serverNowAt = Date.parse(response.registrationWindow?.serverNow || '');
  const days = response.registrationWindow?.days;
  if (
    !Number.isFinite(serverNowAt) ||
    !Array.isArray(days) ||
    days.length !== 7
  )
    return null;
  const parsedDays: Record<string, WindowDay> = {};
  for (const day of days) {
    const cutoffAt = Date.parse(day.cutoffAt);
    if (
      !day.mealDate ||
      !Number.isFinite(cutoffAt) ||
      typeof day.editable !== 'boolean' ||
      !day.lunarDate ||
      !Number.isInteger(day.lunarDate.day) ||
      !Array.isArray(day.availableMealChoices)
    )
      return null;
    parsedDays[day.mealDate] = {
      cutoffAt,
      editable: day.editable,
      lunarDay: day.lunarDate.day,
      availableMealChoices: day.availableMealChoices,
    };
  }
  return { serverNowAt, receiptAt, days: parsedDays };
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
  const [weekState, setWeekState] = useState<WeekState>({});
  const [draftChoiceByDate, setDraftChoiceByDate] = useState<DraftChoiceByDate>(
    {},
  );
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
  const hasInitialWeekResult =
    windowSnapshot !== null || availabilityError !== null;
  const initialWeekLoading = weekLoading && !hasInitialWeekResult;
  const screenLoading = useScreenLoadingGate(isFocused, !initialWeekLoading);
  const monthKey = toDateKey(month);
  const hasMonthData = monthDataKey === monthKey;
  const draftChoiceRef = useRef<DraftChoiceByDate>({});
  draftChoiceRef.current = draftChoiceByDate;
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const mutationTracker = useRef(new CalendarMutationTracker()).current;
  const cutoffWarnings = useRef(new Set<string>());
  const monthRequestId = useRef(0);
  const weekRequestId = useRef(0);

  useEffect(() => {
    const mealDate = route.params?.mealDate;
    if (!mealDate) return;
    const date = parseDateKey(mealDate);
    if (Number.isNaN(date.getTime())) {
      navigation.setParams({ mealDate: undefined });
      return;
    }
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setWeekStart(startOfWeek(date));
    navigation.setParams({ mealDate: undefined });
  }, [navigation, route.params?.mealDate]);

  const applyCurrentWeek = useCallback(
    (
      response: WeekRegistrationResponse,
      receiptAt: number,
      mutationIdsAtRequest: Readonly<Record<string, number>>,
      inFlightAtRequest: ReadonlySet<string>,
    ) => {
      const snapshot = getWindowSnapshot(response, receiptAt);
      if (!snapshot) {
        setAvailabilityError({ key: 'calendar.registrationUnavailable' });
        return false;
      }

      const serverState = createWeekState(response.registrations, weekStart);
      const shouldPreserveDate = (dateKey: string) =>
        (mutationIdsAtRequest[dateKey] ?? 0) !==
          mutationTracker.latestRequestId(dateKey) ||
        inFlightAtRequest.has(dateKey);
      const reconciledWeekState = reconcileWeekState(
        serverState,
        draftChoiceRef.current,
        response,
        weekStart,
      ).weekState;
      setWeekState((current) => {
        const reconciled = { ...reconciledWeekState };
        for (const dateKey of Object.keys(reconciledWeekState)) {
          if (shouldPreserveDate(dateKey) && current[dateKey])
            reconciled[dateKey] = current[dateKey];
        }
        return reconciled;
      });
      setDraftChoiceByDate((current) => {
        const reconciled = reconcileWeekState(
          serverState,
          current,
          response,
          weekStart,
        );
        const next = { ...reconciled.draftChoiceByDate };
        for (const dateKey of Object.keys(serverState)) {
          if (shouldPreserveDate(dateKey) && current[dateKey])
            next[dateKey] = current[dateKey];
        }
        return next;
      });
      setWindowSnapshot(snapshot);
      setAvailabilityError(null);
      return true;
    },
    [t, weekStart],
  );

  const refreshCurrentWeek = useCallback(async () => {
    if (!token) return;
    const requestId = ++weekRequestId.current;
    const mutationIdsAtRequest = mutationTracker.snapshotRequestIds();
    const inFlightAtRequest = mutationTracker.snapshotInFlight();
    setWeekLoading(true);
    try {
      const receiptAt = Date.now();
      const response = await registrationAPI.getWeek(
        toDateKey(weekStart),
        token,
      );
      if (requestId !== weekRequestId.current) return;
      if (
        !applyCurrentWeek(
          response,
          receiptAt,
          mutationIdsAtRequest,
          inFlightAtRequest,
        )
      ) {
        showNotice({
          title: t('calendar.registrationUnavailable'),
          message: t('calendar.registrationUnavailable'),
          tone: 'error',
        });
      }
    } catch (error: unknown) {
      if (requestId !== weekRequestId.current) return;
      const message = getMobileErrorMessage(error, t, 'errors.loadCalendar');
      setAvailabilityError({ error, fallbackKey: 'errors.loadCalendar' });
      showNotice({
        title: t('calendar.registrationUnavailable'),
        message,
        tone: 'error',
      });
    } finally {
      if (requestId === weekRequestId.current) setWeekLoading(false);
    }
  }, [applyCurrentWeek, showNotice, t, token, weekStart]);

  const loadMonth = useCallback(async () => {
    if (!token) return;
    const currentMonthRequestId = ++monthRequestId.current;
    const requestedMonthKey = toDateKey(month);
    setMonthLoading(true);
    setMonthError(null);
    setMonthDataKey(null);
    setMonthRegistrations(new Set());
    try {
      const firstWeek = startOfWeek(month);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const starts: string[] = [];
      for (
        let cursor = firstWeek;
        cursor <= lastDay;
        cursor = addDays(cursor, 7)
      )
        starts.push(toDateKey(cursor));
      const responses = await Promise.all(
        starts.map((startDate) => registrationAPI.getWeek(startDate, token)),
      );
      if (currentMonthRequestId !== monthRequestId.current) return;
      const registrations: RegistrationRecord[] = responses.flatMap(
        (response) => response.registrations,
      );
      setMonthRegistrations(
        new Set(
          registrations
            .filter((registration) => registration.status === 'ACTIVE')
            .map((registration) => registration.mealDate.slice(0, 10)),
        ),
      );
      setMonthDataKey(requestedMonthKey);
    } catch (error: unknown) {
      if (currentMonthRequestId !== monthRequestId.current) return;
      const message = getMobileErrorMessage(error, t, 'errors.loadCalendar');
      setMonthError({ error, fallbackKey: 'errors.loadCalendar' });
      showNotice({
        title: t('calendar.registrationUnavailable'),
        message,
        tone: 'error',
      });
    } finally {
      if (currentMonthRequestId === monthRequestId.current)
        setMonthLoading(false);
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
    if (!windowSnapshot) return;
    const futureDays = Object.values(windowSnapshot.days).filter(
      (day) => day.editable,
    );
    if (futureDays.length === 0) return;
    const nextCutoffAt = Math.min(...futureDays.map((day) => day.cutoffAt));
    const remaining =
      nextCutoffAt -
      windowSnapshot.serverNowAt -
      (Date.now() - windowSnapshot.receiptAt);
    const timer = setTimeout(
      () => {
        void refreshCurrentWeek();
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [refreshCurrentWeek, windowSnapshot]);

  const monthRows = useMemo(() => buildMonthRows(month), [month]);
  const handleCutoffFailure = useCallback(
    (
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
      setWindowSnapshot((current) =>
        current
          ? {
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
            }
          : current,
      );
      if (!cutoffWarnings.current.has(dateKey)) {
        cutoffWarnings.current.add(dateKey);
        showNotice({
          title: t('calendar.registrationLocked'),
          message: t('calendar.cutoffPassed'),
          tone: 'warning',
        });
      }
      void refreshCurrentWeek();
    },
    [refreshCurrentWeek, showNotice, t],
  );

  const mutateRegistration = useCallback(
    async (
      dateKey: string,
      nextActive: boolean,
      choiceOverride?: MealChoice,
    ) => {
      if (!token || mutationTracker.isInFlight(dateKey)) return;
      const windowDay = windowSnapshot?.days[dateKey];
      if (!windowDay?.editable) return;

      const previousState = weekState[dateKey] || {
        active: false,
        mealChoice: 'REGULAR' as MealChoice,
      };
      const previousDraft = draftChoiceByDate[dateKey];
      const payloadDrafts = choiceOverride
        ? { ...draftChoiceByDate, [dateKey]: choiceOverride }
        : draftChoiceByDate;
      const payload = getMutationPayload(
        dateKey,
        weekState,
        payloadDrafts,
        nextActive,
      );
      const nextChoice =
        payload.status === 'ACTIVE'
          ? payload.mealChoice
          : previousState.mealChoice;
      const nextState = {
        active: nextActive,
        mealChoice: nextActive ? nextChoice : ('REGULAR' as MealChoice),
      };
      const requestId = mutationTracker.begin(dateKey);
      if (requestId === null) return;
      setSavingDates((current) => new Set(current).add(dateKey));
      setWeekState((current) => ({ ...current, [dateKey]: nextState }));
      setDraftChoiceByDate((current) => {
        const next = { ...current };
        if (nextActive) delete next[dateKey];
        else if (
          nextChoice !== 'REGULAR' &&
          windowDay.availableMealChoices.includes(nextChoice)
        )
          next[dateKey] = nextChoice;
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
          const code =
            result && !result.success ? result.code : 'REGISTRATION_FAILED';
          if (code === 'CUTOFF_PASSED') {
            handleCutoffFailure(
              dateKey,
              previousState,
              previousDraft,
              requestId,
            );
          } else if (rollback()) {
            showNotice({
              title: t('calendar.registrationNotChanged'),
              message: t(mobileErrorMessageKey(code)),
              tone: 'error',
            });
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
        if (error instanceof MobileApiError && error.code === 'CUTOFF_PASSED') {
          handleCutoffFailure(dateKey, previousState, previousDraft, requestId);
        } else if (rollback()) {
          const message = getMobileErrorMessage(
            error,
            t,
            'errors.updateRegistration',
          );
          showNotice({
            title: t('calendar.registrationNotChanged'),
            message,
            tone: 'error',
          });
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
    },
    [
      draftChoiceByDate,
      handleCutoffFailure,
      showNotice,
      t,
      token,
      weekState,
      windowSnapshot,
    ],
  );

  const toggleRegistration = useCallback(
    (dateKey: string) => {
      const current = weekState[dateKey] || {
        active: false,
        mealChoice: 'REGULAR' as MealChoice,
      };
      void mutateRegistration(dateKey, !current.active);
    },
    [mutateRegistration, weekState],
  );

  const selectMealChoice = useCallback(
    (dateKey: string, choice: MealChoice) => {
      if (mutationTracker.isInFlight(dateKey)) return;
      const windowDay = windowSnapshot?.days[dateKey];
      if (
        !windowDay?.editable ||
        !windowDay.availableMealChoices.includes(choice)
      )
        return;
      const current = weekState[dateKey] || {
        active: false,
        mealChoice: 'REGULAR' as MealChoice,
      };
      if (!current.active) {
        setDraftChoiceByDate((drafts) => ({ ...drafts, [dateKey]: choice }));
        setWeekState((states) => ({
          ...states,
          [dateKey]: { active: false, mealChoice: 'REGULAR' },
        }));
        return;
      }
      void mutateRegistration(dateKey, true, choice);
    },
    [mutateRegistration, weekState, windowSnapshot],
  );

  const todayKey = toDateKey(new Date());
  const selectedCount = Object.values(weekState).filter(
    (day) => day.active,
  ).length;
  return (
    <AppFrame
      bottomClearance={114}
      screenLoadingLabel={screenLoading ? t('calendar.loading') : undefined}
    >
      <StateTransition
        stateKey={availabilityError && !windowSnapshot ? 'error' : 'ready'}
      >
        {availabilityError && !windowSnapshot ? (
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
            {monthLoading && !hasMonthData ? (
              <View style={styles.monthState}>
                <BrandLoader compact label={t('calendar.loading')} />
              </View>
            ) : monthError && !hasMonthData ? (
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
                    ).map((dayKey) => (
                      <View key={dayKey} style={styles.calendarColumn}>
                        <AppText
                          variant="caption"
                          tone="secondary"
                          style={styles.weekday}
                        >
                          {t(dayKey)}
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
                          const windowDay = windowSnapshot?.days[key];
                          const locked = windowDay?.editable === false;
                          const unavailable =
                            isDefaultNonServiceDate(key) ||
                            Boolean(
                              windowDay &&
                              windowDay.availableMealChoices.length === 0,
                            );
                          const visibleBooked = booked && !unavailable;
                          const markerLabel = [
                            unavailable
                              ? t('calendar.toggleUnavailableAccessibility', {
                                  day: formatDay(day, locale),
                                })
                              : visibleBooked
                                ? t('calendar.booked')
                                : t('calendar.available'),
                            today ? t('common.today') : undefined,
                            !unavailable && locked
                              ? t('common.locked')
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(', ');
                          return (
                            <View key={key} style={styles.calendarColumn}>
                              <View
                                accessible
                                accessibilityRole="text"
                                accessibilityLabel={markerLabel}
                                accessibilityState={
                                  today ? { selected: true } : undefined
                                }
                                style={[
                                  styles.dayMarker,
                                  visibleBooked && styles.bookedDay,
                                  unavailable && styles.unavailableDay,
                                  today && styles.todayDay,
                                ]}
                              >
                                <AppText
                                  variant="caption"
                                  tone={
                                    locked || unavailable
                                      ? 'neutral'
                                      : visibleBooked
                                        ? 'information'
                                        : 'strong'
                                  }
                                  style={[
                                    styles.dayNumber,
                                    locked &&
                                      !unavailable &&
                                      styles.lockedDayNumber,
                                  ]}
                                >
                                  {day.getDate()}
                                </AppText>
                                {visibleBooked && <View style={styles.dot} />}
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
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </Surface>
                <View style={styles.legend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.swatch, styles.bookedSwatch]} />
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.legendLabel}
                    >
                      {t('calendar.booked')}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.swatch, styles.todaySwatch]} />
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.legendLabel}
                    >
                      {t('common.today')}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.swatch, styles.availableSwatch]} />
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.legendLabel}
                    >
                      {t('calendar.available')}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.swatch, styles.lockedSwatch]}>
                      <LockKeyhole
                        size={12}
                        color={designTokens.color.disabled.text}
                        strokeWidth={2}
                      />
                    </View>
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.legendLabel}
                    >
                      {t('common.locked')}
                    </AppText>
                  </View>
                </View>
              </>
            )}
            <View style={styles.weekHeader}>
              <Divider />
              <View style={[styles.weekHeadingRow, weekHeadingRowStyle]}>
                <View style={weekHeadingCopyStyle}>
                  <SectionHeader
                    title={t('calendar.weeklyRegistration')}
                    subtitle={`${formatShortDate(weekStart, locale)}–${formatShortDate(addDays(weekStart, 6), locale)} · ${t('calendar.toggleHint')}`}
                  />
                </View>
                {windowSnapshot ? (
                  <StatusBadge
                    label={t('pickup.selectedCount', { count: selectedCount })}
                    tone="information"
                    icon={CalendarDays}
                  />
                ) : null}
              </View>
            </View>
            {registrationDayIndexes.map((index) => {
              const date = addDays(weekStart, index);
              const dateKey = toDateKey(date);
              const state = weekState[dateKey] || {
                active: false,
                mealChoice: 'REGULAR' as MealChoice,
              };
              const windowDay = windowSnapshot?.days[dateKey];
              const active = state.active;
              const locked = windowDay?.editable !== true;
              const isSaving = savingDates.has(dateKey);
              const availableChoices = windowDay?.availableMealChoices ?? [];
              const unavailable =
                isDefaultNonServiceDate(dateKey) ||
                Boolean(windowDay && availableChoices.length === 0);
              const selectedChoice = active
                ? state.mealChoice
                : draftChoiceByDate[dateKey] || 'REGULAR';
              const choiceLabel = t(
                selectedChoice === 'VEGETARIAN'
                  ? 'calendar.mealChoice.vegetarian'
                  : 'calendar.mealChoice.regular',
              );
              const rowChoiceLabel = unavailable ? undefined : choiceLabel;
              const isEligibleMealChoiceDay =
                !unavailable && availableChoices.includes('VEGETARIAN');
              const isToday = dateKey === todayKey;
              const lunarLabel =
                windowDay?.lunarDay === 1
                  ? t('calendar.lunarDayOne')
                  : windowDay?.lunarDay === 15
                    ? t('calendar.lunarDayFifteen')
                    : undefined;
              const rowState: MealSelectionCardState =
                unavailable || locked
                  ? 'disabled'
                  : isSaving
                    ? 'selected'
                    : active
                      ? 'selected'
                      : 'default';
              const rowDisabled = locked || unavailable;
              const toggleAccessibilityLabel = unavailable
                ? t('calendar.toggleUnavailableAccessibility', {
                    day: formatDay(date, locale),
                  })
                : t(
                    locked
                      ? 'calendar.toggleLockedAccessibility'
                      : active || isSaving
                        ? 'calendar.toggleEnabledAccessibility'
                        : 'calendar.toggleAccessibility',
                    { day: formatDay(date, locale) },
                  );
              const rowStatus =
                !unavailable && locked ? t('common.locked') : undefined;
              const rowTitle = isToday
                ? `${formatDay(date, locale)} · ${t('common.today')}`
                : formatDay(date, locale);
              const rowSubtitle = [
                formatShortDate(date, locale),
                rowChoiceLabel,
                rowStatus,
                lunarLabel,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <MealSelectionCard
                  key={dateKey}
                  variant="toggle-row"
                  title={rowTitle}
                  subtitle={rowSubtitle}
                  state={rowState}
                  saving={isSaving}
                  badges={
                    isEligibleMealChoiceDay ? (
                      <MealChoiceSelector
                        value={selectedChoice}
                        choices={availableChoices}
                        disabled={rowDisabled || isSaving}
                        onChange={(choice) => selectMealChoice(dateKey, choice)}
                      />
                    ) : undefined
                  }
                  accessibilityLabel={`${formatDay(date, locale)}, ${formatShortDate(date, locale)}${rowChoiceLabel ? `: ${rowChoiceLabel}` : ''}. ${toggleAccessibilityLabel}`}
                  onPress={
                    rowDisabled ? undefined : () => toggleRegistration(dateKey)
                  }
                  trailing={
                    <Toggle
                      value={active}
                      disabled={rowDisabled}
                      loading={isSaving}
                      label={toggleAccessibilityLabel}
                      showLabel={false}
                      onValueChange={(nextValue) => {
                        if (nextValue !== active) toggleRegistration(dateKey);
                      }}
                    />
                  }
                  style={styles.weekCard}
                />
              );
            })}
          </>
        )}
      </StateTransition>
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
  const groupLabel = t('calendar.mealChoiceGroup');
  return (
    <View style={styles.choiceSelectorWrap}>
      <AppText
        variant="caption"
        tone="tertiary"
        style={styles.choiceGroupLabel}
      >
        {groupLabel}
      </AppText>
      <View style={styles.choiceSelector}>
        {choices.map((choice) => {
          const selected = value === choice;
          const label = t(
            choice === 'REGULAR'
              ? 'calendar.mealChoice.regular'
              : 'calendar.mealChoice.vegetarian',
          );
          return (
            <MealTypeChip
              key={choice}
              type={choice}
              selected={selected}
              disabled={disabled}
              onPress={() => onChange(choice)}
              accessibilityLabel={`${groupLabel}: ${label}`}
              style={styles.choiceOption}
            />
          );
        })}
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
  monthNav: {
    flexDirection: 'row',
    gap: designTokens.space.sm,
  },
  monthButton: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.brand.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retrySurface: {
    marginBottom: designTokens.space.md,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  retryText: {
    flex: 1,
  },
  monthState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: designTokens.space.lg,
  },
  calendarSurface: {
    marginBottom: designTokens.space.md,
  },
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
  weekday: {
    textAlign: 'center',
  },
  dayGrid: {
    gap: designTokens.space.xs,
  },
  dayGridRow: {
    flexDirection: 'row',
    gap: designTokens.space.xs,
  },
  dayMarker: {
    width: designTokens.size.controlSm,
    height: designTokens.size.controlSm,
    borderRadius: designTokens.size.controlSm / 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bookedDay: {
    backgroundColor: designTokens.color.brand.soft,
  },
  unavailableDay: {
    backgroundColor: designTokens.color.semantic.neutral.tint,
  },
  todayDay: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  dayNumber: {
    textAlign: 'center',
  },
  lockedDayNumber: {
    color: designTokens.color.disabled.text,
  },
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
    gap: designTokens.space.sm,
    paddingHorizontal: designTokens.space.xs,
    paddingTop: designTokens.space.md,
  },
  legendItem: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 132,
    minHeight: designTokens.size.controlSm,
    paddingHorizontal: designTokens.space.sm,
    paddingVertical: designTokens.space.xs,
    borderRadius: designTokens.radius.smallControl,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.border.subtle.color,
    backgroundColor: designTokens.color.surface.elevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  legendLabel: {
    flex: 1,
  },
  swatch: {
    width: designTokens.space.md,
    height: designTokens.space.md,
    borderRadius: designTokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookedSwatch: {
    backgroundColor: designTokens.color.brand.soft,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  todaySwatch: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  availableSwatch: {
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    backgroundColor: designTokens.color.surface.standard,
  },
  lockedSwatch: {
    backgroundColor: designTokens.color.disabled.fill,
    borderWidth: designTokens.border.disabled.width,
    borderColor: designTokens.color.border.disabled,
  },
  weekHeader: {
    marginTop: designTokens.space.xl,
    marginBottom: designTokens.space.md,
  },
  weekHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
    paddingTop: designTokens.space.lg,
  },
  weekCard: {
    marginBottom: designTokens.space.xs,
  },
  choiceSelectorWrap: {
    gap: designTokens.space.xs,
  },
  choiceGroupLabel: {
    marginBottom: designTokens.space.xs,
  },
  choiceSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.xs,
  },
  choiceOption: {
    flexGrow: 1,
  },
});
