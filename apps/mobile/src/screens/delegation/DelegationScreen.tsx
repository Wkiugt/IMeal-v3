import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle, Clock, Search, XCircle } from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { delegationAPI, type DelegationResponse } from '../../api/delegationAPI';
import { PrototypeButton, PrototypeCard, PrototypeField, Pill, PillText } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useNotice } from '../../ui/BrandNotice';
import { theme } from '../../theme';

type Tab = 'OUTGOING' | 'INCOMING';
type Props = ProfileStackScreenProps<'Delegation'>;
export function DelegationScreen({ navigation }: Props) {
  const { token } = useSession();
  const { showNotice } = useNotice();
  const [tab, setTab] = useState<Tab>('OUTGOING');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [delegations, setDelegations] = useState<DelegationResponse[]>([]);
  const delegationRequestId = useRef(0);
  const activeTabRef = useRef<Tab>('OUTGOING');

  const loadDelegations = useCallback(async (targetTab: Tab) => {
    if (!token || activeTabRef.current !== targetTab) return;
    const requestId = ++delegationRequestId.current;
    setLoadError(null);
    setLoading(true);
    try {
      const data = await delegationAPI.getDelegations(token, targetTab === 'INCOMING' ? 'incoming' : 'outgoing');
      if (requestId !== delegationRequestId.current || activeTabRef.current !== targetTab) return;
      setDelegations(data);
    } catch (error: unknown) {
      if (requestId !== delegationRequestId.current || activeTabRef.current !== targetTab) return;
      const message = error instanceof Error ? error.message : 'Unable to load delegations';
      setLoadError(message);
      showNotice({ title: 'Delegations unavailable', message, tone: 'error' });
    } finally {
      if (requestId === delegationRequestId.current && activeTabRef.current === targetTab) setLoading(false);
    }
  }, [showNotice, token]);

  useEffect(() => {
    void loadDelegations(tab);
    return () => {
      delegationRequestId.current += 1;
    };
  }, [loadDelegations, tab]);

  const selectTab = (nextTab: Tab) => {
    if (nextTab === activeTabRef.current) return;
    activeTabRef.current = nextTab;
    setDelegations([]);
    setLoadError(null);
    setLoading(true);
    setTab(nextTab);
  };

  const handleAction = async (action: 'accept' | 'decline' | 'revoke', id: string) => {
    if (!token) return;
    const startingTab = activeTabRef.current;
    setLoading(true);
    try {
      if (action === 'accept') await delegationAPI.acceptDelegation(id, token);
      if (action === 'decline') await delegationAPI.declineDelegation(id, token);
      if (action === 'revoke') await delegationAPI.revokeDelegation(id, token);
      if (activeTabRef.current === startingTab) await loadDelegations(startingTab);
    } catch (error: unknown) {
      if (activeTabRef.current === startingTab) setLoading(false);
      showNotice({ title: 'Action failed', message: error instanceof Error ? error.message : 'The delegation state has changed.', tone: 'error' });
    }
  };

  const visible = delegations.filter((delegation) => tab === 'INCOMING' || delegation.delegateUserId.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <PrototypeFrame>
      <View style={styles.header}><Pressable accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={20} color={theme.colors.fg} /></Pressable><View style={styles.headerCopy}><PrototypeSectionTitle title="Delegations" subtitle="Manage meal pickup permissions" /></View></View>
      <View style={styles.tabs}><Pressable onPress={() => selectTab('OUTGOING')} style={[styles.tab, tab === 'OUTGOING' && styles.activeTab]}><Text style={[styles.tabText, tab === 'OUTGOING' && styles.activeTabText]}>My Requests</Text></Pressable><Pressable onPress={() => selectTab('INCOMING')} style={[styles.tab, tab === 'INCOMING' && styles.activeTab]}><Text style={[styles.tabText, tab === 'INCOMING' && styles.activeTabText]}>Incoming</Text></Pressable></View>
      {tab === 'OUTGOING' && <PrototypeField icon={Search} placeholder="Search employee by name/ID..." value={searchQuery} onChangeText={setSearchQuery} style={styles.search} />}
      <StateTransition stateKey={loading ? 'loading' : loadError && delegations.length === 0 ? 'error' : visible.length === 0 ? 'empty' : 'list'}>
        {loading ? (
          <BrandLoader label="Loading delegations…" />
        ) : loadError && delegations.length === 0 ? (
          <PrototypeCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>Delegations unavailable</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <PrototypeButton variant="secondary" onPress={() => void loadDelegations(activeTabRef.current)} style={styles.retryButton}>Retry</PrototypeButton>
          </PrototypeCard>
        ) : visible.length === 0 ? (
          <Text style={styles.empty}>No delegations found.</Text>
        ) : (
          <View style={styles.list}>{visible.map((item) => <PrototypeCard key={item.id} style={styles.card}><View style={styles.cardHeader}><Text style={styles.cardTitle}>{tab === 'OUTGOING' ? `To: ${item.delegateUserId}` : `From: ${item.delegateUserId}`}</Text><Status status={item.status} /></View><Text style={styles.cardDate}>Created: {new Date(item.createdAt).toLocaleDateString()}</Text>{item.status === 'PENDING' && <View style={styles.actions}>{tab === 'INCOMING' ? <><Pressable onPress={() => void handleAction('decline', item.id)} style={styles.secondaryAction}><Text style={styles.secondaryText}>Decline</Text></Pressable><Pressable onPress={() => void handleAction('accept', item.id)} style={styles.primaryAction}><Text style={styles.primaryText}>Accept</Text></Pressable></> : <Pressable onPress={() => void handleAction('revoke', item.id)} style={styles.dangerAction}><Text style={styles.dangerText}>Revoke</Text></Pressable>}</View>}</PrototypeCard>)}</View>
        )}
      </StateTransition>
    </PrototypeFrame>
  );
}

function Status({ status }: { status: DelegationResponse['status'] }) {
  const pending = status === 'PENDING';
  const accepted = status === 'ACCEPTED';
  const tone = pending ? 'warn' : accepted ? 'good' : 'bad';
  const Icon = pending ? Clock : accepted ? CheckCircle : XCircle;
  const label = pending ? 'Pending' : accepted ? 'Accepted' : status === 'DECLINED' ? 'Declined' : 'Revoked';
  return <Pill tone={tone}><View style={styles.status}><Icon size={14} color={pending ? theme.colors.statusWarnDeep : accepted ? theme.colors.statusGoodDeep : theme.colors.statusBadDeep} /><PillText>{label}</PillText></View></Pill>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: theme.colors.accentDeep },
  tabText: { color: theme.colors.muted, fontSize: 14, fontWeight: '500' },
  activeTabText: { color: theme.colors.accentDeep, fontWeight: '700' },
  search: { marginVertical: 16 },
  empty: { color: theme.colors.muted, textAlign: 'center', marginTop: 24 },
  errorCard: { marginTop: 20 },
  errorTitle: { color: theme.colors.fg, fontSize: 17, fontWeight: '700' },
  errorText: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  retryButton: { marginTop: 16 },
  list: { gap: 12, paddingVertical: 8 },
  card: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardTitle: { flex: 1, color: theme.colors.fg, fontSize: 15, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDate: { color: theme.colors.muted, fontSize: 13, marginBottom: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  secondaryAction: { minHeight: 40, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.fg, fontSize: 13, fontWeight: '600' },
  primaryAction: { minHeight: 40, paddingHorizontal: 16, borderRadius: theme.radii.sm, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.colors.surface, fontSize: 13, fontWeight: '700' },
  dangerAction: { minHeight: 40, paddingHorizontal: 16, borderRadius: theme.radii.sm, backgroundColor: theme.colors.statusBadTint, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: theme.colors.statusBadDeep, fontSize: 13, fontWeight: '700' },
});
