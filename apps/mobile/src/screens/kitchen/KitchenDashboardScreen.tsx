import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChevronRight, Radio, Search, Utensils } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { kitchenAPI, type KitchenDashboardSnapshot, type KitchenRegistrationItem, type ServingLogItem } from '../../api/kitchenAPI';
import { formatBusinessInstant, initials } from '../../businessDate';
import { ActionButton, AppText, ProgressMeter, StatusBadge, Surface, TextField } from '../../ui/components';
import { AppFrame } from '../../ui/AppShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { useLanguage } from '../../i18n/LanguageProvider';
import { designTokens, getElevationStyle } from '../../ui/designTokens';
type TabType = 'pending' | 'served' | 'all' | 'noshow' | 'logs';
type Props = AppTabScreenProps<'KitchenDashboard'>;

export function KitchenDashboardScreen({ navigation }: Props) {
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
      if (currentSnapshot.current === null) {
        const message = getMobileErrorMessage(error, t, 'errors.loadKitchen');
        setLoadError(error);
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
    const interval = setInterval(() => { void fetchDashboard(); }, 5_000);
    return () => {
      clearInterval(interval);
      dashboardRequestId.current += 1;
    };
  }, [fetchDashboard, isFocused]);

  const active = Boolean(snapshot?.isServingReady);
  const maxX = Math.max(0, trackWidth - 52);
  const settleSlider = (value: number) => Animated.spring(sliderX, { toValue: value, useNativeDriver: false, bounciness: 0 }).start();
  useEffect(() => { settleSlider(active ? maxX : 0); }, [active, maxX]);

  const toggleSignal = async (next: boolean) => {
    if (!token || togglingSignal) return;
    setTogglingSignal(true);
    try {
      const response = await kitchenAPI.toggleServingSignal(next, undefined, token);
      setSnapshot((current) => current ? { ...current, isServingReady: response.isServingReady } : current);
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

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !togglingSignal,
    onMoveShouldSetPanResponder: (_, gesture) => !togglingSignal && Math.abs(gesture.dx) > 4,
    onPanResponderMove: (_, gesture) => { sliderX.setValue(Math.min(maxX, Math.max(0, (active ? maxX : 0) + gesture.dx))); },
    onPanResponderRelease: (_, gesture) => {
      const position = Math.min(maxX, Math.max(0, (active ? maxX : 0) + gesture.dx));
      if (!active && maxX > 0 && position / maxX > 0.25) { void toggleSignal(true); return; }
      if (active && maxX > 0 && position / maxX < 0.75) { void toggleSignal(false); return; }
      settleSlider(active ? maxX : 0);
    },
  }), [active, maxX, sliderX, togglingSignal]);

  const counters = snapshot?.counters || { totalRegistered: 0, regularTotal: 0, vegetarianTotal: 0, servedTotal: 0, remaining: 0, noShowTotal: 0 };
  const mealChoiceLabel = (mealChoice: KitchenRegistrationItem['mealChoice']) => t(mealChoice === 'VEGETARIAN' ? 'kitchen.vegetarian' : 'kitchen.regular');
  const filterItems = (items: KitchenRegistrationItem[]) => {
    const query = searchQuery.trim().toLowerCase();
    return query ? items.filter((item) => item.userName.toLowerCase().includes(query) || item.userEmail.toLowerCase().includes(query)) : items;
  };
  const filterLogs = (items: ServingLogItem[]) => {
    const query = searchQuery.trim().toLowerCase();
    return query ? items.filter((item) => item.userName.toLowerCase().includes(query) || item.userEmail.toLowerCase().includes(query)) : items;
  };
  const lists: Record<'pending' | 'served' | 'all' | 'noshow', KitchenRegistrationItem[]> = {
    pending: filterItems(snapshot?.lists.pending || []),
    served: filterItems(snapshot?.lists.served || []),
    all: filterItems(snapshot?.lists.all || []),
    noshow: filterItems(snapshot?.lists.noShow || []),
  };
  const selectedItems = activeTab === 'logs' ? [] : lists[activeTab];
  const logs = activeTab === 'logs' ? filterLogs(snapshot?.recentLogs || []) : [];
  return (
    <AppFrame screenLoadingLabel={screenLoading ? t('kitchen.loadingDashboard') : undefined} scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchDashboard(); }} /> }} bottomClearance={114}>
      <StateTransition style={styles.dashboardContent} stateKey={snapshot === null ? 'error' : 'ready'}>
        {snapshot === null ? (
          <Surface style={styles.errorCard}>
            <AppText variant="cardTitle">{t('kitchen.dashboardUnavailable')}</AppText>
            <AppText variant="body" tone="secondary">{getMobileErrorMessage(loadError, t, 'errors.loadKitchen')}</AppText>
            <ActionButton variant="secondary" size="md" label={t('common.retry')} onPress={() => void fetchDashboard()} style={styles.retryButton} />
          </Surface>
        ) : (
          <>
            <Surface style={[styles.servingCard, active && styles.servingActive]}>
              <View style={styles.servingInfo}>
                <AppText variant="sectionTitle">{active ? t('kitchen.servingLive') : t('kitchen.readyToServe')}</AppText>
                <AppText variant="supporting" tone="secondary">{active ? t('kitchen.readyToScan') : t('kitchen.slideToStart')}</AppText>
              </View>
              <View
                accessibilityRole="switch"
                accessibilityLabel={active ? t('kitchen.slideToStop') : t('kitchen.slideToStart')}
                accessibilityState={{ checked: active, disabled: togglingSignal, busy: togglingSignal }}
                accessibilityActions={[{ name: 'activate', label: active ? t('kitchen.slideToStop') : t('kitchen.slideToStart') }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'activate') void toggleSignal(!active);
                }}
                onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
                style={styles.sliderTrack}
                {...panResponder.panHandlers}
              >
                <Animated.View style={[styles.sliderFill, active && styles.sliderFillActive, { width: sliderX.interpolate({ inputRange: [0, Math.max(1, maxX)], outputRange: ['0%', '100%'] }) }]} />
                <Animated.View style={[styles.sliderThumb, { transform: [{ translateX: sliderX }] }]}>
                  <ChevronRight size={20} color={active ? designTokens.color.text.strong : designTokens.color.brand.primary} />
                </Animated.View>
                <AppText variant="buttonLabel" tone={active ? 'onBrand' : 'secondary'} style={styles.sliderHint}>{active ? t('kitchen.slideToStop') : t('kitchen.slideToStart')}</AppText>
              </View>
            </Surface>
            <View style={styles.serviceMeta}><Utensils size={16} color={designTokens.color.brand.primary} /><AppText variant="supporting" tone="secondary" style={styles.serviceMetaText}>{t('kitchen.lunchService')}</AppText></View>
            <View style={[styles.metricsGrid, stackKitchenMetrics && styles.metricsGridStacked]}>
              <View style={[styles.metricsColumnLeft, stackKitchenMetrics && styles.metricsColumnStacked]}>
                <Surface style={styles.totalCard}>
                  <View style={styles.summaryHeading}><AppText variant="eyebrow">{t('kitchen.totalMealsOrdered')}</AppText></View>
                  <View style={styles.totalRow}><AppText variant="metric" style={styles.totalNumber}>{counters.totalRegistered}</AppText><AppText variant="supporting" tone="secondary" style={styles.totalUnit}>{t('kitchen.totalUnit')}</AppText></View>
                </Surface>
              </View>
              <View style={[styles.metricsColumnRight, stackKitchenMetrics && styles.metricsColumnStacked]}>
                <Surface style={styles.dietCard}>
                  <View style={styles.summaryHeading}><AppText variant="eyebrow">{t('kitchen.dietaryPreferences')}</AppText></View>
                  <View style={styles.dietBar}><View style={[styles.regularSegment, { flex: counters.regularTotal }]} /><View style={[styles.vegSegment, { flex: counters.vegetarianTotal }]} /></View>
                  <View style={styles.dietLegend}>
                    <View style={styles.legendItem}><View style={[styles.legendDot, styles.regularDot]} /><View style={styles.legendCopy}><AppText variant="supporting" tone="secondary">{t('kitchen.regular')}</AppText><AppText variant="monoCaption" tone="strong">{counters.regularTotal}</AppText></View></View>
                    <View style={styles.legendItem}><View style={[styles.legendDot, styles.vegDot]} /><View style={styles.legendCopy}><AppText variant="supporting" tone="secondary">{t('kitchen.vegetarian')}</AppText><AppText variant="monoCaption" tone="strong">{counters.vegetarianTotal}</AppText></View></View>
                  </View>
                </Surface>
                <Surface style={styles.checkinCard}>
                  <View style={styles.checkinHead}><View style={styles.summaryHeading}><AppText variant="eyebrow">{t('kitchen.checkInProgress')}</AppText></View><AppText variant="monoCaption" tone="strong" style={styles.checkinRatio}>{counters.servedTotal} / {counters.totalRegistered}</AppText></View>
                  <ProgressMeter value={counters.servedTotal} max={counters.totalRegistered} tone="information" size="md" label={t('kitchen.checkInProgress')} />
                  <View style={styles.checkinLegend}><AppText variant="supporting" tone="secondary" style={styles.legendText}>{t('kitchen.checkedIn', { count: counters.servedTotal })}</AppText><AppText variant="supporting" tone="secondary" style={styles.legendText}>{t('kitchen.pending', { count: counters.remaining })}</AppText></View>
                </Surface>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('kitchen.openScanner')} onPress={() => navigation.navigate('KitchenScanner')} style={styles.scannerLink}><Radio size={18} color={designTokens.color.brand.primary} /><AppText variant="buttonLabel" tone="strong" style={styles.scannerLinkText}>{t('kitchen.openScanner')}</AppText></Pressable>
            <View style={styles.listSection}>
              <View style={styles.listHeader}><AppText variant="sectionTitle" style={styles.listTitle}>{t('kitchen.todayRegistrations')}</AppText><AppText variant="caption" tone="secondary" style={styles.syncText}>{loading ? t('kitchen.syncing') : t('kitchen.autoSync')}</AppText></View>
              <TextField label={t('kitchen.searchPlaceholder')} icon={Search} accessibilityLabel={t('kitchen.searchPlaceholder')} value={searchQuery} onChangeText={setSearchQuery} placeholder={t('kitchen.searchPlaceholder')} containerStyle={styles.searchWrap} />
              <View style={styles.tabs}>{(['pending', 'served', 'all', 'noshow', 'logs'] as TabType[]).map((tab) => { const tabLabel = tab === 'pending' ? 'kitchen.tabPending' : tab === 'served' ? 'kitchen.tabServed' : tab === 'all' ? 'kitchen.tabAll' : tab === 'noshow' ? 'kitchen.tabNoShow' : 'kitchen.tabLogs'; const count = tab === 'pending' ? snapshot.lists.pending.length : tab === 'served' ? snapshot.lists.served.length : tab === 'all' ? snapshot.lists.all.length : tab === 'noshow' ? snapshot.lists.noShow?.length || counters.noShowTotal : snapshot.recentLogs.length; return <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]}><AppText variant="buttonLabel" tone={activeTab === tab ? 'strong' : 'secondary'} style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{t(tabLabel, { count })}</AppText></Pressable>; })}</View>
              {!loading && selectedItems.length === 0 && logs.length === 0 && <AppText variant="body" tone="secondary" style={styles.emptyText}>{t('kitchen.noMatchingRegistrations')}</AppText>}
            </View>
          </>
        )}
      </StateTransition>
    </AppFrame>
  );
}
function ListRow({ initials: avatarInitials, name, detail, status, good, bad }: { initials: string; name: string; detail: string; status: string; good: boolean; bad?: boolean }) {
  return <View style={styles.listRow}><View style={[styles.listAvatar, good && styles.listAvatarGood]}><AppText variant="buttonLabel" tone={good ? 'strong' : 'secondary'} style={[styles.listAvatarText, good && styles.listAvatarTextGood]}>{avatarInitials}</AppText></View><View style={styles.listCopy}><AppText variant="cardTitle" style={styles.listName}>{name}</AppText><AppText variant="caption" tone="secondary" style={styles.listDetail}>{detail}</AppText></View><StatusBadge label={status} tone={good ? 'success' : bad ? 'critical' : 'neutral'} /></View>;
}

const styles = StyleSheet.create({
  dashboardContent: { width: '100%' },
  errorCard: { marginTop: designTokens.space.md },
  retryButton: { marginTop: designTokens.space.md },
  servingCard: { marginBottom: designTokens.space.md },
  servingActive: { backgroundColor: designTokens.color.brand.tint, borderColor: designTokens.color.brand.soft },
  servingInfo: { marginBottom: designTokens.space.lg },
  sliderTrack: { height: 52, borderWidth: 1, borderColor: designTokens.color.border.standard, borderRadius: designTokens.radius.full, backgroundColor: designTokens.color.background.page, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: designTokens.color.brand.soft },
  sliderFillActive: { backgroundColor: designTokens.color.brand.primary },
  sliderThumb: { position: 'absolute', left: 4, top: 4, width: 44, height: 44, borderRadius: designTokens.radius.full, backgroundColor: designTokens.color.surface.standard, alignItems: 'center', justifyContent: 'center', ...getElevationStyle(1) },
  sliderHint: { flexShrink: 1, minWidth: 0 },
  serviceMeta: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm, marginBottom: designTokens.space.md, minWidth: 0 },
  serviceMetaText: { flexShrink: 1, minWidth: 0 },
  metricsGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: designTokens.space.md, marginBottom: designTokens.space.md },
  metricsGridStacked: { flexDirection: 'column' },
  metricsColumnLeft: { flex: 2, minWidth: 0 },
  metricsColumnRight: { flex: 3, minWidth: 0, gap: designTokens.space.md },
  metricsColumnStacked: { flexGrow: 0, flexShrink: 1, width: '100%' },
  summaryHeading: { flexShrink: 1, minWidth: 0 },
  totalCard: { padding: designTokens.space.md },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: designTokens.space.sm, marginTop: designTokens.space.sm },
  totalNumber: { flexShrink: 1 },
  totalUnit: { flexShrink: 1, minWidth: 0 },
  dietCard: { padding: designTokens.space.md },
  dietBar: { height: 14, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: designTokens.radius.full, marginTop: designTokens.space.md, backgroundColor: designTokens.color.surface.standard },
  regularSegment: { flex: 72, backgroundColor: designTokens.color.text.secondary, borderTopLeftRadius: designTokens.radius.smallControl, borderBottomLeftRadius: designTokens.radius.smallControl },
  vegSegment: { flex: 28, backgroundColor: designTokens.color.brand.primary, borderTopRightRadius: designTokens.radius.smallControl, borderBottomRightRadius: designTokens.radius.smallControl },
  dietLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: designTokens.space.lg, marginTop: designTokens.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm, flexShrink: 1, minWidth: 0 },
  legendCopy: { flexShrink: 1, minWidth: 0 },
  legendDot: { width: 10, height: 10, borderRadius: designTokens.radius.smallControl },
  regularDot: { backgroundColor: designTokens.color.text.secondary },
  vegDot: { backgroundColor: designTokens.color.brand.primary },
  checkinCard: { padding: designTokens.space.md },
  checkinHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: designTokens.space.sm },
  checkinRatio: { flexShrink: 1, minWidth: 0 },
  checkinLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: designTokens.space.md, marginTop: designTokens.space.md },
  legendText: { flexShrink: 1, minWidth: 0 },
  scannerLink: { minHeight: designTokens.size.touchMin, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: designTokens.space.sm },
  scannerLinkText: { flexShrink: 1, minWidth: 0 },
  listSection: { paddingTop: designTokens.space.lg, borderTopWidth: 1, borderTopColor: designTokens.color.border.standard },
  listHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: designTokens.space.sm },
  listTitle: { flexShrink: 1, minWidth: 0 },
  syncText: { flexShrink: 1, minWidth: 0 },
  searchWrap: { marginVertical: designTokens.space.md },
  tabs: { flexDirection: 'row', gap: designTokens.space.xs, flexWrap: 'wrap', marginBottom: designTokens.space.sm },
  tab: { minHeight: designTokens.size.touchMin, paddingHorizontal: designTokens.space.sm, paddingVertical: designTokens.space.sm, borderRadius: designTokens.radius.full, backgroundColor: designTokens.color.background.page, justifyContent: 'center' },
  tabActive: { backgroundColor: designTokens.color.brand.soft },
  tabText: { flexShrink: 1, minWidth: 0 },
  tabTextActive: {},
  listRow: { minHeight: 66, paddingVertical: designTokens.space.sm, borderBottomWidth: 1, borderBottomColor: designTokens.color.border.standard, flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
  listAvatar: { width: 36, height: 36, borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.brand.soft, alignItems: 'center', justifyContent: 'center' },
  listAvatarGood: { backgroundColor: designTokens.color.semantic.success.tint },
  listAvatarText: { flexShrink: 1 },
  listAvatarTextGood: {},
  listCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  listName: { flexShrink: 1, minWidth: 0 },
  listDetail: { flexShrink: 1, minWidth: 0 },
  emptyText: { textAlign: 'center', paddingVertical: designTokens.space.xl },
});
