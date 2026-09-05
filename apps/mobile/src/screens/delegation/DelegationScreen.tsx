import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  ArrowLeft,
} from 'lucide-react-native';
import { theme } from '../../theme';
import { delegationAPI, DelegationResponse } from '../../api/delegationAPI';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';

type Tab = 'OUTGOING' | 'INCOMING';

type Props = NativeStackScreenProps<RootStackParamList, 'Delegation'>;

export function DelegationScreen({ route }: Props) {
  const token = route.params.token;
  const [tab, setTab] = useState<Tab>('OUTGOING');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [delegations, setDelegations] = useState<DelegationResponse[]>([]);

  useEffect(() => {
    loadDelegations();
  }, [tab]);

  const loadDelegations = async () => {
    setLoading(true);
    try {
      const data = await delegationAPI.getDelegations(
        token,
        tab === 'INCOMING' ? 'incoming' : 'outgoing',
      );
      setDelegations(data);
    } catch (error: unknown) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Unable to load delegations',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (
    action: 'accept' | 'decline' | 'revoke',
    id: string,
  ) => {
    setLoading(true);
    try {
      if (action === 'accept') {
        await delegationAPI.acceptDelegation(id, token);
      } else if (action === 'decline') {
        await delegationAPI.declineDelegation(id, token);
      } else if (action === 'revoke') {
        await delegationAPI.revokeDelegation(id, token);
      }
      // Reload on success
      await loadDelegations();
    } catch (error: unknown) {
      Alert.alert(
        'Action Failed',
        error instanceof Error
          ? error.message
          : 'The meal might have already been served or state changed.',
      );
    } finally {
      setLoading(false);
    }
  };

  const renderStatus = (status: DelegationResponse['status']) => {
    switch (status) {
      case 'PENDING':
        return (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: theme.colors.statusWarnTint },
            ]}
          >
            <Clock
              size={14}
              color={theme.colors.statusWarnDeep}
              style={styles.statusIcon}
            />
            <Text
              style={[
                styles.statusText,
                { color: theme.colors.statusWarnDeep },
              ]}
            >
              Pending
            </Text>
          </View>
        );
      case 'ACCEPTED':
        return (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: theme.colors.statusGoodTint },
            ]}
          >
            <CheckCircle
              size={14}
              color={theme.colors.statusGoodDeep}
              style={styles.statusIcon}
            />
            <Text
              style={[
                styles.statusText,
                { color: theme.colors.statusGoodDeep },
              ]}
            >
              Accepted
            </Text>
          </View>
        );
      case 'DECLINED':
      case 'REVOKED':
        return (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: theme.colors.statusBadTint },
            ]}
          >
            <XCircle
              size={14}
              color={theme.colors.statusBadDeep}
              style={styles.statusIcon}
            />
            <Text
              style={[styles.statusText, { color: theme.colors.statusBadDeep }]}
            >
              {status === 'DECLINED' ? 'Declined' : 'Revoked'}
            </Text>
          </View>
        );
    }
  };

  const renderItem = ({ item }: { item: DelegationResponse }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {tab === 'OUTGOING'
            ? `To: ${item.delegateUserId}`
            : `From: ${item.delegateUserId}`}
        </Text>
        {renderStatus(item.status)}
      </View>
      <Text style={styles.cardDate}>
        Created: {new Date(item.createdAt).toLocaleDateString()}
      </Text>

      {item.status === 'PENDING' && (
        <View style={styles.actionRow}>
          {tab === 'INCOMING' ? (
            <>
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline]}
                onPress={() => handleAction('decline', item.id)}
              >
                <Text style={styles.btnOutlineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { marginLeft: 8 }]}
                onPress={() => handleAction('accept', item.id)}
              >
                <Text style={styles.btnPrimaryText}>Accept</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.btn, styles.btnDangerOutline]}
              onPress={() => handleAction('revoke', item.id)}
            >
              <Text style={styles.btnDangerOutlineText}>Revoke</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn}>
          <ArrowLeft size={24} color={theme.colors.fg} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delegations</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, tab === 'OUTGOING' && styles.activeTab]}
          onPress={() => setTab('OUTGOING')}
        >
          <Text
            style={[styles.tabText, tab === 'OUTGOING' && styles.activeTabText]}
          >
            My Requests
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'INCOMING' && styles.activeTab]}
          onPress={() => setTab('INCOMING')}
        >
          <Text
            style={[styles.tabText, tab === 'INCOMING' && styles.activeTabText]}
          >
            Incoming
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {tab === 'OUTGOING' && (
          <View style={styles.searchContainer}>
            <Search
              size={20}
              color={theme.colors.muted}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search employee by name/ID..."
              placeholderTextColor={theme.colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        )}

        {loading ? (
          <ActivityIndicator
            size="large"
            color={theme.colors.accentDeep}
            style={{ marginTop: 40 }}
          />
        ) : (
          <FlatList
            data={delegations.filter((d) =>
              tab === 'OUTGOING'
                ? d.delegateUserId
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase())
                : true,
            )}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No delegations found.</Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.fg,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.accentDeep,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.muted,
  },
  activeTabText: {
    color: theme.colors.accentDeep,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    backgroundColor: theme.colors.accentTint,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.fg,
  },
  listContainer: {
    padding: 16,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    ...theme.shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.fg,
  },
  cardDate: {
    fontSize: 13,
    color: theme.colors.muted,
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  btnOutlineText: {
    color: theme.colors.fg,
    fontWeight: '500',
    fontSize: 14,
  },
  btnPrimary: {
    backgroundColor: theme.colors.accentDeep,
  },
  btnPrimaryText: {
    color: theme.colors.surface,
    fontWeight: '500',
    fontSize: 14,
  },
  btnDangerOutline: {
    borderWidth: 1,
    borderColor: theme.colors.statusBadDeep,
    backgroundColor: theme.colors.statusBadTint,
  },
  btnDangerOutlineText: {
    color: theme.colors.statusBadDeep,
    fontWeight: '500',
    fontSize: 14,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.muted,
    marginTop: 24,
  },
});
