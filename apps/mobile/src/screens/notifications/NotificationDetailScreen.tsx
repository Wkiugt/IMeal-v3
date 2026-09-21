import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Settings } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NotificationItem } from '../../api/notificationAPI';
import { notificationAPI } from '../../api/notificationAPI';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useNotifications } from '../../notifications/NotificationProvider';
import type { AppTabParamList, NotificationStackParamList } from '../../navigation';
import { ActionButton, AppText, Surface } from '../../ui/components';
import { StateTransition } from '../../ui/BrandMotion';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { designTokens } from '../../ui/designTokens';

type Props = NativeStackScreenProps<NotificationStackParamList, 'NotificationDetail'>;
type TabNavigation = BottomTabNavigationProp<AppTabParamList>;

type NotificationAction =
  | { type: 'calendar'; mealDate?: string }
  | { type: 'pickup' }
  | { type: 'delegation' }
  | null;

function actionFor(item: NotificationItem): NotificationAction {
  switch (item.kind) {
    case 'REGISTRATION_OPENED':
      return { type: 'calendar', mealDate: item.payload.weekStart };
    case 'REGISTRATION_REMINDER':
      return { type: 'calendar', mealDate: item.payload.weekStart };
    case 'REGISTERED_MENU_CHANGED':
      return { type: 'calendar', mealDate: item.payload.mealDate };
    case 'PICKUP_REMINDER':
      return { type: 'pickup' };
    case 'DELEGATION_REQUESTED':
    case 'DELEGATION_ACCEPTED':
    case 'DELEGATION_DECLINED':
    case 'DELEGATION_REVOKED':
      return { type: 'delegation' };
    default:
      return null;
  }
}

export function NotificationDetailScreen({ navigation, route }: Props) {
  const { token } = useSession();
  const { language, locale, t } = useLanguage();
  const { openSettings, permissionStatus, configurationError, refreshUnread } = useNotifications();
  const tabNavigation = useNavigation<TabNavigation>();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [item, setItem] = useState<NotificationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [markReadError, setMarkReadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setMarkReadError(null);
    try {
      const response = await notificationAPI.getDetail(route.params.notificationId, token);
      setItem(response.data);
      try {
        const readResponse = await notificationAPI.markRead(response.data.id, token);
        setItem(readResponse.data);
        await refreshUnread();
      } catch (readError: unknown) {
        setMarkReadError(readError);
      }
    } catch (loadError: unknown) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [refreshUnread, route.params.notificationId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = item ? actionFor(item) : null;
  const performAction = () => {
    if (!action) return;
    if (action.type === 'calendar') {
      tabNavigation.navigate('EmployeeCalendar', action.mealDate ? { mealDate: action.mealDate } : undefined);
    } else if (action.type === 'pickup') {
      tabNavigation.navigate('PickupIntent');
    } else {
      tabNavigation.navigate('EmployeeProfile', { screen: 'Delegation' });
    }
  };
  const actionLabel = action?.type === 'calendar'
    ? t('notifications.openCalendar')
    : action?.type === 'pickup'
      ? t('notifications.openPickup')
      : action?.type === 'delegation'
        ? t('notifications.openDelegation')
        : null;

  return (
    <AppFrame screenLoadingLabel={loading ? t('notifications.loadingDetail') : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={() => navigation.goBack()}
        style={styles.back}
      >
        <ArrowLeft size={18} color={designTokens.color.brand.primary} />
        <AppText variant="buttonLabel" tone="information">{t('common.back')}</AppText>
      </Pressable>
      <SectionHeader title={t('notifications.detailTitle')} />
      <StateTransition stateKey={error ? 'error' : item ? 'ready' : 'empty'}>
        {error ? (
          <Surface style={styles.stateCard}>
            <Bell size={27} color={designTokens.color.semantic.critical.base} />
            <AppText variant="cardTitle">{t('notifications.detailLoadFailed')}</AppText>
            <AppText variant="body" tone="secondary">{getMobileErrorMessage(error, t, 'errors.loadNotification')}</AppText>
            <ActionButton variant="primary" size="md" label={t('common.retry')} onPress={() => void load()} />
          </Surface>
        ) : item ? (
          <View style={styles.content}>
            <Surface style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View style={styles.icon}><Bell size={20} color={designTokens.color.brand.primary} /></View>
                <View style={styles.headerCopy}>
                  <AppText variant="cardTitle">{item.copy[language].title}</AppText>
                  <AppText variant="caption" tone="tertiary">
                    {new Date(item.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })}
                  </AppText>
                </View>
              </View>
              <AppText variant="body">{item.copy[language].body}</AppText>
              {markReadError !== null && <AppText variant="supporting" tone="warning">{t('notifications.markReadFailed')}</AppText>}
            </Surface>
            {actionLabel && <ActionButton icon={ArrowRight} variant="primary" size="md" label={actionLabel} onPress={performAction} />}
          </View>
        ) : null}
      </StateTransition>
      {(permissionStatus === 'denied' || configurationError) && (
        <Surface style={[styles.permissionCard, compactLayout && styles.permissionCardCompact]}>
          <AppText variant="supporting" tone="warning" style={styles.permissionText}>
            {configurationError || t('notifications.denied')}
          </AppText>
          {permissionStatus === 'denied' && <ActionButton icon={Settings} variant="secondary" size="md" label={t('notifications.openSettings')} onPress={() => void openSettings()} style={compactLayout && styles.permissionAction} />}
        </Surface>
      )}
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  back: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  content: { gap: designTokens.space.lg },
  detailCard: { gap: designTokens.space.xl },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: designTokens.space.md },
  icon: {
    width: designTokens.size.controlMd,
    height: designTokens.size.controlMd,
    borderRadius: designTokens.radius.heroCard,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.brand.tint,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  stateCard: { alignItems: 'center', gap: designTokens.space.md, marginTop: designTokens.space.xl },
  permissionCard: { marginTop: designTokens.space.lg, gap: designTokens.space.md },
  permissionCardCompact: { flexDirection: 'column' },
  permissionText: { flexShrink: 1, minWidth: 0 },
  permissionAction: { alignSelf: 'stretch' },
});
