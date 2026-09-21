import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { ActionButton, AppText, Surface } from '../../ui/components';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { designTokens } from '../../ui/designTokens';

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
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
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
    <AppFrame
      screenLoadingLabel={loading ? t('notifications.loading') : undefined}
      scrollProps={{
        refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />,
      }}
    >
      <SectionHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
      {unreadCount > 0 && <AppText variant="caption" tone="information" style={styles.unreadSummary}>{t('notifications.unreadCount', { count: unreadCount })}</AppText>}
      {notificationStatus && (
        <Surface style={[styles.permissionCard, compactLayout && styles.permissionCardCompact]}>
          <View style={styles.permissionCopy}>
            <AppText variant="body">{t('notifications.systemStatus')}</AppText>
            <AppText variant="supporting" tone="secondary">{notificationStatus}</AppText>
          </View>
          {permissionStatus === 'denied' && <ActionButton icon={Settings} variant="secondary" size="md" label={t('notifications.openSettings')} onPress={() => void openSettings()} style={compactLayout && styles.permissionAction} />}
        </Surface>
      )}
      {configurationError && <AppText variant="supporting" tone="critical" style={styles.errorText}>{configurationError}</AppText>}
      <StateTransition stateKey={error && items.length === 0 ? 'error' : items.length === 0 ? 'empty' : 'ready'}>
        {error && items.length === 0 ? (
          <Surface style={styles.stateCard}>
            <AppText variant="cardTitle">{t('notifications.loadFailed')}</AppText>
            <AppText variant="body" tone="secondary">{getMobileErrorMessage(error, t, 'errors.loadNotifications')}</AppText>
            <ActionButton variant="primary" size="md" label={t('common.retry')} onPress={() => void load(true)} />
          </Surface>
        ) : items.length === 0 ? (
          <Surface style={styles.stateCard}>
            <Bell size={26} color={designTokens.color.text.secondary} />
            <AppText variant="cardTitle">{t('notifications.empty')}</AppText>
            <AppText variant="body" tone="secondary">{t('notifications.emptyHint')}</AppText>
          </Surface>
        ) : (
          <View style={styles.groups}>{groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <AppText variant="eyebrow" tone="secondary" style={styles.groupLabel}>{group.label}</AppText>
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
                    <View style={styles.itemCopy}>
                      <AppText variant="cardTitle" style={unread && styles.itemTitleUnread}>{copy.title}</AppText>
                      <AppText variant="supporting" tone="secondary">{copy.body}</AppText>
                      <AppText variant="caption" tone="tertiary">{new Date(item.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}</AppText>
                    </View>
                    <ChevronRight size={17} color={designTokens.color.text.secondary} />
                  </Pressable>
                );
              })}
            </View>
          ))}</View>
        )}
      </StateTransition>
      {hasNextPage && !error && (
        <ActionButton variant="secondary" size="md" disabled={loadingMore} label={loadingMore ? t('notifications.loadingMore') : t('notifications.loadMore')} onPress={() => void load(false)} />
      )}
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  unreadSummary: { marginBottom: designTokens.space.md },
  permissionCard: {
    marginBottom: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.md,
  },
  permissionCardCompact: { flexDirection: 'column' },
  permissionAction: { alignSelf: 'stretch' },
  permissionCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  errorText: { marginBottom: designTokens.space.md },
  stateCard: { alignItems: 'center', gap: designTokens.space.md, marginTop: designTokens.space.xl },
  groups: { gap: designTokens.space.xl },
  group: { gap: designTokens.space.sm },
  groupLabel: { letterSpacing: 0.8 },
  item: {
    minHeight: 84,
    padding: designTokens.space.md,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.heroCard,
    backgroundColor: designTokens.color.surface.standard,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
  },
  itemPressed: { backgroundColor: designTokens.color.brand.tint },
  itemMarker: { width: designTokens.space.sm, alignSelf: 'stretch', justifyContent: 'flex-start', paddingTop: designTokens.space.xs },
  unreadDot: { width: designTokens.space.sm, height: designTokens.space.sm, borderRadius: designTokens.space.xs, backgroundColor: designTokens.color.brand.primary },
  itemCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  itemTitleUnread: { fontFamily: designTokens.typography.family.bold },
});
