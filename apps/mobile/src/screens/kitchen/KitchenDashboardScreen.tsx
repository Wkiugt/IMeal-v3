import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, PanResponder, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckCircle2, ChevronRight, Clock3, Radio, Search, Users, UserX, Utensils } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';
import { useSession } from '../../auth/session';
import { kitchenAPI, type KitchenDashboardSnapshot, type KitchenRegistrationItem, type ServingLogItem } from '../../api/kitchenAPI';
import { initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, kitchenNav } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

type TabType = 'pending' | 'served' | 'all' | 'noshow' | 'logs';
type Props = NativeStackScreenProps<RootStackParamList, 'KitchenDashboard'>;

export function KitchenDashboardScreen({ navigation }: Props) {
  const { token, profile } = useSession();
  const isFocused = useIsFocused();
  const [snapshot, setSnapshot] = useState<KitchenDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingSignal, setTogglingSignal] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const sliderX = useRef(new Animated.Value(0)).current;

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    try {
      setSnapshot(await kitchenAPI.getDashboardSnapshot(undefined, token));
    } catch (error: unknown) {
      if (!snapshot) Alert.alert('Dashboard unavailable', error instanceof Error ? error.message : 'Unable to load kitchen dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshot, token]);

  useEffect(() => {
    if (!isFocused) return;
    void fetchDashboard();
    const interval = setInterval(() => { void fetchDashboard(); }, 5_000);
    return () => clearInterval(interval);
  }, [fetchDashboard, isFocused]);

  const active = Boolean(snapshot?.isServingReady);
  const maxX = Math.max(0, trackWidth - 52);
  const settleSlider = (value: number) => Animated.spring(sliderX, { toValue: value, useNativeDriver: true, bounciness: 0 }).start();
  useEffect(() => { settleSlider(active ? maxX : 0); }, [active, maxX]);

  const toggleSignal = async (next: boolean) => {
    if (!token || togglingSignal) return;
    setTogglingSignal(true);
    try {
      const response = await kitchenAPI.toggleServingSignal(next, undefined, token);
      setSnapshot((current) => current ? { ...current, isServingReady: response.isServingReady } : current);
    } catch (error: unknown) {
      Alert.alert('Serving signal unavailable', error instanceof Error ? error.message : 'Unable to update serving signal');
      settleSlider(active ? maxX : 0);
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

  const counters = snapshot?.counters || { totalRegistered: 0, servedTotal: 0, remaining: 0, noShowTotal: 0 };
  const progress = counters.totalRegistered ? Math.min(1, counters.servedTotal / counters.totalRegistered) : 0;
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
  const go = (route: keyof RootStackParamList) => navigation.navigate(route as never);

  return (
    <PrototypeFrame activeRoute="KitchenDashboard" navItems={kitchenNav} onNavigate={go} scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchDashboard(); }} /> }} bottomClearance={130}>
      <View style={styles.greeting}><View><Eyebrow>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()} · KITCHEN</Eyebrow><Text style={styles.greetingName}>Today's Prep</Text></View><Avatar initials={initials(profile?.name, 'KS')} /></View>
      <PrototypeCard style={[styles.servingCard, active && styles.servingActive]}><View style={styles.servingInfo}><Text style={styles.servingTitle}>{active ? 'Serving is live' : 'Ready to Serve?'}</Text><Text style={styles.servingSub}>{active ? 'Kitchen is ready to scan tickets' : 'Slide to begin scanning tickets'}</Text></View><View onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} style={styles.sliderTrack} {...panResponder.panHandlers}><Animated.View style={[styles.sliderFill, active && styles.sliderFillActive, { width: sliderX.interpolate({ inputRange: [0, Math.max(1, maxX)], outputRange: ['0%', '100%'] }) }]} /><Animated.View style={[styles.sliderThumb, { transform: [{ translateX: sliderX }] }]}><ChevronRight size={20} color={active ? theme.colors.fg : theme.colors.accentDeep} /></Animated.View><Text style={[styles.sliderHint, active && styles.sliderHintActive]}>{active ? 'Slide to stop' : 'Slide to start'}</Text></View></PrototypeCard>
      <PrototypeCard style={styles.totalCard}><Eyebrow>TOTAL MEALS ORDERED TODAY</Eyebrow><View style={styles.totalRow}><Text style={styles.totalNumber}>{counters.totalRegistered}</Text><Text style={styles.totalUnit}>meals</Text></View><View style={styles.totalMeta}><Utensils size={16} color={theme.colors.accentDeep} /><Text style={styles.totalMetaText}>Lunch service · Canteen A, 12:00–13:00</Text></View></PrototypeCard>
      <PrototypeCard style={styles.dietCard}><Eyebrow>DIETARY PREFERENCES</Eyebrow><View style={styles.dietBar}><View style={styles.regularSegment} /><View style={styles.vegSegment} /></View><View style={styles.dietLegend}><View style={styles.legendItem}><View style={[styles.legendDot, styles.regularDot]} /><View><Text style={styles.legendLabel}>Regular</Text><Text style={styles.legendNumber}>{Math.round(counters.totalRegistered * 0.72)}</Text></View></View><View style={styles.legendItem}><View style={[styles.legendDot, styles.vegDot]} /><View><Text style={styles.legendLabel}>Vegetarian</Text><Text style={styles.legendNumber}>{counters.totalRegistered - Math.round(counters.totalRegistered * 0.72)}</Text></View></View></View></PrototypeCard>
      <PrototypeCard style={styles.checkinCard}><View style={styles.checkinHead}><Eyebrow>CHECK-IN PROGRESS</Eyebrow><Text style={styles.checkinRatio}>{counters.servedTotal} / {counters.totalRegistered}</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { transform: [{ scaleX: progress }] }]} /></View><View style={styles.checkinLegend}><Text style={styles.legendText}>Checked-in · {counters.servedTotal}</Text><Text style={styles.legendText}>Pending · {counters.remaining}</Text></View></PrototypeCard>
      <Pressable onPress={() => navigation.navigate('KitchenScanner')} style={styles.scannerLink}><Radio size={18} color={theme.colors.accentDeep} /><Text style={styles.scannerLinkText}>Open ticket scanner</Text></Pressable>
      <View style={styles.listSection}><View style={styles.listHeader}><Text style={styles.listTitle}>Today's registrations</Text><Text style={styles.syncText}>{loading ? 'Syncing…' : 'Auto-sync 5s'}</Text></View><View style={styles.searchWrap}><Search size={18} color={theme.colors.muted} /><TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search name or email..." placeholderTextColor={theme.colors.muted} style={styles.searchInput} /></View><View style={styles.tabs}>{(['pending', 'served', 'all', 'noshow', 'logs'] as TabType[]).map((tab) => <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]}><Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'pending' ? `Pending (${snapshot?.lists.pending.length || 0})` : tab === 'served' ? `Served (${snapshot?.lists.served.length || 0})` : tab === 'all' ? `All (${snapshot?.lists.all.length || 0})` : tab === 'noshow' ? `No-show (${snapshot?.lists.noShow?.length || counters.noShowTotal})` : `Logs (${snapshot?.recentLogs.length || 0})`}</Text></Pressable>)}</View>{activeTab === 'logs' ? logs.map((log) => <ListRow key={log.id} initials={initials(log.userName)} name={log.userName} detail={`${new Date(log.servedAt).toLocaleTimeString()} · ${log.userEmail}`} status={log.isProxy ? 'Proxy' : 'Served'} good />) : selectedItems.map((item) => <ListRow key={item.registrationId} initials={initials(item.userName)} name={item.userName} detail={item.isServed && item.servedAt ? new Date(item.servedAt).toLocaleTimeString() : item.userEmail} status={item.isServed ? 'Served' : activeTab === 'noshow' ? 'No-show' : 'Pending'} good={item.isServed} />)}{!loading && selectedItems.length === 0 && logs.length === 0 && <Text style={styles.emptyText}>No matching registrations.</Text>}</View>
    </PrototypeFrame>
  );
}

function ListRow({ initials: avatarInitials, name, detail, status, good }: { initials: string; name: string; detail: string; status: string; good: boolean }) {
  return <View style={styles.listRow}><View style={[styles.listAvatar, good && styles.listAvatarGood]}><Text style={[styles.listAvatarText, good && styles.listAvatarTextGood]}>{avatarInitials}</Text></View><View style={styles.listCopy}><Text style={styles.listName}>{name}</Text><Text style={styles.listDetail}>{detail}</Text></View><Pill tone={good ? 'good' : status === 'No-show' ? 'bad' : 'soft'}><PillText>{status}</PillText></Pill></View>;
}

const styles = StyleSheet.create({
  greeting: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 26 },
  greetingName: { marginTop: 6, color: theme.colors.fg, fontSize: 24, fontWeight: '700' },
  servingCard: { marginBottom: 16 },
  servingActive: { backgroundColor: theme.colors.accentTint, borderColor: theme.colors.accentSoft },
  servingInfo: { marginBottom: 20 },
  servingTitle: { color: theme.colors.fg, fontSize: 21, fontWeight: '700' },
  servingSub: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
  sliderTrack: { height: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.pill, backgroundColor: theme.colors.canvas, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.accentSoft },
  sliderFillActive: { backgroundColor: theme.colors.accentDeep },
  sliderThumb: { position: 'absolute', left: 4, top: 4, width: 44, height: 44, borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', ...theme.shadows.sm },
  sliderHint: { color: theme.colors.muted, fontSize: 14, fontWeight: '600' },
  sliderHintActive: { color: theme.colors.surface },
  totalCard: { marginBottom: 16 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  totalNumber: { color: theme.colors.fg, fontSize: 52, lineHeight: 56, fontWeight: '700' },
  totalUnit: { color: theme.colors.muted, fontSize: 15, fontWeight: '600' },
  totalMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border },
  totalMetaText: { color: theme.colors.muted, fontSize: 13 },
  dietCard: { marginBottom: 16 },
  dietBar: { height: 14, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: theme.radii.pill, marginTop: 14, backgroundColor: theme.colors.surface },
  regularSegment: { flex: 72, backgroundColor: theme.colors.muted, borderTopLeftRadius: 7, borderBottomLeftRadius: 7 },
  vegSegment: { flex: 28, backgroundColor: theme.colors.accentDeep, borderTopRightRadius: 7, borderBottomRightRadius: 7 },
  dietLegend: { flexDirection: 'row', gap: 22, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  regularDot: { backgroundColor: theme.colors.muted },
  vegDot: { backgroundColor: theme.colors.accentDeep },
  legendLabel: { color: theme.colors.muted, fontSize: 12 },
  legendNumber: { color: theme.colors.fg, fontSize: 15, fontFamily: theme.typography.fontMono, fontWeight: '700', marginTop: 1 },
  checkinCard: { marginBottom: 16 },
  checkinHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkinRatio: { color: theme.colors.fg, fontFamily: theme.typography.fontMono, fontSize: 13, fontWeight: '700' },
  progressTrack: { height: 16, overflow: 'hidden', borderRadius: theme.radii.pill, backgroundColor: theme.colors.accentTint, marginTop: 14 },
  progressFill: { width: '100%', height: '100%', backgroundColor: theme.colors.accentDeep, transformOrigin: 'left' },
  checkinLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  legendText: { color: theme.colors.muted, fontSize: 12 },
  scannerLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  scannerLinkText: { color: theme.colors.accentDeep, fontSize: 13, fontWeight: '700' },
  listSection: { paddingTop: 18, borderTopWidth: 1, borderTopColor: theme.colors.border },
  listHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  listTitle: { color: theme.colors.fg, fontSize: 20, fontWeight: '700' },
  syncText: { color: theme.colors.muted, fontSize: 11 },
  searchWrap: { minHeight: 46, marginVertical: 14, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: theme.colors.fg, fontSize: 14 },
  tabs: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  tab: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radii.pill, backgroundColor: theme.colors.canvas },
  tabActive: { backgroundColor: theme.colors.accentSoft },
  tabText: { color: theme.colors.muted, fontSize: 11, fontWeight: '600' },
  tabTextActive: { color: theme.colors.accentDeep },
  listRow: { minHeight: 66, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  listAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  listAvatarGood: { backgroundColor: theme.colors.statusGoodTint },
  listAvatarText: { color: theme.colors.accentDeep, fontSize: 12, fontWeight: '700' },
  listAvatarTextGood: { color: theme.colors.statusGoodDeep },
  listCopy: { flex: 1, gap: 3 },
  listName: { color: theme.colors.fg, fontSize: 13, fontWeight: '700' },
  listDetail: { color: theme.colors.muted, fontSize: 11 },
  emptyText: { color: theme.colors.muted, textAlign: 'center', paddingVertical: 24 },
});
