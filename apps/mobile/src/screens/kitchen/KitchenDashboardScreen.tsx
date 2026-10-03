import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  AppState,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import type { AppTabScreenProps } from '../../navigation';
import { CheckCircle2, Clock3, Leaf, Utensils, WifiOff, XCircle, type LucideIcon } from 'lucide-react-native';
import { useSession } from '../../auth/session';
import {
  checkInAPI,
  type KitchenCheckInDashboard,
} from '../../api/checkInAPI';
import { getMobileErrorMessage, MobileApiError } from '../../api/mobileApiError';
import { formatBusinessInstant } from '../../businessDate';
import { useLanguage } from '../../i18n/LanguageProvider';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { ActionButton, AppText, StatusBadge, Surface } from '../../ui/components';
import { ScreenLoading, StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { designTokens } from '../../ui/designTokens';

type Props = AppTabScreenProps<'KitchenDashboard'>;

type CountCardProps = {
  label: string;
  count: number;
  tone: 'information' | 'success' | 'warning' | 'critical';
  icon: LucideIcon;
};

function windowTime(value: string, locale: string): string {
  return new Date(value).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function CountCard({ label, count, tone, icon: Icon }: CountCardProps): React.JSX.Element {
  return (
    <View style={styles.countCard}>
      <View style={styles.countIcon}>
        <Icon size={17} color={designTokens.color.semantic[tone].base} />
      </View>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="metric" style={styles.countValue}>
        {count}
      </AppText>
    </View>
  );
}

export function KitchenDashboardScreen(_props: Props): React.JSX.Element {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [snapshot, setSnapshot] = useState<KitchenCheckInDashboard | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const activeRef = useRef(appActive);
  const focusedRef = useRef(isFocused);
  const snapshotRef = useRef<KitchenCheckInDashboard | null>(snapshot);
  const previousTokenRef = useRef(token);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  activeRef.current = appActive;
  focusedRef.current = isFocused;
  snapshotRef.current = snapshot;
  const screenLoading = useScreenLoadingGate(isFocused, !initialLoading);

  useEffect(() => {
    if (previousTokenRef.current === token) return;
    previousTokenRef.current = token;
    requestIdRef.current += 1;
    inFlightRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setError(null);
    setInitialLoading(Boolean(token));
  }, [token]);


  const fetchDashboard = useCallback(async () => {
    if (
      !token ||
      !isFocused ||
      !activeRef.current ||
      inFlightRef.current
    ) {
      return;
    }
    const requestId = ++requestIdRef.current;
    inFlightRef.current = true;
    if (snapshotRef.current === null) setInitialLoading(true);
    try {
      const response = await checkInAPI.getKitchenDashboard(token);
      if (
        requestId !== requestIdRef.current ||
        !focusedRef.current ||
        !activeRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      snapshotRef.current = response.data;
      setSnapshot(response.data);
      setError(null);
    } catch (nextError: unknown) {
      if (
        requestId !== requestIdRef.current ||
        !focusedRef.current ||
        !activeRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      if (
        nextError instanceof MobileApiError &&
        nextError.code === 'SESSION_INVALID'
      ) {
        snapshotRef.current = null;
        setSnapshot(null);
      }
      setError(nextError);
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [isFocused, token]);
  const refreshDashboard = useCallback(() => {
    if (
      !token ||
      !isFocused ||
      !activeRef.current ||
      inFlightRef.current
    ) {
      return;
    }
    setRefreshing(true);
    void fetchDashboard();
  }, [fetchDashboard, isFocused, token]);


  useFocusEffect(
    useCallback(() => {
      void fetchDashboard();
      const interval = setInterval(() => {
        if (
          focusedRef.current &&
          activeRef.current &&
          !inFlightRef.current
        ) {
          void fetchDashboard();
        }
      }, 10_000);
      return () => {
        clearInterval(interval);
        requestIdRef.current += 1;
        inFlightRef.current = false;
      };
    }, [fetchDashboard]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      setAppActive(active);
      activeRef.current = active;
      if (!active) {
        requestIdRef.current += 1;
        inFlightRef.current = false;
        setRefreshing(false);
      } else if (focusedRef.current) {
        void fetchDashboard();
      }
    });
    return () => subscription.remove();
  }, [fetchDashboard]);

  if (screenLoading) return <ScreenLoading label={t('kitchen.loadingDashboard')} />;

  const counts = snapshot?.counts ?? {
    registered: 0,
    checkedIn: 0,
    pending: 0,
    noShow: 0,
    regular: 0,
    vegetarian: 0,
  };
  const progress = counts.registered > 0 ? Math.min(1, counts.checkedIn / counts.registered) : 0;
  const stale = error !== null && snapshot !== null;
  const networkFailure =
    error instanceof MobileApiError &&
    (error.code === 'API_TIMEOUT' || error.code === 'REQUEST_FAILED');

  return (
    <AppFrame
      animateEntrance={false}
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshDashboard}
          />
        ),
      }}
    >
      <SectionHeader title={t('common.dashboard')} subtitle={t('kitchen.servingOverview')} />
      <StateTransition stateKey={snapshot ? 'ready' : error ? 'error' : 'loading'}>
        {snapshot ? (
          <View style={styles.content}>
            <Surface style={styles.locationCard}>
              <View style={styles.locationHeader}>
                <View style={styles.locationCopy}>
                  <AppText variant="sectionTitle">{snapshot.location.displayName}</AppText>
                  <AppText variant="supporting" tone="secondary">
                    {snapshot.location.servingPointName} · {snapshot.location.address}
                  </AppText>
                </View>
                {stale ? (
                  <StatusBadge label={t('kitchenDashboard.stale')} tone="warning" icon={WifiOff} />
                ) : (
                  <StatusBadge label={t('kitchen.live')} tone="success" icon={CheckCircle2} />
                )}
              </View>
              <View style={styles.windowRow}>
                <Clock3 size={17} color={designTokens.color.text.secondary} />
                <AppText variant="supporting" tone="secondary">
                  {windowTime(snapshot.window.opensAt, locale)}–{windowTime(snapshot.window.closesAt, locale)} · {snapshot.window.timeZone}
                </AppText>
              </View>
              <AppText variant="caption" tone="tertiary">
                {t('kitchenDashboard.lastUpdated', {
                  time: formatBusinessInstant(snapshot.lastUpdated, locale),
                })}
              </AppText>
            </Surface>

            <Surface style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <View>
                  <AppText variant="eyebrow" tone="secondary">{t('kitchen.checkInProgress')}</AppText>
                  <AppText variant="metric">{counts.checkedIn} / {counts.registered}</AppText>
                </View>
                <AppText variant="supporting" tone="secondary">
                  {t('kitchenDashboard.checkedIn')}
                </AppText>
              </View>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: counts.registered || 1, now: counts.checkedIn }}
                style={styles.progressTrack}
              >
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
            </Surface>

            <View style={styles.countGrid}>
              <CountCard label={t('kitchenDashboard.registered')} count={counts.registered} tone="information" icon={Utensils} />
              <CountCard label={t('kitchenDashboard.checkedIn')} count={counts.checkedIn} tone="success" icon={CheckCircle2} />
              <CountCard label={t('kitchenDashboard.pending')} count={counts.pending} tone="warning" icon={Clock3} />
              <CountCard label={t('kitchenDashboard.noShow')} count={counts.noShow} tone="critical" icon={XCircle} />
            </View>

            <Surface style={styles.mealTypesCard}>
              <AppText variant="eyebrow" tone="secondary">{t('kitchen.dietaryPreferences')}</AppText>
              <View style={styles.mealTypesRow}>
                <View style={styles.mealType}><Utensils size={17} color={designTokens.color.text.secondary} /><AppText variant="supporting" tone="secondary">{t('kitchenDashboard.regular')}</AppText><AppText variant="monoCaption">{counts.regular}</AppText></View>
                <View style={styles.mealType}><Leaf size={17} color={designTokens.color.brand.primary} /><AppText variant="supporting" tone="secondary">{t('kitchenDashboard.vegetarian')}</AppText><AppText variant="monoCaption">{counts.vegetarian}</AppText></View>
              </View>
            </Surface>
            {stale ? (
              <View style={styles.staleBlock}>
                <AppText variant="supporting" tone="warning">{t('kitchenDashboard.stale')}</AppText>
                <AppText variant="caption" tone="secondary">
                  {getMobileErrorMessage(error, t, 'errors.loadKitchenDashboard')}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : (
          <Surface style={styles.errorCard}>
            <AppText variant="cardTitle">{t('kitchen.dashboardUnavailable')}</AppText>
            <AppText variant="body" tone="secondary">
              {networkFailure ? getMobileErrorMessage(error, t, 'errors.loadKitchenDashboard') : t('kitchen.dashboardUnavailable')}
            </AppText>
            <ActionButton variant="secondary" size="md" label={t('common.retry')} onPress={refreshDashboard} />
          </Surface>
        )}
      </StateTransition>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  content: { gap: designTokens.space.md },
  locationCard: { gap: designTokens.space.md },
  locationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: designTokens.space.md },
  locationCopy: { flex: 1, gap: designTokens.space.xs },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
  progressCard: { gap: designTokens.space.md },
  progressHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: designTokens.space.md },
  progressTrack: { height: 10, overflow: 'hidden', borderRadius: designTokens.radius.full, backgroundColor: designTokens.color.semantic.neutral.tint },
  progressFill: { height: '100%', borderRadius: designTokens.radius.full, backgroundColor: designTokens.color.brand.primary },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: designTokens.space.sm },
  countCard: { flexGrow: 1, flexBasis: '46%', minHeight: 112, padding: designTokens.space.md, gap: designTokens.space.xs, borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.surface.standard },
  countIcon: { alignSelf: 'flex-start', padding: designTokens.space.xs, borderRadius: designTokens.radius.smallControl, backgroundColor: designTokens.color.semantic.neutral.tint },
  countValue: { marginTop: 'auto' },
  mealTypesCard: { gap: designTokens.space.md },
  mealTypesRow: { flexDirection: 'row', gap: designTokens.space.xl },
  mealType: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
  staleBlock: { gap: designTokens.space.xs },
  errorCard: { gap: designTokens.space.md },
});
