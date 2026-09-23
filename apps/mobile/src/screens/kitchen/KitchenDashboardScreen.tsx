import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Leaf,
  Search,
  Utensils,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';
import { Circle, Svg } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import {
  kitchenAPI,
  type KitchenDashboardSnapshot,
  type KitchenRegistrationItem,
  type ServingLogItem,
} from '../../api/kitchenAPI';
import { formatBusinessInstant, initials } from '../../businessDate';
import {
  ActionButton,
  AppText,
  StatusBadge,
  StatusDot,
  Surface,
  TextField,
} from '../../ui/components';
import { AppFrame } from '../../ui/AppShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { getMobileErrorMessage, MobileApiError } from '../../api/mobileApiError';
import { useLanguage } from '../../i18n/LanguageProvider';
import {
  designTokens,
  getElevationStyle,
  type SemanticTone,
} from '../../ui/designTokens';

type TabType = 'pending' | 'served' | 'all' | 'noshow' | 'logs';
type Props = AppTabScreenProps<'KitchenDashboard'>;

export function KitchenDashboardScreen(_props: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const stackKitchenMetrics = width < 350 || fontScale > 1.2;
  const isFocused = useIsFocused();
  const [snapshot, setSnapshot] = useState<KitchenDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingSignal, setTogglingSignal] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const sliderX = useRef(new Animated.Value(0)).current;
  const dashboardRequestId = useRef(0);
  const currentSnapshot = useRef<KitchenDashboardSnapshot | null>(null);
  const screenLoading = useScreenLoadingGate(isFocused, !loading);

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    const requestId = ++dashboardRequestId.current;
    setLoading(true);
    try {
      const nextSnapshot = await kitchenAPI.getDashboardSnapshot(undefined, token);
      if (requestId !== dashboardRequestId.current) return;
      currentSnapshot.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setLoadError(null);
    } catch (error: unknown) {
      if (requestId !== dashboardRequestId.current) return;
      setLoadError(error);
      if (currentSnapshot.current === null) {
        const message = getMobileErrorMessage(error, t, 'errors.loadKitchen');
        showNotice({ title: t('kitchen.dashboardUnavailable'), message, tone: 'error' });
      }
    } finally {
      if (requestId === dashboardRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [showNotice, t, token]);

  useEffect(() => {
    if (!isFocused) return;
    void fetchDashboard();
    const interval = setInterval(() => {
      void fetchDashboard();
    }, 5_000);
    return () => {
      clearInterval(interval);
      dashboardRequestId.current += 1;
    };
  }, [fetchDashboard, isFocused]);

  const active = Boolean(snapshot?.isServingReady);
  const maxX = Math.max(0, trackWidth - 52);
  const settleSlider = (value: number) =>
    Animated.spring(sliderX, {
      toValue: value,
      useNativeDriver: false,
      bounciness: 0,
    }).start();

  useEffect(() => {
    settleSlider(active ? maxX : 0);
  }, [active, maxX]);

  const toggleSignal = async (next: boolean) => {
    if (!token || togglingSignal) return;
    setTogglingSignal(true);
    try {
      const response = await kitchenAPI.toggleServingSignal(next, undefined, token);
      setSnapshot((current) =>
        current ? { ...current, isServingReady: response.isServingReady } : current,
      );
    } catch (error: unknown) {
      showNotice({
        title: t('kitchen.servingSignalUnavailable'),
        message: getMobileErrorMessage(error, t, 'errors.toggleServing'),
        tone: 'error',
      });
    } finally {
      setTogglingSignal(false);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !togglingSignal,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !togglingSignal && Math.abs(gesture.dx) > 4,
        onPanResponderMove: (_, gesture) => {
          sliderX.setValue(
            Math.min(maxX, Math.max(0, (active ? maxX : 0) + gesture.dx)),
          );
        },
        onPanResponderRelease: (_, gesture) => {
          const position = Math.min(
            maxX,
            Math.max(0, (active ? maxX : 0) + gesture.dx),
          );
          if (!active && maxX > 0 && position / maxX > 0.25) {
            void toggleSignal(true);
            return;
          }
          if (active && maxX > 0 && position / maxX < 0.75) {
            void toggleSignal(false);
            return;
          }
          settleSlider(active ? maxX : 0);
        },
      }),
    [active, maxX, sliderX, togglingSignal],
  );

  const counters =
    snapshot?.counters || {
      totalRegistered: 0,
      regularTotal: 0,
      vegetarianTotal: 0,
      servedTotal: 0,
      remaining: 0,
      noShowTotal: 0,
    };
  const total = counters.totalRegistered;
  const displayedServed =
    total > 0 ? Math.min(total, Math.max(0, counters.servedTotal)) : 0;
  const ringProgress = total > 0 ? displayedServed / total : 0;
  const ringSize = 148;
  const ringStroke = 12;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const mealChoiceLabel = (mealChoice: KitchenRegistrationItem['mealChoice']) =>
    t(mealChoice === 'VEGETARIAN' ? 'kitchen.vegetarian' : 'kitchen.regular');
  const filterItems = (items: KitchenRegistrationItem[]) => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? items.filter(
          (item) =>
            item.userName.toLowerCase().includes(query) ||
            item.userEmail.toLowerCase().includes(query),
        )
      : items;
  };
  const filterLogs = (items: ServingLogItem[]) => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? items.filter(
          (item) =>
            item.userName.toLowerCase().includes(query) ||
            item.userEmail.toLowerCase().includes(query),
        )
      : items;
  };
  const lists: Record<
    'pending' | 'served' | 'all' | 'noshow',
    KitchenRegistrationItem[]
  > = {
    pending: filterItems(snapshot?.lists.pending || []),
    served: filterItems(snapshot?.lists.served || []),
    all: filterItems(snapshot?.lists.all || []),
    noshow: filterItems(snapshot?.lists.noShow || []),
  };
  const selectedItems = activeTab === 'logs' ? [] : lists[activeTab];
  const logs = activeTab === 'logs' ? filterLogs(snapshot?.recentLogs || []) : [];
  const networkSyncFailure =
    loadError instanceof MobileApiError &&
    (loadError.code === 'API_TIMEOUT' ||
      (loadError.code === 'REQUEST_FAILED' && loadError.cause instanceof Error));
  const syncState = loadError
    ? networkSyncFailure
      ? 'offline'
      : 'stale'
    : loading
      ? 'syncing'
      : 'live';

  return (
    <AppFrame
      screenLoadingLabel={screenLoading ? t('kitchen.loadingDashboard') : undefined}
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchDashboard();
            }}
          />
        ),
      }}
      bottomClearance={114}
    >
      <StateTransition
        style={styles.dashboardContent}
        stateKey={snapshot === null ? 'error' : 'ready'}
      >
        {snapshot === null ? (
          <Surface style={styles.errorCard}>
            <AppText variant="cardTitle">{t('kitchen.dashboardUnavailable')}</AppText>
            <AppText variant="body" tone="secondary">
              {getMobileErrorMessage(loadError, t, 'errors.loadKitchen')}
            </AppText>
            <ActionButton
              variant="secondary"
              size="md"
              label={t('common.retry')}
              onPress={() => void fetchDashboard()}
              style={styles.retryButton}
            />
          </Surface>
        ) : (
          <>
            <Surface style={[styles.heroCard, active && styles.heroCardActive]}>
              <View style={styles.heroHeader}>
                <View style={styles.heroCopy}>
                  <AppText variant="sectionTitle">{t('kitchen.readyToServe')}</AppText>
                  <AppText variant="supporting" tone="secondary" style={styles.heroLocation}>
                    {t('kitchen.lunchLocation')}
                  </AppText>
                  <AppText variant="caption" tone="tertiary" style={styles.heroTime}>
                    {t('kitchen.serviceTime')}
                  </AppText>
                </View>
                <View style={[styles.statusPill, active ? styles.statusPillActive : styles.statusPillInactive]}>
                  <StatusDot
                    status={active ? 'live' : 'inactive'}
                    label={active ? t('kitchen.servingReady') : t('kitchen.servingNotReady')}
                    style={styles.statusPillDot}
                  />
                </View>
              </View>
              <View
                accessibilityRole="switch"
                accessibilityLabel={active ? t('kitchen.slideToStop') : t('kitchen.slideToStart')}
                accessibilityState={{
                  checked: active,
                  disabled: togglingSignal,
                  busy: togglingSignal,
                }}
                accessibilityActions={[
                  {
                    name: 'activate',
                    label: active ? t('kitchen.slideToStop') : t('kitchen.slideToStart'),
                  },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'activate') {
                    void toggleSignal(!active);
                  }
                }}
                onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
                style={styles.sliderTrack}
                {...panResponder.panHandlers}
              >
                <Animated.View
                  style={[
                    styles.sliderFill,
                    active && styles.sliderFillActive,
                    {
                      width: sliderX.interpolate({
                        inputRange: [0, Math.max(1, maxX)],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
                <Animated.View
                  style={[styles.sliderThumb, { transform: [{ translateX: sliderX }] }]}
                >
                  <ChevronRight
                    size={20}
                    color={
                      active
                        ? designTokens.color.text.strong
                        : designTokens.color.brand.primary
                    }
                  />
                </Animated.View>
                <AppText
                  variant="buttonLabel"
                  tone={active ? 'onBrand' : 'secondary'}
                  style={styles.sliderHint}
                >
                  {active ? t('kitchen.slideToStop') : t('kitchen.slideToStart')}
                </AppText>
              </View>
            </Surface>

            <Surface style={styles.overviewCard}>
              <View style={styles.overviewHeader}>
                <AppText variant="eyebrow">{t('common.today')}</AppText>
                <AppText variant="sectionTitle" style={styles.overviewTitle}>
                  {t('kitchen.servingOverview')}
                </AppText>
              </View>
              <View
                style={[
                  styles.overviewBody,
                  stackKitchenMetrics && styles.overviewBodyStacked,
                ]}
              >
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('kitchen.checkInProgress')}
                  accessibilityValue={{
                    min: 0,
                    max: total > 0 ? total : 1,
                    now: displayedServed,
                    text:
                      total > 0
                        ? `${displayedServed} / ${total}`
                        : `0 ${t('kitchen.totalUnit')}`,
                  }}
                  style={styles.ringWrap}
                >
                  <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
                    <Circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke={designTokens.color.semantic.neutral.tint}
                      strokeWidth={ringStroke}
                    />
                    <Circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke={
                        total > 0
                          ? designTokens.color.brand.primary
                          : designTokens.color.semantic.neutral.base
                      }
                      strokeWidth={ringStroke}
                      strokeLinecap="round"
                      strokeDasharray={`${ringCircumference} ${ringCircumference}`}
                      strokeDashoffset={ringCircumference * (1 - ringProgress)}
                      transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                    />
                  </Svg>
                  <View style={styles.ringCenter}>
                    {total > 0 ? (
                      <>
                        <AppText
                          variant="metric"
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.65}
                          style={styles.ringValue}
                        >
                          {displayedServed} / {total}
                        </AppText>
                        <AppText variant="caption" tone="secondary">
                          {t('kitchen.totalMealsLabel')}
                        </AppText>
                      </>
                    ) : (
                      <>
                        <AppText
                          variant="metric"
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                          style={styles.ringValue}
                        >
                          0
                        </AppText>
                        <AppText variant="caption" tone="secondary">
                          {t('kitchen.totalUnit')}
                        </AppText>
                      </>
                    )}
                  </View>
                  </View>
                <View style={styles.overviewDetails}>
                  <View style={styles.mealIndicators}>
                    <View style={styles.mealIndicator}>
                      <View style={[styles.mealIcon, styles.mealIconRegular]}>
                        <Utensils
                          size={17}
                          color={designTokens.color.text.secondary}
                        />
                      </View>
                      <View style={styles.mealIndicatorCopy}>
                        <AppText variant="supporting" tone="secondary">
                          {t('kitchen.regular')}
                        </AppText>
                        <AppText variant="monoCaption" tone="strong">
                          {counters.regularTotal}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.mealIndicator}>
                      <View style={[styles.mealIcon, styles.mealIconVegetarian]}>
                        <Leaf
                          size={17}
                          color={designTokens.color.brand.primary}
                        />
                      </View>
                      <View style={styles.mealIndicatorCopy}>
                        <AppText variant="supporting" tone="secondary">
                          {t('kitchen.vegetarian')}
                        </AppText>
                        <AppText variant="monoCaption" tone="strong">
                          {counters.vegetarianTotal}
                        </AppText>
                      </View>
                    </View>
                  </View>
                  <View style={styles.stateChips}>
                    <StatusBadge
                      label={t('kitchen.servedCount', { count: displayedServed })}
                      tone="success"
                      icon={CheckCircle2}
                    />
                    <StatusBadge
                      label={t('kitchen.pendingCount', { count: counters.remaining })}
                      tone="warning"
                      icon={Clock3}
                    />
                  </View>
                </View>
              </View>
            </Surface>

            <View style={styles.listSection}>
              <View style={styles.listHeader}>
                <AppText variant="sectionTitle" style={styles.listTitle}>
                  {t('kitchen.todayRegistrations')}
                </AppText>
                {syncState === 'offline' ? (
                  <StatusBadge
                    label={t('kitchen.syncOffline')}
                    tone="critical"
                    icon={WifiOff}
                    style={styles.syncBadge}
                  />
                ) : syncState === 'stale' ? (
                  <StatusBadge
                    label={t('kitchen.syncStale')}
                    tone="warning"
                    icon={Clock3}
                    style={styles.syncBadge}
                  />
                ) : syncState === 'syncing' ? (
                  <StatusDot
                    status="pending"
                    label={t('kitchen.syncing')}
                    style={styles.syncStatus}
                  />
                ) : (
                  <StatusDot
                    status="live"
                    label={t('kitchen.live')}
                    style={styles.syncStatus}
                  />
                )}
              </View>
              <TextField
                label={t('kitchen.searchPlaceholder')}
                icon={Search}
                accessibilityLabel={t('kitchen.searchPlaceholder')}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('kitchen.searchPlaceholder')}
                style={styles.searchInput}
                containerStyle={styles.searchWrap}
              />
              <View style={styles.tabs} accessibilityRole="tablist">
                {(['pending', 'served', 'all', 'noshow', 'logs'] as TabType[]).map(
                  (tab) => {
                    const tabLabel =
                      tab === 'pending'
                        ? 'common.pending'
                        : tab === 'served'
                          ? 'common.served'
                          : tab === 'all'
                            ? 'common.all'
                            : tab === 'noshow'
                              ? 'common.noShow'
                              : 'common.logs';
                    const tabAccessibilityLabel =
                      tab === 'pending'
                        ? 'kitchen.tabPending'
                        : tab === 'served'
                          ? 'kitchen.tabServed'
                          : tab === 'all'
                            ? 'kitchen.tabAll'
                            : tab === 'noshow'
                              ? 'kitchen.tabNoShow'
                              : 'kitchen.tabLogs';
                    const count =
                      tab === 'pending'
                        ? snapshot.lists.pending.length
                        : tab === 'served'
                          ? snapshot.lists.served.length
                          : tab === 'all'
                            ? snapshot.lists.all.length
                            : tab === 'noshow'
                              ? snapshot.lists.noShow?.length ?? counters.noShowTotal
                              : snapshot.recentLogs.length;
                    const TabIcon =
                      tab === 'pending'
                        ? Clock3
                        : tab === 'served'
                          ? CheckCircle2
                          : null;
                    return (
                      <Pressable
                        key={tab}
                        accessibilityRole="tab"
                        accessibilityLabel={t(tabAccessibilityLabel, { count })}
                        accessibilityState={{ selected: activeTab === tab }}
                        onPress={() => setActiveTab(tab)}
                        style={({ pressed }) => [
                          styles.tab,
                          activeTab === tab && styles.tabActive,
                          pressed && styles.tabPressed,
                        ]}
                      >
                        {TabIcon ? (
                          <TabIcon
                            size={16}
                            color={
                              activeTab === tab
                                ? designTokens.color.brand.primary
                                : designTokens.color.text.secondary
                            }
                            strokeWidth={2}
                          />
                        ) : null}
                        <AppText
                          variant="buttonLabel"
                          tone={activeTab === tab ? 'strong' : 'secondary'}
                          style={styles.tabText}
                        >
                          {t(tabLabel)}
                        </AppText>
                        <View style={[styles.tabCount, activeTab === tab && styles.tabCountActive]}>
                          <AppText
                            variant="badgeLabel"
                            tone={activeTab === tab ? 'information' : 'secondary'}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                            style={styles.tabCountText}
                          >
                            {count}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  },
                )}
              </View>
              {selectedItems.map((item) => (
                <ListRow
                  key={item.registrationId}
                  initials={initials(item.userName, '--')}
                  name={item.userName}
                  detail={`${mealChoiceLabel(item.mealChoice)}${
                    item.servedAt
                      ? ` · ${formatBusinessInstant(item.servedAt, locale)}`
                      : ''
                  }`}
                  status={
                    activeTab === 'noshow'
                      ? t('common.noShow')
                      : item.isServed
                        ? t('common.served')
                        : t('common.pending')
                  }
                  tone={
                    activeTab === 'noshow'
                      ? 'critical'
                      : item.isServed
                        ? 'success'
                        : 'warning'
                  }
                  icon={
                    activeTab === 'noshow'
                      ? XCircle
                      : item.isServed
                        ? CheckCircle2
                        : Clock3
                  }
                />
              ))}
              {logs.map((log) => (
                <ListRow
                  key={log.id}
                  initials={initials(log.userName, '--')}
                  name={log.userName}
                  detail={`${mealChoiceLabel(log.mealChoice)} · ${formatBusinessInstant(
                    log.servedAt,
                    locale,
                  )}${log.isProxy ? ` · ${t('kitchen.proxy')}` : ''}`}
                  status={t('common.served')}
                  tone="success"
                  icon={CheckCircle2}
                />
              ))}
              {selectedItems.length === 0 && logs.length === 0 ? (
                <AppText
                  variant="supporting"
                  tone="secondary"
                  style={styles.emptyState}
                >
                  {t('kitchen.noMatchingRegistrations')}
                </AppText>
              ) : null}
            </View>
          </>
        )}
      </StateTransition>
    </AppFrame>
  );
}

function ListRow({
  initials: avatarInitials,
  name,
  detail,
  status,
  tone,
  icon,
}: {
  initials: string;
  name: string;
  detail: string;
  status: string;
  tone: SemanticTone;
  icon: LucideIcon;
}) {
  const isSuccess = tone === 'success';
  return (
    <View style={styles.listRow}>
      <View style={[styles.listAvatar, isSuccess && styles.listAvatarGood]}>
        <AppText
          variant="buttonLabel"
          tone={isSuccess ? 'strong' : 'secondary'}
          style={[styles.listAvatarText, isSuccess && styles.listAvatarTextGood]}
        >
          {avatarInitials}
        </AppText>
      </View>
      <View style={styles.listCopy}>
        <AppText variant="cardTitle" style={styles.listName}>
          {name}
        </AppText>
        <AppText variant="caption" tone="secondary" style={styles.listDetail}>
          {detail}
        </AppText>
      </View>
      <StatusBadge label={status} tone={tone} icon={icon} />
    </View>
  );
}


const styles = StyleSheet.create({
  dashboardContent: { width: '100%' },
  errorCard: { marginTop: designTokens.space.md },
  retryButton: { marginTop: designTokens.space.md },
  heroCard: { marginBottom: designTokens.space.lg },
  heroCardActive: {
    backgroundColor: designTokens.color.brand.tint,
    borderColor: designTokens.color.brand.soft,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
    marginBottom: designTokens.space.lg,
  },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLocation: { marginTop: designTokens.space.xs },
  heroTime: { marginTop: designTokens.space.xs },
  statusPill: {
    minHeight: designTokens.size.controlSm,
    paddingHorizontal: designTokens.space.sm,
    borderRadius: designTokens.radius.full,
    justifyContent: 'center',
  },
  statusPillActive: { backgroundColor: designTokens.color.semantic.success.tint },
  statusPillInactive: { backgroundColor: designTokens.color.semantic.neutral.tint },
  statusPillDot: {
    minHeight: designTokens.size.controlSm,
    gap: designTokens.space.xs,
  },
  sliderTrack: {
    height: 52,
    borderWidth: 1,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.background.page,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: designTokens.color.brand.soft,
  },
  sliderFillActive: { backgroundColor: designTokens.color.brand.primary },
  sliderThumb: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: 44,
    height: 44,
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.surface.standard,
    alignItems: 'center',
    justifyContent: 'center',
    ...getElevationStyle(1),
  },
  sliderHint: { flexShrink: 1, minWidth: 0 },
  overviewCard: { marginBottom: designTokens.space.lg },
  overviewHeader: { gap: designTokens.space.xs, marginBottom: designTokens.space.lg },
  overviewTitle: { flexShrink: 1, minWidth: 0 },
  overviewBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xl,
  },
  overviewBodyStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  ringWrap: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  ringCenter: {
    position: 'absolute',
    width: 136,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    width: 136,
    flexShrink: 0,
    textAlign: 'center',
  },
  overviewDetails: { flex: 1, minWidth: 0, gap: designTokens.space.lg },
  mealIndicators: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.md,
  },
  mealIndicator: {
    minHeight: designTokens.size.controlMd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
    flexShrink: 1,
  },
  mealIcon: {
    width: 32,
    height: 32,
    borderRadius: designTokens.radius.smallControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealIconRegular: { backgroundColor: designTokens.color.background.page },
  mealIconVegetarian: { backgroundColor: designTokens.color.brand.tint },
  mealIndicatorCopy: { minWidth: 48, flexShrink: 1, gap: designTokens.space.xs },
  stateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.sm,
  },
  emptyState: {
    marginTop: designTokens.space.md,
    textAlign: 'center',
  },
  listSection: {
    paddingTop: designTokens.space.lg,
    borderTopWidth: 1,
    borderTopColor: designTokens.color.border.standard,
  },
  listHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.sm,
  },
  listTitle: { flexShrink: 1, minWidth: 0 },
  syncStatus: { minHeight: designTokens.size.controlSm, gap: designTokens.space.xs },
  syncBadge: { marginLeft: 'auto' },
  searchWrap: { marginVertical: designTokens.space.md },
  searchInput: {
    minHeight: designTokens.size.controlMd,
    paddingVertical: designTokens.space.sm,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.xs,
    marginBottom: designTokens.space.sm,
  },
  tab: {
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.sm,
    paddingVertical: designTokens.space.xs,
    borderRadius: designTokens.radius.full,
    borderWidth: 1,
    borderColor: designTokens.color.border.standard,
    backgroundColor: designTokens.color.surface.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
    flexShrink: 1,
  },
  tabActive: {
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.tint,
  },
  tabPressed: { opacity: 0.72 },
  tabText: { flexShrink: 1, minWidth: 0 },
  tabCount: {
    minWidth: 24,
    minHeight: 22,
    paddingHorizontal: designTokens.space.xs,
    borderRadius: designTokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.background.page,
    flexShrink: 0,
  },
  tabCountActive: { backgroundColor: designTokens.color.surface.standard },
  tabCountText: { flexShrink: 0 },
  listRow: {
    minHeight: 66,
    paddingVertical: designTokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: designTokens.color.border.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  listAvatar: {
    width: 40,
    height: 40,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.brand.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listAvatarGood: { backgroundColor: designTokens.color.semantic.success.tint },
  listAvatarText: { flexShrink: 1 },
  listAvatarTextGood: {},
  listCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  listName: { flexShrink: 1, minWidth: 0 },
  listDetail: { flexShrink: 1, minWidth: 0 },
  emptyText: { textAlign: 'center', paddingVertical: designTokens.space.xl },
});
