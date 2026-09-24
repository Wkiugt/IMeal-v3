import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Utensils, XCircle } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { pickupAPI, type PickupOption } from '../../api/pickupAPI';
import {
  isLocationCaptureCancelled,
  locationAPI,
  type LocationCapture,
} from '../../api/locationAPI';
import {
  getMobileErrorMessage,
  MobileApiError,
} from '../../api/mobileApiError';
import { formatShortDate, parseDateKey } from '../../businessDate';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  EmptyState,
  MealSelectionCard,
  QrTicket,
  StatusBadge,
  Surface,
} from '../../ui/components';
import type { QrTicketState } from '../../ui/components';
import { designTokens } from '../../ui/designTokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import {
  canStartQrGeneration,
  getInitialSelection,
  getPresentableQrValue,
  getSelectionAfterEligibilityRefresh,
  isCurrentCapture,
  isGpsRecoveryError,
  sortRegistrationIds,
} from './pickupIntentRules';
export {
  canStartQrGeneration,
  getInitialSelection,
  getPresentableQrValue,
  getSelectionAfterEligibilityRefresh,
  isCurrentCapture,
  isGpsRecoveryError,
  sortRegistrationIds,
} from './pickupIntentRules';

type Props = AppTabScreenProps<'PickupIntent'>;
type PickupLoadError =
  | { type: 'window-closed' }
  | { type: 'not-ready'; error: unknown }
  | { type: 'error'; error: unknown };

type QrState = {
  value: string;
  expiresAt: number;
  ttlSeconds: number;
  selectionKey: string;
};

const DEFAULT_QR_TTL_SECONDS = 5;
const QR_REFRESH_LEAD_MS = designTokens.motion.duration.fast;

function selectionKey(ids: readonly string[]): string {
  return ids.join('\u0000');
}

export function PickupIntentScreen(_props: Props) {
  const { token, profile } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<PickupLoadError | null>(null);
  const [options, setOptions] = useState<PickupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [qrError, setQrError] = useState<unknown | null>(null);
  const [qrRetryVersion, setQrRetryVersion] = useState(0);
  const optionsRequestId = useRef(0);
  const optionsLoadedRef = useRef(false);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const isFocused = useIsFocused();
  const generationRef = useRef(0);
  const qrState = useRef<QrState | null>(null);
  const locationCapture = useRef<LocationCapture | null>(null);
  const screenLoading = useScreenLoadingGate(isFocused, !loading);

  const stopLocationCapture = useCallback(
    (expectedCapture?: LocationCapture) => {
      const currentCapture = locationCapture.current;
      if (
        !currentCapture ||
        (expectedCapture && !isCurrentCapture(currentCapture, expectedCapture))
      ) {
        return;
      }
      currentCapture.stop();
      locationCapture.current = null;
    },
    [],
  );

  const clearQrPresentation = useCallback(() => {
    stopLocationCapture();
    qrState.current = null;
    setQrValue(null);
    setTimeLeft(0);
    setQrLoading(false);
  }, [stopLocationCapture]);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const fetchOptions = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    const requestId = ++optionsRequestId.current;
    setLoadError(null);
    setLoading(true);
    try {
      const response = await pickupAPI.getPickupOptions(token);
      if (requestId !== optionsRequestId.current) return false;
      const nextSelection = getSelectionAfterEligibilityRefresh(
        response.options,
        [...selectedIdsRef.current],
        optionsLoadedRef.current,
      );
      optionsLoadedRef.current = true;
      selectedIdsRef.current = new Set(nextSelection);
      setOptions(response.options);
      setSelectedIds(new Set(nextSelection));
      if (!canStartQrGeneration(nextSelection)) setIsGenerating(false);
      clearQrPresentation();
      setQrError(null);
      return true;
    } catch (error: unknown) {
      if (requestId !== optionsRequestId.current) return false;
      clearQrPresentation();
      setIsGenerating(false);
      if (
        error instanceof MobileApiError &&
        error.code === 'PICKUP_WINDOW_CLOSED'
      ) {
        setLoadError({ type: 'window-closed' });
      } else {
        setLoadError({
          type:
            error instanceof MobileApiError && error.code === 'PICKUP_NOT_READY'
              ? 'not-ready'
              : 'error',
          error,
        });
      }
      return false;
    } finally {
      if (requestId === optionsRequestId.current) setLoading(false);
    }
  }, [clearQrPresentation, token]);

  useFocusEffect(
    useCallback(() => {
      void fetchOptions();
      return () => {
        optionsRequestId.current += 1;
        clearQrPresentation();
      };
    }, [clearQrPresentation, fetchOptions]),
  );

  const selectedIdsList = sortRegistrationIds(Array.from(selectedIds));
  const selectedSelectionKey = selectionKey(selectedIdsList);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;
    let ownCapture: LocationCapture | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let countdownTimer: ReturnType<typeof setInterval> | undefined;

    const isActive = () => !cancelled && generationRef.current === generation;
    const clearTimers = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (countdownTimer) clearInterval(countdownTimer);
    };
    const cleanup = () => {
      cancelled = true;
      clearTimers();
      if (generationRef.current === generation) generationRef.current += 1;
      if (ownCapture) stopLocationCapture(ownCapture);
    };

    if (!isFocused || !isGenerating || !token || loading) {
      if (!isFocused || !isGenerating || loading) stopLocationCapture();
      return cleanup;
    }
    if (!canStartQrGeneration(selectedIdsList)) {
      clearQrPresentation();
      setIsGenerating(false);
      return cleanup;
    }

    const scheduleTimers = (remainingMs: number, refresh: () => void) => {
      clearTimers();
      setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      refreshTimer = setTimeout(
        refresh,
        Math.max(0, remainingMs - QR_REFRESH_LEAD_MS),
      );
      countdownTimer = setInterval(
        () => setTimeLeft((current) => Math.max(0, current - 1)),
        1000,
      );
    };

    const refresh = async () => {
      if (!isActive()) return;
      const ids = selectedIdsList;
      if (!canStartQrGeneration(ids)) {
        setIsGenerating(false);
        return;
      }
      let capture: LocationCapture | null = null;
      try {
        clearQrPresentation();
        if (!isActive()) return;
        setQrLoading(true);
        capture = locationAPI.startForegroundLocationCapture();
        ownCapture = capture;
        locationCapture.current = capture;
        const presenterEvidence = await capture.promise;
        if (!isActive()) return;
        const response = await pickupAPI.generateQr(token, {
          registrationIds: ids,
          presenterEvidence,
        });
        if (!isActive()) return;
        const ttlSeconds =
          response.ttl > 0 ? response.ttl : DEFAULT_QR_TTL_SECONDS;
        const ttlMs = ttlSeconds * 1000;
        qrState.current = {
          value: response.qr,
          expiresAt: Date.now() + ttlMs,
          ttlSeconds,
          selectionKey: selectedSelectionKey,
        };
        setQrError(null);
        setQrValue(response.qr);
        scheduleTimers(ttlMs, () => void refresh());
      } catch (error: unknown) {
        if (!isActive() || isLocationCaptureCancelled(error)) return;
        clearQrPresentation();
        setQrError(error);
        setIsGenerating(false);
        showNotice({
          title: t('pickup.qrUnavailable'),
          message: getMobileErrorMessage(error, t, 'errors.generateQr'),
          tone: 'error',
        });
      } finally {
        if (capture) stopLocationCapture(capture);
        if (ownCapture === capture) ownCapture = null;
        if (isActive()) setQrLoading(false);
      }
    };

    const existingQr = qrState.current;
    const remainingMs = existingQr ? existingQr.expiresAt - Date.now() : 0;
    if (
      existingQr &&
      existingQr.selectionKey === selectedSelectionKey &&
      remainingMs > 0
    ) {
      scheduleTimers(remainingMs, () => void refresh());
    } else {
      setQrError(null);
      void refresh();
    }

    return cleanup;
  }, [
    clearQrPresentation,
    generationRef,
    isFocused,
    isGenerating,
    loading,
    selectedIdsList.join('\u0000'),
    selectedSelectionKey,
    showNotice,
    stopLocationCapture,
    t,
    token,
    qrRetryVersion,
  ]);

  const toggleSelection = (registrationId: string) => {
    clearQrPresentation();
    setQrError(null);
    setIsGenerating(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(registrationId)) next.delete(registrationId);
      else next.add(registrationId);
      return next;
    });
  };

  const retryQr = useCallback(() => {
    if (selectedIdsList.length === 0) return;
    clearQrPresentation();
    setQrError(null);
    setQrRetryVersion((current) => current + 1);
    setIsGenerating(true);
  }, [clearQrPresentation, selectedIdsList.join('\u0000')]);

  const refreshOptions = useCallback(async () => {
    setIsGenerating(false);
    clearQrPresentation();
    setQrError(null);
    const refreshed = await fetchOptions();
    if (refreshed && canStartQrGeneration([...selectedIdsRef.current])) {
      setQrRetryVersion((current) => current + 1);
      setIsGenerating(true);
    } else {
      setIsGenerating(false);
    }
  }, [clearQrPresentation, fetchOptions]);

  const toggleGenerating = useCallback(() => {
    if (isGenerating) {
      setIsGenerating(false);
      clearQrPresentation();
      return;
    }
    if (selectedIdsList.length === 0) {
      showNotice({
        title: t('pickup.selectionRequired'),
        message: t('pickup.selectExplicitForMultiple'),
        tone: 'error',
      });
      return;
    }
    clearQrPresentation();
    setQrError(null);
    setIsGenerating(true);
  }, [
    clearQrPresentation,
    isGenerating,
    selectedIdsList.join('\u0000'),
    showNotice,
    stopLocationCapture,
    t,
  ]);

  useEffect(() => () => stopLocationCapture(), [stopLocationCapture]);

  const displayName =
    profile?.name ||
    profile?.email.split('@')[0] ||
    t('profile.employeeAccount');
  const errorState = loadError?.type;
  const currentQr = qrState.current;
  const qrExpired = currentQr !== null && currentQr.expiresAt <= Date.now();
  const visibleQrValue = getPresentableQrValue(
    currentQr,
    qrValue,
    selectedSelectionKey,
    isFocused,
    Boolean(qrError),
  );
  const qrTicketState: QrTicketState =
    qrError || qrExpired
      ? 'expired'
      : !isGenerating
        ? 'paused'
        : visibleQrValue
          ? qrLoading
            ? 'refreshing'
            : 'active'
          : 'loading';
  const selectedMealTypeLabels = Array.from(
    new Set(
      options
        .filter((option) => selectedIds.has(option.registrationId))
        .map((option) =>
          t(
            option.mealChoice === 'VEGETARIAN'
              ? 'calendar.mealChoice.vegetarian'
              : 'calendar.mealChoice.regular',
          ),
        ),
    ),
  );
  const mealTypeLabel =
    selectedMealTypeLabels.length > 0
      ? selectedMealTypeLabels.join(', ')
      : t('pickup.mealChoice');
  const qrTotalSeconds = currentQr?.ttlSeconds ?? DEFAULT_QR_TTL_SECONDS;
  const ownerId = profile?.userId || profile?.id || '—';
  const gpsRecovery = isGpsRecoveryError(qrError);

  return (
    <AppFrame
      screenLoadingLabel={screenLoading ? t('pickup.loading') : undefined}
    >
      <SectionHeader
        title={t('pickup.title')}
        subtitle={t('pickup.subtitle')}
      />
      <StateTransition
        stateKey={errorState || (options.length === 0 ? 'empty' : 'ready')}
      >
        {loadError?.type === 'window-closed' ? (
          <EmptyState
            icon={Clock3}
            title={t('pickup.windowClosed')}
            description={t('pickup.windowClosedHint')}
            style={styles.emptyState}
          />
        ) : loadError?.type === 'not-ready' ? (
          <EmptyState
            icon={Clock3}
            title={t('pickup.notReady')}
            description={getMobileErrorMessage(
              loadError.error,
              t,
              'errors.loadPickup',
            )}
            action={{
              label: t('pickup.checkAgain'),
              onPress: () => void fetchOptions(),
            }}
            style={styles.emptyState}
          />
        ) : loadError?.type === 'error' ? (
          <EmptyState
            icon={XCircle}
            title={t('pickup.loadFailed')}
            description={getMobileErrorMessage(
              loadError.error,
              t,
              'errors.loadPickup',
            )}
            action={{
              label: t('common.retry'),
              onPress: () => void fetchOptions(),
            }}
            style={styles.emptyState}
          />
        ) : options.length === 0 ? (
          <EmptyState
            icon={Utensils}
            title={t('pickup.noMeals')}
            description={t('pickup.noMealsHint')}
            style={styles.emptyState}
          />
        ) : (
          <>
            <Surface level={1} padding="xl" style={styles.selectionSurface}>
              <View
                style={[
                  styles.selectionHeader,
                  compactLayout && styles.selectionHeaderCompact,
                ]}
              >
                <View style={styles.selectionCopy}>
                  <AppText variant="eyebrow" tone="secondary">
                    {t('pickup.mealsToPickUp')}
                  </AppText>
                  <AppText variant="supporting" tone="secondary">
                    {options.length > 1
                      ? t('pickup.selectExplicitForMultiple')
                      : t('pickup.selectOneOrMore')}
                  </AppText>
                </View>
                <StatusBadge
                  label={t('pickup.selectedCount', { count: selectedIds.size })}
                  tone="information"
                  icon={CheckCircle2}
                />
              </View>
              <View style={styles.optionList}>
                {options.map((option) => {
                  const selected = selectedIds.has(option.registrationId);
                  const optionTitle =
                    option.type === 'OWN'
                      ? t('pickup.myMeal')
                      : t('pickup.delegatedMeal');
                  const choiceLabel = t(
                    option.mealChoice === 'VEGETARIAN'
                      ? 'calendar.mealChoice.vegetarian'
                      : 'calendar.mealChoice.regular',
                  );
                  const dateLabel = formatShortDate(
                    parseDateKey(option.mealDate),
                    locale,
                  );
                  const ownerLabel =
                    option.type === 'DELEGATED' && option.owner
                      ? ` · ${t('pickup.from', { name: option.owner.name })}`
                      : '';
                  return (
                    <MealSelectionCard
                      key={option.registrationId}
                      title={optionTitle}
                      subtitle={`${dateLabel}${ownerLabel}`}
                      mealType={option.mealChoice}
                      state={selected ? 'selected' : 'default'}
                      onPress={() => toggleSelection(option.registrationId)}
                      accessibilityLabel={`${optionTitle}, ${choiceLabel}, ${dateLabel}${ownerLabel}`}
                    />
                  );
                })}
              </View>
              <AppText
                variant="caption"
                tone="secondary"
                style={styles.gpsPurpose}
              >
                {t('pickup.gpsPurpose')}
              </AppText>
            </Surface>
            <QrTicket
              state={qrTicketState}
              value={visibleQrValue ?? undefined}
              ownerName={displayName}
              ownerId={ownerId}
              mealLabel={t('pickup.lunch')}
              mealTypeLabel={mealTypeLabel}
              selectedCount={selectedIds.size}
              secondsRemaining={timeLeft}
              totalSeconds={qrTotalSeconds}
              onRetry={retryQr}
              onToggleActive={toggleGenerating}
              style={styles.ticket}
            />
            {gpsRecovery && qrError && (
              <Surface level={1} padding="lg" style={styles.gpsRecovery}>
                <AppText variant="supporting" tone="critical">
                  {getMobileErrorMessage(qrError, t, 'errors.generateQr')}
                </AppText>
                <AppText
                  variant="caption"
                  tone="secondary"
                  style={styles.gpsRetention}
                >
                  {t('pickup.gpsRetention')}
                </AppText>
                <View style={styles.recoveryActions}>
                  <ActionButton
                    variant="secondary"
                    size="md"
                    label={t('pickup.refreshOptions')}
                    onPress={() => void refreshOptions()}
                  />
                </View>
              </Surface>
            )}
          </>
        )}
      </StateTransition>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    marginTop: designTokens.space.xl,
  },
  selectionSurface: {
    marginTop: designTokens.space.xl,
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  selectionHeaderCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  selectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: designTokens.space.xs,
  },
  optionList: {
    marginTop: designTokens.space.md,
    gap: designTokens.space.sm,
  },
  gpsPurpose: {
    marginTop: designTokens.space.lg,
  },
  ticket: {
    marginTop: designTokens.space.lg,
  },
  gpsRecovery: {
    marginTop: designTokens.space.md,
  },
  gpsRetention: {
    marginTop: designTokens.space.xs,
  },
  recoveryActions: {
    marginTop: designTokens.space.md,
    alignItems: 'flex-start',
  },
});
