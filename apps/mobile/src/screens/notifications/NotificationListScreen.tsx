import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Settings } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationItem } from '../../api/notificationAPI';
import { notificationAPI } from '../../api/notificationAPI';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useNotifications } from '../../notifications/NotificationProvider';
import type { NotificationStackParamList } from '../../navigation';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { PrototypeButton, PrototypeCard } from '../../ui/PrototypePrimitives';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

type Props = NativeStackScreenProps<NotificationStackParamList, 'NotificationList'>;
type NotificationGroup = { key: string; label: string; items: NotificationItem[] };

function groupNotifications(items: NotificationItem[], locale: 'vi-VN' | 'en-US'): NotificationGroup[] {
  const grouped = new Map<string, NotificationGroup>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = date.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const existing = grouped.get(key);
    const next = existing ?? {
      key,
      label: date.toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }),
      items: [],
    };
    next.items.push(item);
    grouped.set(key, next);
  }
  return Array.from(grouped.values());
}

export function NotificationListScreen({ navigation }: Props) {
  const { token } = useSession();
  const { locale, language, t } = useLanguage();
  const { unreadCount, permissionStatus, configurationError, openSettings, refreshUnread } = useNotifications();
  const isFocused = useIsFocused();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (reset: boolean) => {
    if (!token) return;
    if (reset) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const response = await notificationAPI.getList(token, { cursor: reset ? undefined : nextCursorRef.current ?? undefined, limit: 20 });
      setItems((current) => reset ? response.data : [...current, ...response.data]);
      nextCursorRef.current = response.meta.nextCursor;
      setHasNextPage(response.meta.hasNextPage);
      setError(null);
      await refreshUnread();
    } catch (loadError: unknown) {
      if (reset) setError(loadError);
    } finally {
      if (reset) setLoading(false);
      else setLoadingMore(false);
      setRefreshing(false);
    }
  }, [refreshUnread, token]);

  useFocusEffect(useCallback(() => {
    void load(true);
  }, [load]));

  useEffect(() => {
    if (isFocused) void refreshUnread();
  }, [isFocused, refreshUnread]);

  const groups = useMemo(() => groupNotifications(items, locale), [items, locale]);
  const notificationStatus = permissionStatus === 'granted'
    ? t('notifications.enabled')
    : permissionStatus === 'denied'
      ? t('notifications.denied')
      : permissionStatus === 'simulator'
        ? t('notifications.physicalDeviceRequired')
        : null;

  return (
    <PrototypeFrame
      screenLoadingLabel={loading ? t('notifications.loading') : undefined}
      scrollProps={{
        refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />,
      }}
    >
      <PrototypeSectionTitle title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
      {unreadCount > 0 && <Text style={styles.unreadSummary}>{t('notifications.unreadCount', { count: unreadCount })}</Text>}
      {notificationStatus && (
        <PrototypeCard style={styles.permissionCard}>
          <View style={styles.permissionCopy}><Text style={styles.permissionTitle}>{t('notifications.systemStatus')}</Text><Text style={styles.permissionText}>{notificationStatus}</Text></View>
          {permissionStatus === 'denied' && <PrototypeButton icon={Settings} variant="secondary" onPress={() => void openSettings()}>{t('notifications.openSettings')}</PrototypeButton>}
        </PrototypeCard>
      )}
      {configurationError && <Text style={styles.errorText}>{configurationError}</Text>}
      <StateTransition stateKey={error && items.length === 0 ? 'error' : items.length === 0 ? 'empty' : 'ready'}>
        {error && items.length === 0 ? (
          <PrototypeCard style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t('notifications.loadFailed')}</Text>
            <Text style={styles.stateText}>{getMobileErrorMessage(error, t, 'errors.loadNotifications')}</Text>
            <PrototypeButton onPress={() => void load(true)}>{t('common.retry')}</PrototypeButton>
          </PrototypeCard>
        ) : items.length === 0 ? (
          <PrototypeCard style={styles.stateCard}>
            <Bell size={26} color={theme.colors.muted} />
            <Text style={styles.stateTitle}>{t('notifications.empty')}</Text>
            <Text style={styles.stateText}>{t('notifications.emptyHint')}</Text>
          </PrototypeCard>
        ) : (
          <View style={styles.groups}>{groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              {group.items.map((item) => {
                const copy = item.copy[language];
                const unread = item.readAt === null;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.title}
                    onPress={() => navigation.navigate('NotificationDetail', { notificationId: item.id })}
                    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                  >
                    <View style={styles.itemMarker}>{unread && <View style={styles.unreadDot} />}</View>
                    <View style={styles.itemCopy}><Text style={[styles.itemTitle, unread && styles.itemTitleUnread]} numberOfLines={2}>{copy.title}</Text><Text style={styles.itemBody} numberOfLines={2}>{copy.body}</Text><Text style={styles.itemTime}>{new Date(item.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}</Text></View>
                    <ChevronRight size={17} color={theme.colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          ))}</View>
        )}
      </StateTransition>
      {hasNextPage && !error && (
        <PrototypeButton variant="secondary" disabled={loadingMore} onPress={() => void load(false)}>
          {loadingMore ? t('notifications.loadingMore') : t('notifications.loadMore')}
        </PrototypeButton>
      )}
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  unreadSummary: { color: theme.colors.accentDeep, fontSize: 12, fontFamily: theme.typography.bold, marginBottom: 12 },
  permissionCard: { marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  permissionCopy: { flex: 1, gap: 4 },
  permissionTitle: { color: theme.colors.fg, fontSize: 13, fontFamily: theme.typography.bold },
  permissionText: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular, lineHeight: 18 },
  errorText: { color: theme.colors.statusBadDeep, fontSize: 12, fontFamily: theme.typography.semiBold, marginBottom: 12 },
  stateCard: { alignItems: 'center', gap: 12, marginTop: 20 },
  stateTitle: { color: theme.colors.fg, fontSize: 16, fontFamily: theme.typography.bold, textAlign: 'center' },
  stateText: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontFamily: theme.typography.regular, textAlign: 'center' },
  groups: { gap: 20 },
  group: { gap: 8 },
  groupLabel: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.bold, letterSpacing: 1 },
  item: { minHeight: 84, padding: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemPressed: { backgroundColor: theme.colors.accentTint },
  itemMarker: { width: 8, alignSelf: 'stretch', justifyContent: 'flex-start', paddingTop: 5 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accentDeep },
  itemCopy: { flex: 1, gap: 3 },
  itemTitle: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.semiBold },
  itemTitleUnread: { fontFamily: theme.typography.bold },
  itemBody: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontFamily: theme.typography.regular },
  itemTime: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.regular },
});
