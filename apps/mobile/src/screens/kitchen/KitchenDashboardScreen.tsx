import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import {
  kitchenAPI,
  KitchenDashboardSnapshot,
  KitchenRegistrationItem,
  ServingLogItem,
} from '../../api/kitchenAPI';
import {
  Utensils,
  CheckCircle2,
  Clock,
  QrCode,
  Users,
  RefreshCw,
  Radio,
  UserX,
  Wifi,
  WifiOff,
  ChevronLeft,
} from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';

type TabType = 'pending' | 'served' | 'all' | 'noshow' | 'logs';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenDashboard'>;

export function KitchenDashboardScreen({ route, navigation }: Props) {
  const token = route.params.token;
  const isFocused = useIsFocused();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'reconnecting' | 'polling'
  >('polling');
  const [snapshot, setSnapshot] = useState<KitchenDashboardSnapshot | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingSignal, setTogglingSignal] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await kitchenAPI.getDashboardSnapshot(undefined, token);
      setSnapshot(data);
    } catch (error: unknown) {
      console.warn(
        'Dashboard fetch error:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    setConnectionStatus('polling');
    void fetchDashboard();
    const pollingInterval = setInterval(() => {
      void fetchDashboard();
    }, 5_000);

    return () => {
      clearInterval(pollingInterval);
    };
  }, [isFocused, fetchDashboard]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboard();
  };

  const handleToggleSignal = async (val: boolean) => {
    if (togglingSignal) return;
    setTogglingSignal(true);
    try {
      const res = await kitchenAPI.toggleServingSignal(val, undefined, token);
      if (snapshot) {
        setSnapshot({
          ...snapshot,
          isServingReady: res.isServingReady,
        });
      }
      Alert.alert(
        'Tín hiệu bếp',
        val
          ? 'Đã BẬT tín hiệu phục vụ! Nhân viên có thể quét nhận cơm.'
          : 'Đã TẮT tín hiệu phục vụ. Tạm dừng phát cơm.',
      );
    } catch (error: unknown) {
      Alert.alert(
        'Lỗi',
        error instanceof Error ? error.message : 'Không thể cập nhật tín hiệu',
      );
    } finally {
      setTogglingSignal(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1f5fc2" />
        <Text style={styles.loadingText}>Đang tải Kitchen Dashboard...</Text>
      </SafeAreaView>
    );
  }

  const counters = snapshot?.counters || {
    totalRegistered: 0,
    servedTotal: 0,
    remaining: 0,
    noShowTotal: 0,
  };

  const progressPercent =
    counters.totalRegistered > 0
      ? Math.round((counters.servedTotal / counters.totalRegistered) * 100)
      : 0;

  // Filter items based on search query
  const filterList = (items: KitchenRegistrationItem[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.userName.toLowerCase().includes(q) ||
        item.userEmail.toLowerCase().includes(q),
    );
  };

  const filterLogs = (items: ServingLogItem[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.userName.toLowerCase().includes(q) ||
        item.userEmail.toLowerCase().includes(q),
    );
  };

  const pendingList = filterList(snapshot?.lists.pending || []);
  const servedList = filterList(snapshot?.lists.served || []);
  const allList = filterList(snapshot?.lists.all || []);
  const noShowList = filterList(snapshot?.lists.noShow || []);
  const recentLogsList = filterLogs(snapshot?.recentLogs || []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.liveBadgeRow}>
            {connectionStatus === 'connected' ? (
              <>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>REALTIME LIVE (SSE)</Text>
              </>
            ) : connectionStatus === 'reconnecting' ? (
              <>
                <View
                  style={[styles.liveDot, { backgroundColor: '#8a6300' }]}
                />
                <Text style={[styles.liveBadgeText, { color: '#8a6300' }]}>
                  ĐANG KẾT NỐI LẠI...
                </Text>
              </>
            ) : (
              <>
                <View
                  style={[styles.liveDot, { backgroundColor: '#1f5fc2' }]}
                />
                <Text style={[styles.liveBadgeText, { color: '#1f5fc2' }]}>
                  REALTIME SYNC
                </Text>
              </>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {navigation.canGoBack() && (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <ChevronLeft size={24} color="#0f172a" />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Bếp Ăn Hôm Nay</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Ngày: {snapshot?.date || 'Hôm nay'} · Ca Trưa 10:30–13:30
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            size={18}
            color="#1f5fc2"
            style={
              refreshing ? { transform: [{ rotate: '45deg' }] } : undefined
            }
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Kitchen Signal Toggle Card */}
        <View style={styles.signalCard}>
          <View style={styles.signalLeft}>
            <Radio
              size={22}
              color={snapshot?.isServingReady ? '#1e7a4d' : '#8a6300'}
            />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.signalTitle}>Tín hiệu phục vụ suất ăn</Text>
              <Text style={styles.signalSubtitle}>
                {snapshot?.isServingReady
                  ? 'Đang mở phục vụ (Sẵn sàng quét QR)'
                  : 'Đang tắt phục vụ (Nhân viên chờ tín hiệu)'}
              </Text>
            </View>
          </View>
          <Switch
            value={snapshot?.isServingReady ?? false}
            onValueChange={handleToggleSignal}
            trackColor={{ false: '#e2e5ea', true: '#d7f0e0' }}
            thumbColor={snapshot?.isServingReady ? '#1e7a4d' : '#8a6300'}
            disabled={togglingSignal}
          />
        </View>

        {/* Counter Summary Grid: 4 Cards (Total, Served, Remaining, No-Show) */}
        <View style={styles.grid}>
          <View style={[styles.card, styles.totalCard]}>
            <Users size={18} color="#1f5fc2" />
            <Text style={styles.cardNumber}>{counters.totalRegistered}</Text>
            <Text style={styles.cardLabel}>Tổng đăng ký</Text>
          </View>

          <View style={[styles.card, styles.servedCard]}>
            <CheckCircle2 size={18} color="#1e7a4d" />
            <Text style={[styles.cardNumber, { color: '#1e7a4d' }]}>
              {counters.servedTotal}
            </Text>
            <Text style={styles.cardLabel}>Đã nhận</Text>
          </View>

          <View style={[styles.card, styles.pendingCard]}>
            <Clock size={18} color="#1f5fc2" />
            <Text style={[styles.cardNumber, { color: '#1f5fc2' }]}>
              {counters.remaining}
            </Text>
            <Text style={styles.cardLabel}>Chưa nhận</Text>
          </View>

          <View style={[styles.card, styles.noShowCard]}>
            <UserX size={18} color="#b3311f" />
            <Text style={[styles.cardNumber, { color: '#b3311f' }]}>
              {counters.noShowTotal}
            </Text>
            <Text style={styles.cardLabel}>Vắng mặt</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Tiến độ phục vụ</Text>
            <Text style={styles.progressRatio}>
              {counters.servedTotal} / {counters.totalRegistered} (
              {progressPercent}%)
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, Math.max(0, progressPercent))}%` },
              ]}
            />
          </View>
        </View>

        {/* Action Button: Go to Scanner */}
        <TouchableOpacity
          style={styles.scannerCTA}
          onPress={() => navigation.navigate('KitchenScanner', { token })}
        >
          <QrCode size={22} color="#ffffff" />
          <Text style={styles.scannerCTAText}>Mở Máy Quét Mã QR</Text>
        </TouchableOpacity>

        {/* Search Bar for Lists */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Tìm theo tên hoặc email nhân viên..."
            placeholderTextColor="#8a92a6"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Lists Tabs: Chưa nhận / Đã nhận / Tất cả / Vắng mặt / Nhật ký */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScroll}
        >
          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'pending' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('pending')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'pending' && styles.tabTextActive,
              ]}
            >
              Chưa nhận ({snapshot?.lists.pending.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'served' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('served')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'served' && styles.tabTextActive,
              ]}
            >
              Đã nhận ({snapshot?.lists.served.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'all' && styles.tabTextActive,
              ]}
            >
              Tất cả ({snapshot?.lists.all.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'noshow' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('noshow')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'noshow' && styles.tabTextActive,
              ]}
            >
              Vắng mặt ({snapshot?.lists.noShow?.length || counters.noShowTotal}
              )
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'logs' && styles.tabBtnActive]}
            onPress={() => setActiveTab('logs')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'logs' && styles.tabTextActive,
              ]}
            >
              Nhật ký ({snapshot?.recentLogs.length || 0})
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Tab Content */}
        <View style={styles.listContainer}>
          {/* TAB 1: Chưa nhận */}
          {activeTab === 'pending' && (
            <>
              {pendingList.length === 0 ? (
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? 'Không tìm thấy nhân viên phù hợp.'
                    : 'Tất cả nhân viên đã nhận phần cơm! 🎉'}
                </Text>
              ) : (
                pendingList.map((item) => (
                  <View key={item.registrationId} style={styles.listItem}>
                    <View style={styles.itemAvatar}>
                      <Text style={styles.avatarText}>
                        {item.userName.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.itemName}>{item.userName}</Text>
                      <Text style={styles.itemEmail}>{item.userEmail}</Text>
                    </View>
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>Chờ nhận</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* TAB 2: Đã nhận */}
          {activeTab === 'served' && (
            <>
              {servedList.length === 0 ? (
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? 'Không tìm thấy nhân viên phù hợp.'
                    : 'Chưa có phần cơm nào được xác nhận.'}
                </Text>
              ) : (
                servedList.map((item) => (
                  <View key={item.registrationId} style={styles.listItem}>
                    <View
                      style={[
                        styles.itemAvatar,
                        { backgroundColor: '#d7f0e0' },
                      ]}
                    >
                      <Text style={[styles.avatarText, { color: '#1e7a4d' }]}>
                        {item.userName.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.itemName}>{item.userName}</Text>
                      <Text style={styles.itemEmail}>
                        {item.servedAt
                          ? new Date(item.servedAt).toLocaleTimeString('vi-VN')
                          : 'Đã nhận'}
                      </Text>
                    </View>
                    <View style={styles.servedBadge}>
                      <Text style={styles.servedBadgeText}>Đã nhận ✓</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* TAB 3: Tất cả */}
          {activeTab === 'all' && (
            <>
              {allList.length === 0 ? (
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? 'Không tìm thấy nhân viên phù hợp.'
                    : 'Không có đăng ký nào trong ngày.'}
                </Text>
              ) : (
                allList.map((item) => (
                  <View key={item.registrationId} style={styles.listItem}>
                    <View
                      style={[
                        styles.itemAvatar,
                        item.isServed && { backgroundColor: '#d7f0e0' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.avatarText,
                          item.isServed && { color: '#1e7a4d' },
                        ]}
                      >
                        {item.userName.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.itemName}>{item.userName}</Text>
                      <Text style={styles.itemEmail}>
                        {item.isServed
                          ? `Đã nhận: ${item.servedAt ? new Date(item.servedAt).toLocaleTimeString('vi-VN') : 'Xong'}`
                          : item.userEmail}
                      </Text>
                    </View>
                    <View
                      style={
                        item.isServed ? styles.servedBadge : styles.pendingBadge
                      }
                    >
                      <Text
                        style={
                          item.isServed
                            ? styles.servedBadgeText
                            : styles.pendingBadgeText
                        }
                      >
                        {item.isServed ? 'Đã nhận ✓' : 'Chưa nhận'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* TAB 4: Vắng mặt */}
          {activeTab === 'noshow' && (
            <>
              {noShowList.length === 0 ? (
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? 'Không tìm thấy nhân viên phù hợp.'
                    : 'Không có nhân viên nào vắng mặt.'}
                </Text>
              ) : (
                noShowList.map((item) => (
                  <View key={item.registrationId} style={styles.listItem}>
                    <View
                      style={[
                        styles.itemAvatar,
                        { backgroundColor: '#fbdfd8' },
                      ]}
                    >
                      <Text style={[styles.avatarText, { color: '#b3311f' }]}>
                        {item.userName.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.itemName}>{item.userName}</Text>
                      <Text style={styles.itemEmail}>{item.userEmail}</Text>
                    </View>
                    <View style={styles.noShowBadge}>
                      <Text style={styles.noShowBadgeText}>Vắng mặt</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* TAB 5: Nhật ký */}
          {activeTab === 'logs' && (
            <>
              {recentLogsList.length === 0 ? (
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? 'Không tìm thấy nhật ký phù hợp.'
                    : 'Chưa có lịch sử phục vụ.'}
                </Text>
              ) : (
                recentLogsList.map((log) => (
                  <View key={log.id} style={styles.listItem}>
                    <View
                      style={[
                        styles.itemAvatar,
                        { backgroundColor: '#dde8fb' },
                      ]}
                    >
                      <Utensils size={18} color="#1f5fc2" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.itemName}>{log.userName}</Text>
                      <Text style={styles.itemEmail}>
                        {new Date(log.servedAt).toLocaleTimeString('vi-VN')} ·{' '}
                        {log.userEmail}
                      </Text>
                    </View>
                    {log.isProxy && (
                      <View style={styles.proxyBadge}>
                        <Text style={styles.proxyBadgeText}>Nhận hộ</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#5a606d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e5ea',
  },
  liveBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1e7a4d',
    marginRight: 6,
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1e7a4d',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#262c3b',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#5a606d',
    marginTop: 2,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f5fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  signalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e5ea',
  },
  signalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  signalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#262c3b',
  },
  signalSubtitle: {
    fontSize: 12,
    color: '#5a606d',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 8,
  },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e5ea',
    alignItems: 'center',
  },
  totalCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#1f5fc2',
  },
  servedCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#1e7a4d',
  },
  pendingCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#1f5fc2',
  },
  noShowCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#b3311f',
  },
  cardNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#262c3b',
    marginTop: 6,
  },
  cardLabel: {
    fontSize: 11,
    color: '#5a606d',
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
  progressCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e5ea',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#262c3b',
  },
  progressRatio: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e7a4d',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#f2f3f5',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1e7a4d',
    borderRadius: 5,
  },
  scannerCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f5fc2',
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 16,
    gap: 8,
    shadowColor: '#1f5fc2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  scannerCTAText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  searchContainer: {
    marginBottom: 14,
  },
  searchInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e5ea',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#262c3b',
  },
  tabsScroll: {
    paddingBottom: 4,
    gap: 8,
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e5ea',
  },
  tabBtnActive: {
    backgroundColor: '#1f5fc2',
    borderColor: '#1f5fc2',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5a606d',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  listContainer: {
    marginTop: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e5ea',
  },
  itemAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f5fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1f5fc2',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#262c3b',
  },
  itemEmail: {
    fontSize: 12,
    color: '#5a606d',
    marginTop: 2,
  },
  pendingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f7ecc7',
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8a6300',
  },
  servedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#d7f0e0',
  },
  servedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1e7a4d',
  },
  noShowBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#fbdfd8',
  },
  noShowBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#b3311f',
  },
  proxyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#dde8fb',
  },
  proxyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1f5fc2',
  },
  emptyText: {
    textAlign: 'center',
    color: '#5a606d',
    marginTop: 24,
    fontSize: 14,
  },
});
