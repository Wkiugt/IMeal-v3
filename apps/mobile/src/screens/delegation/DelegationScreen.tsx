import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle, Clock, Search, XCircle } from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { delegationAPI, type DelegationResponse } from '../../api/delegationAPI';
import {
  cacheDelegations,
  createDelegationCache,
  getDelegationsForTab,
  type DelegationCache,
  type DelegationTab,
} from './delegationState';
import { PrototypeButton, PrototypeCard, PrototypeField, Pill, PillText } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useInitialLoadingGate } from '../../ui/useInitialLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { formatBusinessInstant } from '../../businessDate';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';

type Tab = DelegationTab;
type Props = ProfileStackScreenProps<'Delegation'>;
export function DelegationScreen({ navigation }: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const [tab, setTab] = useState<Tab>('OUTGOING');
  const [searchQuery, setSearchQuery] = useState('');
  const [dataByTab, setDataByTab] = useState<DelegationCache>(() => createDelegationCache());
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const delegationRequestId = useRef(0);
  const hasLoadedAnyData = useRef(false);
  const activeTabRef = useRef<Tab>('OUTGOING');
  const activeCache = dataByTab[tab];
  const initialGate = useInitialLoadingGate(
    initialLoading,
    Boolean(loadError && !activeCache.loaded),
  );
  const showLoading = initialGate || (initialLoading && !hasLoadedAnyData.current);
  const showTabLoading = !activeCache.loaded && refreshing;

  const loadDelegations = useCallback(async (targetTab: Tab) => {
    if (!token || activeTabRef.current !== targetTab) return;
    const requestId = ++delegationRequestId.current;
    setLoadError(null);
    if (hasLoadedAnyData.current) setRefreshing(true);
    else setInitialLoading(true);
    try {
      const data = await delegationAPI.getDelegations(token, targetTab === 'INCOMING' ? 'incoming' : 'outgoing');
      if (requestId !== delegationRequestId.current || activeTabRef.current !== targetTab) return;
      setDataByTab((current) => cacheDelegations(current, targetTab, data));
      hasLoadedAnyData.current = true;
    } catch (error: unknown) {
      if (requestId !== delegationRequestId.current || activeTabRef.current !== targetTab) return;
      const message = getMobileErrorMessage(error, t, 'errors.loadDelegations');
      setLoadError(error);
      showNotice({ title: t('delegation.unavailable'), message, tone: 'error' });
    } finally {
      if (requestId === delegationRequestId.current && activeTabRef.current === targetTab) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [showNotice, t, token]);

  useEffect(() => {
    void loadDelegations(tab);
    return () => {
      delegationRequestId.current += 1;
    };
  }, [loadDelegations, tab]);

  const selectTab = (nextTab: Tab) => {
    if (nextTab === activeTabRef.current) return;
    activeTabRef.current = nextTab;
    setLoadError(null);
    setRefreshing(true);
    setTab(nextTab);
  };

  const handleAction = async (action: 'accept' | 'decline' | 'revoke', id: string) => {
    if (!token || actionId !== null) return;
    const startingTab = activeTabRef.current;
    setActionId(id);
    try {
      if (action === 'accept') await delegationAPI.acceptDelegation(id, token);
      if (action === 'decline') await delegationAPI.declineDelegation(id, token);
      if (action === 'revoke') await delegationAPI.revokeDelegation(id, token);
      if (activeTabRef.current === startingTab) await loadDelegations(startingTab);
    } catch (error: unknown) {
      showNotice({
        title: t('delegation.actionFailed'),
        message: getMobileErrorMessage(error, t, 'errors.delegationAction'),
        tone: 'error',
      });
    } finally {
      setActionId(null);
    }
  };

  const visible = getDelegationsForTab(dataByTab, tab).filter((delegation) => tab === 'INCOMING' || delegation.delegateUserId.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <PrototypeFrame>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={t('delegation.back')} onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={20} color={theme.colors.fg} /></Pressable><View style={styles.headerCopy}><PrototypeSectionTitle title={t('delegation.title')} subtitle={t('delegation.subtitle')} /></View></View>
      <View style={styles.tabs}><Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'OUTGOING' }} onPress={() => selectTab('OUTGOING')} style={[styles.tab, tab === 'OUTGOING' && styles.activeTab]}><Text style={[styles.tabText, tab === 'OUTGOING' && styles.activeTabText]}>{t('delegation.myRequests')}</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'INCOMING' }} onPress={() => selectTab('INCOMING')} style={[styles.tab, tab === 'INCOMING' && styles.activeTab]}><Text style={[styles.tabText, tab === 'INCOMING' && styles.activeTabText]}>{t('delegation.incoming')}</Text></Pressable></View>
      {tab === 'OUTGOING' && <PrototypeField icon={Search} accessibilityLabel={t('delegation.searchPlaceholder')} placeholder={t('delegation.searchPlaceholder')} value={searchQuery} onChangeText={setSearchQuery} style={styles.search} />}
      {refreshing && activeCache.loaded && <Text style={styles.refreshing}>{t('delegation.refreshing')}</Text>}
      <StateTransition stateKey={showLoading ? 'loading' : loadError && !activeCache.loaded ? 'error' : showTabLoading ? 'tab-loading' : visible.length === 0 ? 'empty' : 'list'}>
        {showLoading ? (
          <BrandLoader label={t('delegation.loading')} />
        ) : loadError && !activeCache.loaded ? (
          <PrototypeCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('delegation.unavailable')}</Text>
            <Text style={styles.errorText}>{getMobileErrorMessage(loadError, t, 'errors.loadDelegations')}</Text>
            <PrototypeButton variant="secondary" onPress={() => void loadDelegations(activeTabRef.current)} style={styles.retryButton}>{t('common.retry')}</PrototypeButton>
          </PrototypeCard>
        ) : showTabLoading ? (
          <BrandLoader compact label={t(tab === 'INCOMING' ? 'delegation.loadingIncoming' : 'delegation.loadingOutgoing')} />
        ) : visible.length === 0 ? (
          <Text style={styles.empty}>{t('delegation.empty')}</Text>
        ) : (
          <View style={styles.list}>{visible.map((item) => <PrototypeCard key={item.id} style={styles.card}><View style={styles.cardHeader}><Text style={styles.cardTitle}>{t(tab === 'OUTGOING' ? 'delegation.to' : 'delegation.from', { id: item.delegateUserId })}</Text><Status status={item.status} /></View><Text style={styles.cardDate}>{t('delegation.createdAt', { date: formatBusinessInstant(item.createdAt, locale) })}</Text>{item.status === 'PENDING' && <View style={styles.actions}>{tab === 'INCOMING' ? <><Pressable accessibilityRole="button" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('decline', item.id)} style={styles.secondaryAction}><Text style={styles.secondaryText}>{t('delegation.decline')}</Text></Pressable><Pressable accessibilityRole="button" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('accept', item.id)} style={styles.primaryAction}><Text style={styles.primaryText}>{t('delegation.accept')}</Text></Pressable></> : <Pressable accessibilityRole="button" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('revoke', item.id)} style={styles.dangerAction}><Text style={styles.dangerText}>{t('delegation.revoke')}</Text></Pressable>}</View>}</PrototypeCard>)}</View>
        )}
      </StateTransition>
    </PrototypeFrame>
  );
}

function Status({ status }: { status: DelegationResponse['status'] }) {
  const { t } = useLanguage();
  const pending = status === 'PENDING';
  const accepted = status === 'ACCEPTED';
  const tone = pending ? 'warn' : accepted ? 'good' : 'bad';
  const Icon = pending ? Clock : accepted ? CheckCircle : XCircle;
  const label = pending
    ? t('delegation.pending')
    : accepted
      ? t('delegation.accepted')
      : status === 'DECLINED'
        ? t('delegation.declined')
        : t('delegation.revoked');
  return <Pill tone={tone}><View style={styles.status}><Icon size={14} color={pending ? theme.colors.statusWarnDeep : accepted ? theme.colors.statusGoodDeep : theme.colors.statusBadDeep} /><PillText>{label}</PillText></View></Pill>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: theme.colors.accentDeep },
  tabText: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.medium },
  activeTabText: { color: theme.colors.accentDeep, fontFamily: theme.typography.bold },
  search: { marginVertical: 16 },
  refreshing: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular, marginBottom: 8 },
  empty: { color: theme.colors.muted, fontFamily: theme.typography.regular, textAlign: 'center', marginTop: 24 },
  errorCard: { marginTop: 20 },
  errorTitle: { color: theme.colors.fg, fontSize: 17, fontFamily: theme.typography.bold },
  errorText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19, marginTop: 8 },
  retryButton: { marginTop: 16 },
  list: { gap: 12, paddingVertical: 8 },
  card: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardTitle: { flex: 1, color: theme.colors.fg, fontSize: 15, fontFamily: theme.typography.bold },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDate: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, marginBottom: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  secondaryAction: { minHeight: 40, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.fg, fontSize: 13, fontFamily: theme.typography.semiBold },
  primaryAction: { minHeight: 40, paddingHorizontal: 16, borderRadius: theme.radii.sm, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.colors.surface, fontSize: 13, fontFamily: theme.typography.bold },
  dangerAction: { minHeight: 40, paddingHorizontal: 16, borderRadius: theme.radii.sm, backgroundColor: theme.colors.statusBadTint, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: theme.colors.statusBadDeep, fontSize: 13, fontFamily: theme.typography.bold },
});
