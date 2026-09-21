import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ArrowLeft, CheckCircle, Clock, Search, XCircle } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
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
import { ActionButton, AppText, StatusBadge, Surface, TextField } from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { formatBusinessInstant } from '../../businessDate';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { useLanguage } from '../../i18n/LanguageProvider';
import { designTokens } from '../../ui/designTokens';

type Tab = DelegationTab;
type Props = ProfileStackScreenProps<'Delegation'>;
export function DelegationScreen({ navigation }: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const isFocused = useIsFocused();
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
  const screenLoading = useScreenLoadingGate(isFocused, !initialLoading && !refreshing);
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

  useFocusEffect(
    useCallback(() => {
      void loadDelegations(activeTabRef.current);
      return () => {
        delegationRequestId.current += 1;
      };
    }, [loadDelegations, tab]),
  );

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
    <AppFrame screenLoadingLabel={screenLoading ? t('delegation.loading') : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('delegation.back')} onPress={() => navigation.goBack()} style={styles.back}>
          <ArrowLeft size={20} color={designTokens.color.text.strong} />
        </Pressable>
        <View style={styles.headerCopy}>
          <SectionHeader title={t('delegation.title')} subtitle={t('delegation.subtitle')} />
        </View>
      </View>
      <View style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'OUTGOING' }} onPress={() => selectTab('OUTGOING')} style={[styles.tab, tab === 'OUTGOING' && styles.activeTab]}>
          <AppText variant="buttonLabel" tone={tab === 'OUTGOING' ? 'information' : 'secondary'}>{t('delegation.myRequests')}</AppText>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'INCOMING' }} onPress={() => selectTab('INCOMING')} style={[styles.tab, tab === 'INCOMING' && styles.activeTab]}>
          <AppText variant="buttonLabel" tone={tab === 'INCOMING' ? 'information' : 'secondary'}>{t('delegation.incoming')}</AppText>
        </Pressable>
      </View>
      {tab === 'OUTGOING' && <TextField label={t('delegation.searchPlaceholder')} icon={Search} accessibilityLabel={t('delegation.searchPlaceholder')} placeholder={t('delegation.searchPlaceholder')} value={searchQuery} onChangeText={setSearchQuery} containerStyle={styles.search} />}
      {refreshing && activeCache.loaded && <AppText variant="caption" tone="secondary" style={styles.refreshing}>{t('delegation.refreshing')}</AppText>}
      <StateTransition stateKey={loadError && !activeCache.loaded ? 'error' : showTabLoading ? 'tab-loading' : visible.length === 0 ? 'empty' : 'list'}>
        {loadError && !activeCache.loaded ? (
          <Surface style={styles.errorCard}>
            <AppText variant="cardTitle">{t('delegation.unavailable')}</AppText>
            <AppText variant="body" tone="secondary">{getMobileErrorMessage(loadError, t, 'errors.loadDelegations')}</AppText>
            <ActionButton variant="secondary" size="md" label={t('common.retry')} onPress={() => void loadDelegations(activeTabRef.current)} style={styles.retryButton} />
          </Surface>
        ) : showTabLoading ? (
          <BrandLoader compact label={t(tab === 'INCOMING' ? 'delegation.loadingIncoming' : 'delegation.loadingOutgoing')} />
        ) : visible.length === 0 ? (
          <AppText variant="body" tone="secondary" style={styles.empty}>{t('delegation.empty')}</AppText>
        ) : (
          <View style={styles.list}>
            {visible.map((item) => (
              <Surface key={item.id} style={styles.card}>
                <View style={[styles.cardHeader, compactLayout && styles.cardHeaderCompact]}>
                  <AppText variant="cardTitle" style={styles.cardTitle}>{t(tab === 'OUTGOING' ? 'delegation.to' : 'delegation.from', { id: item.delegateUserId })}</AppText>
                  <Status status={item.status} />
                </View>
                <AppText variant="supporting" tone="secondary" style={styles.cardDate}>{t('delegation.createdAt', { date: formatBusinessInstant(item.createdAt, locale) })}</AppText>
                {item.status === 'PENDING' && (
                  <View style={[styles.actions, compactLayout && styles.actionsCompact]}>
                    {tab === 'INCOMING' ? (
                      <>
                        <ActionButton variant="secondary" size="md" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('decline', item.id)} label={t('delegation.decline')} style={styles.secondaryAction} />
                        <ActionButton variant="primary" size="md" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('accept', item.id)} label={t('delegation.accept')} style={styles.primaryAction} />
                      </>
                    ) : (
                      <ActionButton variant="critical" size="md" disabled={actionId === item.id || refreshing} onPress={() => void handleAction('revoke', item.id)} label={t('delegation.revoke')} style={styles.dangerAction} />
                    )}
                  </View>
                )}
              </Surface>
            ))}
          </View>
        )}
      </StateTransition>
    </AppFrame>
  );
}

function Status({ status }: { status: DelegationResponse['status'] }) {
  const { t } = useLanguage();
  const pending = status === 'PENDING';
  const accepted = status === 'ACCEPTED';
  const tone = pending ? 'warning' : accepted ? 'success' : 'critical';
  const Icon = pending ? Clock : accepted ? CheckCircle : XCircle;
  const label = pending
    ? t('delegation.pending')
    : accepted
      ? t('delegation.accepted')
      : status === 'DECLINED'
        ? t('delegation.declined')
        : t('delegation.revoked');
  return <StatusBadge label={label} tone={tone} icon={Icon} style={styles.statusBadge} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  back: { width: designTokens.size.touchMin, height: designTokens.size.touchMin, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: designTokens.color.border.standard },
  tab: { flex: 1, minHeight: designTokens.size.touchMin, paddingVertical: designTokens.space.sm, alignItems: 'center', justifyContent: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: designTokens.color.brand.primary },
  search: { marginVertical: designTokens.space.lg },
  refreshing: { marginBottom: designTokens.space.sm },
  empty: { textAlign: 'center', marginTop: designTokens.space.xl },
  errorCard: { marginTop: designTokens.space.xl, gap: designTokens.space.sm },
  retryButton: { marginTop: designTokens.space.sm },
  list: { gap: designTokens.space.md, paddingVertical: designTokens.space.sm },
  card: { padding: designTokens.space.lg },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: designTokens.space.sm, marginBottom: designTokens.space.sm },
  cardHeaderCompact: { flexDirection: 'column' },
  cardTitle: { flex: 1, minWidth: 0 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.xs },
  cardDate: { marginBottom: designTokens.space.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: designTokens.space.sm, borderTopWidth: 1, borderTopColor: designTokens.color.border.standard, paddingTop: designTokens.space.md },
  actionsCompact: { flexDirection: 'column', alignItems: 'stretch' },
  secondaryAction: { minWidth: 0 },
  primaryAction: { minWidth: 0 },
  dangerAction: { minWidth: 0 },
});
