import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Check, Clock3, Square } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import {
  pickupAPI,
  type PickupOption,
} from '../../api/pickupAPI';
import { getMobileErrorMessage, MobileApiError } from '../../api/mobileApiError';
import { formatShortDate, initials, parseDateKey } from '../../businessDate';
import {
  Avatar,
  Eyebrow,
  Pill,
  PillText,
  PrototypeButton,
  PrototypeCard,
} from '../../ui/PrototypePrimitives';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useInitialLoadingGate } from '../../ui/useInitialLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { theme } from '../../theme';
import { useLanguage } from '../../i18n/LanguageProvider';

type Props = AppTabScreenProps<'PickupIntent'>;
type PickupLoadError =
  | { type: 'window-closed' }
  | { type: 'not-ready'; error: unknown }
  | { type: 'error'; error: unknown };
export function PickupIntentScreen(_props: Props) {
  const { token, profile } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<PickupLoadError | null>(null);
  const [options, setOptions] = useState<PickupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const optionsRequestId = useRef(0);
  const isFocused = useIsFocused();
  const qrState = useRef<{ value: string; expiresAt: number; ttlMs: number } | null>(null);
  const initialGate = useInitialLoadingGate(loading, Boolean(loadError));
  const showLoading = initialGate || (loading && options.length === 0);

  const fetchOptions = useCallback(async () => {
    if (!token) return;
    const requestId = ++optionsRequestId.current;
    setLoadError(null);
    setLoading(true);
    try {
      const response = await pickupAPI.getPickupOptions(token);
      if (requestId !== optionsRequestId.current) return;
      setOptions(response.options);
      setSelectedIds((current) =>
        current.size > 0
          ? new Set(
              [...current].filter((id) =>
                response.options.some((option) => option.registrationId === id),
              ),
            )
          : new Set(
              response.options[0] ? [response.options[0].registrationId] : [],
            ),
      );
    } catch (error: unknown) {
      if (requestId !== optionsRequestId.current) return;
      if (error instanceof MobileApiError && error.code === 'PICKUP_WINDOW_CLOSED') {
        setLoadError({ type: 'window-closed' });
      } else {
        setLoadError({
          type: error instanceof MobileApiError && error.code === 'PICKUP_NOT_READY' ? 'not-ready' : 'error',
          error,
        });
      }
    } finally {
      if (requestId === optionsRequestId.current) setLoading(false);
    }
  }, [t, token]);

  useFocusEffect(
    useCallback(() => {
      void fetchOptions();
      return () => {
        optionsRequestId.current += 1;
      };
    }, [fetchOptions]),
  );

  useEffect(() => {
    if (!isFocused || !isGenerating || !token) {
      if (!isFocused && isGenerating && token) {
        setQrLoading(false);
        return;
      }
      qrState.current = null;
      setQrValue(null);
      setTimeLeft(0);
      setQrLoading(false);
      return;
    }
    if (loading) {
      setQrLoading(false);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let countdownTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleTimers = (remainingMs: number, totalMs: number, refresh: () => void) => {
      setTimeLeft(Math.ceil(remainingMs / 1000));
      progressAnim.setValue(remainingMs / totalMs);
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: remainingMs,
        useNativeDriver: false,
      }).start();
      refreshTimer = setTimeout(refresh, remainingMs);
      countdownTimer = setInterval(
        () => setTimeLeft((current) => Math.max(0, current - 1)),
        1000,
      );
    };
    const refresh = async () => {
      if (cancelled) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        setIsGenerating(false);
        return;
      }
      try {
        setQrLoading(true);
        const response = await pickupAPI.generateQr(token, ids);
        if (cancelled) return;
        const ttl = response.ttl > 0 ? response.ttl : 5;
        const ttlMs = ttl * 1000;
        qrState.current = {
          value: response.qr,
          expiresAt: Date.now() + ttlMs,
          ttlMs,
        };
        setQrValue(response.qr);
        scheduleTimers(ttlMs, ttlMs, () => void refresh());
      } catch (error: unknown) {
        if (!cancelled) {
          showNotice({
            title: t('pickup.qrUnavailable'),
            message: getMobileErrorMessage(error, t, 'errors.generateQr'),
            tone: 'error',
          });
        }
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    };
    const existingQr = qrState.current;
    const remainingMs = existingQr ? existingQr.expiresAt - Date.now() : 0;
    if (existingQr && remainingMs > 0 && selectedIds.size > 0) {
      scheduleTimers(remainingMs, existingQr.ttlMs, () => void refresh());
    } else {
      qrState.current = null;
      setQrValue(null);
      setTimeLeft(0);
      void refresh();
    }
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      clearInterval(countdownTimer);
      progressAnim.stopAnimation();
    };
  }, [isFocused, isGenerating, loading, progressAnim, selectedIds, showNotice, t, token]);

  const toggleSelection = (registrationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(registrationId)) next.delete(registrationId);
      else next.add(registrationId);
      return next;
    });
  };

  const displayName = profile?.name || profile?.email.split('@')[0] || t('profile.employeeAccount');
  const errorState = loadError?.type;
  const visibleQrValue =
    isFocused && qrState.current?.value === qrValue && qrState.current.expiresAt > Date.now()
      ? qrValue
      : null;

  return (
    <PrototypeFrame>
      <PrototypeSectionTitle
        title={t('pickup.title')}
        subtitle={t('pickup.subtitle')}
      />
      <StateTransition
        stateKey={
          showLoading
            ? 'loading'
            : errorState || (options.length === 0 ? 'empty' : 'ready')
        }
      >
        {showLoading ? (
          <BrandLoader label={t('pickup.loading')} />
        ) : loadError?.type === 'window-closed' ? (
          <PrototypeCard style={styles.emptyCard}>
            <View style={styles.errorHeader}>
              <Clock3 size={22} color={theme.colors.accentDeep} />
              <Text style={styles.emptyTitle}>{t('pickup.windowClosed')}</Text>
            </View>
            <Text style={styles.emptyText}>
              {t('pickup.windowClosedHint')}
            </Text>
          </PrototypeCard>
        ) : loadError?.type === 'not-ready' ? (
          <PrototypeCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('pickup.notReady')}</Text>
            <Text style={styles.emptyText}>{getMobileErrorMessage(loadError.error, t, 'errors.loadPickup')}</Text>
            <PrototypeButton
              variant="secondary"
              onPress={() => void fetchOptions()}
              style={styles.retryButton}
            >
              {t('pickup.checkAgain')}
            </PrototypeButton>
          </PrototypeCard>
        ) : loadError?.type === 'error' ? (
          <PrototypeCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('pickup.loadFailed')}</Text>
            <Text style={styles.emptyText}>{getMobileErrorMessage(loadError.error, t, 'errors.loadPickup')}</Text>
            <PrototypeButton
              variant="secondary"
              onPress={() => void fetchOptions()}
              style={styles.retryButton}
            >
              {t('common.retry')}
            </PrototypeButton>
          </PrototypeCard>
        ) : options.length === 0 ? (
          <PrototypeCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('pickup.noMeals')}</Text>
            <Text style={styles.emptyText}>
              {t('pickup.noMealsHint')}
            </Text>
          </PrototypeCard>
        ) : (
          <>
            <PrototypeCard style={styles.selectionCard}>
              <View style={styles.selectionHeader}>
                <Eyebrow>{t('pickup.mealsToPickUp')}</Eyebrow>
                <Text style={styles.selectionHint}>{t('pickup.selectOneOrMore')}</Text>
              </View>
              {options.map((option) => {
                const selected = selectedIds.has(option.registrationId);
                const optionTitle = option.type === 'OWN' ? t('pickup.myMeal') : t('pickup.delegatedMeal');
                const choiceLabel = t(option.mealChoice === 'VEGETARIAN' ? 'calendar.mealChoice.vegetarian' : 'calendar.mealChoice.regular');
                return (
                  <Pressable
                    key={option.registrationId}
                    accessibilityRole="checkbox"
                    accessibilityLabel={optionTitle}
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggleSelection(option.registrationId)}
                    style={[styles.optionRow, selected && styles.optionSelected]}
                  >
                    {selected ? (
                      <Check size={20} color={theme.colors.accentDeep} />
                    ) : (
                      <Square size={20} color={theme.colors.muted} />
                    )}
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>
                        {optionTitle}
                      </Text>
                      <Pill tone="outline"><PillText>{choiceLabel}</PillText></Pill>
                      <Text style={styles.optionDate}>
                        {formatShortDate(parseDateKey(option.mealDate), locale)}
                        {option.type === 'DELEGATED' && option.owner ? ` · ${t('pickup.from', { name: option.owner.name })}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </PrototypeCard>
            <PrototypeCard style={styles.ticketCard}>
              <View style={styles.ticketTop}>
                {visibleQrValue ? (
                  <QRCode
                    value={visibleQrValue}
                    size={200}
                    color={theme.colors.fg}
                    backgroundColor={theme.colors.surface}
                  />
                ) : (
                  <View style={styles.qrPlaceholder}>
                    <BrandLoader compact label={t('pickup.generatingQr')} />
                  </View>
                )}
                <Avatar initials={initials(profile?.name, 'ME')} />
                <Text style={styles.ticketName}>{displayName}</Text>
                <Text style={styles.ticketId}>
                  {profile?.userId || profile?.id || '—'}
                </Text>
              </View>
              <View style={styles.perforation} />
              <View style={styles.progressTrack}>
                <Animated.View
                  style={[styles.progressFill, { transform: [{ scaleX: progressAnim }] }]}
                />
              </View>
              <View style={styles.ticketBottom}>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketKey}>{t('pickup.meal')}</Text>
                  <Text style={styles.ticketValue}>{t('pickup.lunch')}</Text>
                </View>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketKey}>{t('pickup.mealChoice')}</Text>
                  <Text style={styles.ticketValue}>
                    {Array.from(new Set(options.filter((option) => selectedIds.has(option.registrationId)).map((option) => option.mealChoice))).map((choice) => t(choice === 'VEGETARIAN' ? 'calendar.mealChoice.vegetarian' : 'calendar.mealChoice.regular')).join(', ')}
                  </Text>
                </View>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketKey}>{t('common.selected')}</Text>
                  <Text style={styles.ticketValue}>
                    {t('pickup.selectedCount', { count: selectedIds.size })}
                  </Text>
                </View>
                <View style={styles.ticketNote}>
                  <Clock3 size={15} color={theme.colors.accentDeep} />
                  <Text style={styles.ticketNoteText}>
                    {qrLoading ? t('pickup.refreshingCode') : t('pickup.codeRefreshesIn', { seconds: timeLeft })}
                  </Text>
                </View>
              </View>
            </PrototypeCard>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(isGenerating ? 'pickup.pauseTicket' : 'pickup.generateTicket')}
              disabled={selectedIds.size === 0}
              onPress={() => setIsGenerating((current) => !current)}
              style={[styles.generateButton, selectedIds.size === 0 && styles.disabled]}
            >
              <Text style={styles.generateText}>
                {t(isGenerating ? 'pickup.pauseTicket' : 'pickup.generateTicket')}
              </Text>
            </Pressable>
          </>
        )}
      </StateTransition>
    </PrototypeFrame>
  );

}
const styles = StyleSheet.create({
  retryButton: { marginTop: 16 },
  emptyCard: { marginTop: 20 },
  errorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyTitle: { color: theme.colors.fg, fontSize: 17, fontFamily: theme.typography.bold },
  emptyText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19, marginTop: 8 },
  selectionCard: { marginBottom: 16 },
  selectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 },
  selectionHint: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  optionRow: { minHeight: 52, paddingVertical: 9, paddingHorizontal: 10, borderRadius: theme.radii.sm, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionSelected: { backgroundColor: theme.colors.accentTint },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.bold },
  optionDate: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  ticketCard: { padding: 0, overflow: 'hidden', marginBottom: 16 },
  ticketTop: { padding: 26, alignItems: 'center', gap: 10 },
  qrPlaceholder: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint },
  ticketName: { color: theme.colors.fg, fontSize: 17, fontFamily: theme.typography.bold, marginTop: 4 },
  ticketId: { color: theme.colors.muted, fontFamily: theme.typography.fontMono, fontSize: 13 },
  perforation: { height: 1, marginHorizontal: 14, borderTopWidth: 2, borderTopColor: theme.colors.border, borderStyle: 'dashed' },
  progressTrack: { height: 4, marginHorizontal: 26, overflow: 'hidden', backgroundColor: theme.colors.accentTint },
  progressFill: { width: '100%', height: '100%', backgroundColor: theme.colors.accentDeep, transformOrigin: 'left' },
  ticketBottom: { padding: 22, gap: 14 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketKey: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  ticketValue: { color: theme.colors.fg, fontSize: 13, fontFamily: theme.typography.semiBold },
  ticketNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  ticketNoteText: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  generateButton: { minHeight: 48, marginBottom: 16, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  generateText: { color: theme.colors.surface, fontSize: 14, fontFamily: theme.typography.bold },
  disabled: { opacity: 0.5 },
});
