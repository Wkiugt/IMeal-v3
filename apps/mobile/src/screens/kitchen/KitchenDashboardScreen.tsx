import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ChevronRight, Radio, Search, Utensils } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { kitchenAPI, type KitchenDashboardSnapshot, type KitchenRegistrationItem, type ServingLogItem } from '../../api/kitchenAPI';
import { formatBusinessInstant, initials } from '../../businessDate';
import { Eyebrow, Pill, PillText, PrototypeButton, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';
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
  const progress = counters.totalRegistered ? Math.min(1, counters.servedTotal / counters.totalRegistered) : 0;
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
    <PrototypeFrame screenLoadingLabel={screenLoading ? t('kitchen.loadingDashboard') : undefined} scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchDashboard(); }} /> }} bottomClearance={114}>
      <StateTransition style={styles.dashboardContent} stateKey={snapshot === null ? 'error' : 'ready'}>
        {snapshot === null ? (
          <PrototypeCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('kitchen.dashboardUnavailable')}</Text>
            <Text style={styles.errorText}>{getMobileErrorMessage(loadError, t, 'errors.loadKitchen')}</Text>
            <PrototypeButton variant="secondary" onPress={() => void fetchDashboard()} style={styles.retryButton}>{t('common.retry')}</PrototypeButton>
          </PrototypeCard>
        ) : (
          <>
            <PrototypeCard style={[styles.servingCard, active && styles.servingActive]}><View style={styles.servingInfo}><Text style={styles.servingTitle}>{active ? t('kitchen.servingLive') : t('kitchen.readyToServe')}</Text><Text style={styles.servingSub}>{active ? t('kitchen.readyToScan') : t('kitchen.slideToStart')}</Text></View><View accessibilityRole="adjustable" onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} style={styles.sliderTrack} {...panResponder.panHandlers}><Animated.View style={[styles.sliderFill, active && styles.sliderFillActive, { width: sliderX.interpolate({ inputRange: [0, Math.max(1, maxX)], outputRange: ['0%', '100%'] }) }]} /><Animated.View style={[styles.sliderThumb, { transform: [{ translateX: sliderX }] }]}><ChevronRight size={20} color={active ? theme.colors.fg : theme.colors.accentDeep} /></Animated.View><Text style={[styles.sliderHint, active && styles.sliderHintActive]}>{active ? t('kitchen.slideToStop') : t('kitchen.slideToStart')}</Text></View></PrototypeCard>
            <View style={styles.serviceMeta}><Utensils size={16} color={theme.colors.accentDeep} /><Text style={styles.serviceMetaText}>{t('kitchen.lunchService')}</Text></View>
            <View style={[styles.metricsGrid, stackKitchenMetrics && styles.metricsGridStacked]}>
              <View style={[styles.metricsColumnLeft, stackKitchenMetrics && styles.metricsColumnStacked]}>
                <PrototypeCard style={styles.totalCard}><View style={styles.summaryHeading}><Eyebrow>{t('kitchen.totalMealsOrdered')}</Eyebrow></View><View style={styles.totalRow}><Text style={styles.totalNumber}>{counters.totalRegistered}</Text><Text style={styles.totalUnit}>{t('kitchen.totalUnit')}</Text></View></PrototypeCard>
              </View>
              <View style={[styles.metricsColumnRight, stackKitchenMetrics && styles.metricsColumnStacked]}>
                <PrototypeCard style={styles.dietCard}><View style={styles.summaryHeading}><Eyebrow>{t('kitchen.dietaryPreferences')}</Eyebrow></View><View style={styles.dietBar}><View style={[styles.regularSegment, { flex: counters.regularTotal }]} /><View style={[styles.vegSegment, { flex: counters.vegetarianTotal }]} /></View><View style={styles.dietLegend}><View style={styles.legendItem}><View style={[styles.legendDot, styles.regularDot]} /><View style={styles.legendCopy}><Text style={styles.legendLabel}>{t('kitchen.regular')}</Text><Text style={styles.legendNumber}>{counters.regularTotal}</Text></View></View><View style={styles.legendItem}><View style={[styles.legendDot, styles.vegDot]} /><View style={styles.legendCopy}><Text style={styles.legendLabel}>{t('kitchen.vegetarian')}</Text><Text style={styles.legendNumber}>{counters.vegetarianTotal}</Text></View></View></View></PrototypeCard>
                <PrototypeCard style={styles.checkinCard}><View style={styles.checkinHead}><View style={styles.summaryHeading}><Eyebrow>{t('kitchen.checkInProgress')}</Eyebrow></View><Text style={styles.checkinRatio}>{counters.servedTotal} / {counters.totalRegistered}</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { transform: [{ scaleX: progress }] }]} /></View><View style={styles.checkinLegend}><Text style={styles.legendText}>{t('kitchen.checkedIn', { count: counters.servedTotal })}</Text><Text style={styles.legendText}>{t('kitchen.pending', { count: counters.remaining })}</Text></View></PrototypeCard>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('kitchen.openScanner')} onPress={() => navigation.navigate('KitchenScanner')} style={styles.scannerLink}><Radio size={18} color={theme.colors.accentDeep} /><Text style={styles.scannerLinkText}>{t('kitchen.openScanner')}</Text></Pressable>
            <View style={styles.listSection}><View style={styles.listHeader}><Text style={styles.listTitle}>{t('kitchen.todayRegistrations')}</Text><Text style={styles.syncText}>{loading ? t('kitchen.syncing') : t('kitchen.autoSync')}</Text></View><View style={styles.searchWrap}><Search size={18} color={theme.colors.muted} /><TextInput accessibilityLabel={t('kitchen.searchPlaceholder')} value={searchQuery} onChangeText={setSearchQuery} placeholder={t('kitchen.searchPlaceholder')} placeholderTextColor={theme.colors.muted} style={styles.searchInput} /></View><View style={styles.tabs}>{(['pending', 'served', 'all', 'noshow', 'logs'] as TabType[]).map((tab) => { const tabLabel = tab === 'pending' ? 'kitchen.tabPending' : tab === 'served' ? 'kitchen.tabServed' : tab === 'all' ? 'kitchen.tabAll' : tab === 'noshow' ? 'kitchen.tabNoShow' : 'kitchen.tabLogs'; const count = tab === 'pending' ? snapshot.lists.pending.length : tab === 'served' ? snapshot.lists.served.length : tab === 'all' ? snapshot.lists.all.length : tab === 'noshow' ? snapshot.lists.noShow?.length || counters.noShowTotal : snapshot.recentLogs.length; return <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]}><Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{t(tabLabel, { count })}</Text></Pressable>; })}</View>{activeTab === 'logs' ? logs.map((log) => <ListRow key={log.id} initials={initials(log.userName)} name={log.userName} detail={`${formatBusinessInstant(log.servedAt, locale)} · ${mealChoiceLabel(log.mealChoice)} · ${log.userEmail}`} status={log.isProxy ? t('kitchen.proxy') : t('kitchen.served')} good />) : selectedItems.map((item) => <ListRow key={item.registrationId} initials={initials(item.userName)} name={item.userName} detail={`${item.isServed && item.servedAt ? `${formatBusinessInstant(item.servedAt, locale)} · ` : ''}${mealChoiceLabel(item.mealChoice)} · ${item.userEmail}`} status={item.isServed ? t('kitchen.served') : activeTab === 'noshow' ? t('kitchen.noShow') : t('common.pending')} good={item.isServed} bad={activeTab === 'noshow'} />)}{!loading && selectedItems.length === 0 && logs.length === 0 && <Text style={styles.emptyText}>{t('kitchen.noMatchingRegistrations')}</Text>}</View>
          </>
        )}
      </StateTransition>
    </PrototypeFrame>
  );
}

function ListRow({ initials: avatarInitials, name, detail, status, good, bad }: { initials: string; name: string; detail: string; status: string; good: boolean; bad?: boolean }) {
  return <View style={styles.listRow}><View style={[styles.listAvatar, good && styles.listAvatarGood]}><Text style={[styles.listAvatarText, good && styles.listAvatarTextGood]}>{avatarInitials}</Text></View><View style={styles.listCopy}><Text style={styles.listName}>{name}</Text><Text style={styles.listDetail}>{detail}</Text></View><Pill tone={good ? 'good' : bad ? 'bad' : 'soft'}><PillText>{status}</PillText></Pill></View>;
}

const styles = StyleSheet.create({
  dashboardContent: { width: '100%' },
  errorCard: { marginTop: 20 },
  errorTitle: { color: theme.colors.fg, fontSize: 17, fontFamily: theme.typography.bold },
  errorText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19, marginTop: 8 },
  retryButton: { marginTop: 16 },
  servingCard: { marginBottom: 16 },
  servingActive: { backgroundColor: theme.colors.accentTint, borderColor: theme.colors.accentSoft },
  servingInfo: { marginBottom: 20 },
  servingTitle: { color: theme.colors.fg, fontSize: 21, fontFamily: theme.typography.bold },
  servingSub: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.regular, marginTop: 4 },
  sliderTrack: { height: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.pill, backgroundColor: theme.colors.canvas, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.accentSoft },
  sliderFillActive: { backgroundColor: theme.colors.accentDeep },
  sliderThumb: { position: 'absolute', left: 4, top: 4, width: 44, height: 44, borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', ...theme.shadows.sm },
  sliderHint: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.semiBold },
  sliderHintActive: { color: theme.colors.surface },
  serviceMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, minWidth: 0 },
  serviceMetaText: { flexShrink: 1, minWidth: 0, color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  metricsGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  metricsGridStacked: { flexDirection: 'column' },
  metricsColumnLeft: { flex: 2, minWidth: 0 },
  metricsColumnRight: { flex: 3, minWidth: 0, gap: 12 },
  metricsColumnStacked: { flexGrow: 0, flexShrink: 1, width: '100%' },
  summaryHeading: { flexShrink: 1, minWidth: 0 },
  totalCard: { padding: 16 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  totalNumber: { color: theme.colors.fg, fontSize: 44, fontFamily: theme.typography.bold, lineHeight: 48 },
  totalUnit: { color: theme.colors.muted, fontSize: 15, fontFamily: theme.typography.semiBold },
  dietCard: { padding: 16 },
  dietBar: { height: 14, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: theme.radii.pill, marginTop: 14, backgroundColor: theme.colors.surface },
  regularSegment: { flex: 72, backgroundColor: theme.colors.muted, borderTopLeftRadius: 7, borderBottomLeftRadius: 7 },
  vegSegment: { flex: 28, backgroundColor: theme.colors.accentDeep, borderTopRightRadius: 7, borderBottomRightRadius: 7 },
  dietLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1, minWidth: 0 },
  legendCopy: { flexShrink: 1, minWidth: 0 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  regularDot: { backgroundColor: theme.colors.muted },
  vegDot: { backgroundColor: theme.colors.accentDeep },
  legendLabel: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular, flexShrink: 1, minWidth: 0 },
  legendNumber: { color: theme.colors.fg, fontSize: 15, fontFamily: theme.typography.fontMono, marginTop: 1, flexShrink: 1, minWidth: 0 },
  checkinCard: { padding: 16 },
  checkinHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  checkinRatio: { color: theme.colors.fg, fontFamily: theme.typography.fontMono, fontSize: 13, flexShrink: 1, minWidth: 0 },
  progressTrack: { height: 16, overflow: 'hidden', borderRadius: theme.radii.pill, backgroundColor: theme.colors.accentTint, marginTop: 14 },
  progressFill: { width: '100%', height: '100%', backgroundColor: theme.colors.accentDeep, transformOrigin: 'left' },
  checkinLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginTop: 16 },
  legendText: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular, flexShrink: 1, minWidth: 0 },
  scannerLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  scannerLinkText: { color: theme.colors.accentDeep, fontSize: 13, fontFamily: theme.typography.bold },
  listSection: { paddingTop: 18, borderTopWidth: 1, borderTopColor: theme.colors.border },
  listHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  listTitle: { color: theme.colors.fg, fontSize: 20, fontFamily: theme.typography.bold, flexShrink: 1, minWidth: 0 },
  syncText: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.regular, flexShrink: 1, minWidth: 0 },
  searchWrap: { minHeight: 46, marginVertical: 14, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.regular },
  tabs: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  tab: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radii.pill, backgroundColor: theme.colors.canvas },
  tabActive: { backgroundColor: theme.colors.accentSoft },
  tabText: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.semiBold },
  tabTextActive: { color: theme.colors.accentDeep },
  listRow: { minHeight: 66, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  listAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  listAvatarGood: { backgroundColor: theme.colors.statusGoodTint },
  listAvatarText: { color: theme.colors.accentDeep, fontSize: 12, fontFamily: theme.typography.bold },
  listAvatarTextGood: { color: theme.colors.statusGoodDeep },
  listCopy: { flex: 1, minWidth: 0, gap: 3 },
  listName: { color: theme.colors.fg, fontSize: 13, fontFamily: theme.typography.bold },
  listDetail: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.regular },
  emptyText: { color: theme.colors.muted, fontFamily: theme.typography.regular, textAlign: 'center', paddingVertical: 24 },
});
