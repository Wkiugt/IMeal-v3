import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { PrototypeButton, PrototypeCard } from '../../ui/PrototypePrimitives';
import { StateTransition } from '../../ui/BrandMotion';
import { PrototypeFrame, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

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
    <PrototypeFrame screenLoadingLabel={loading ? t('notifications.loadingDetail') : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={18} color={theme.colors.accentDeep} /><Text style={styles.backText}>{t('common.back')}</Text></Pressable>
      <PrototypeSectionTitle title={t('notifications.detailTitle')} />
      <StateTransition stateKey={error ? 'error' : item ? 'ready' : 'empty'}>
        {error ? (
          <PrototypeCard style={styles.stateCard}>
            <Bell size={27} color={theme.colors.statusBadDeep} />
            <Text style={styles.stateTitle}>{t('notifications.detailLoadFailed')}</Text>
            <Text style={styles.stateText}>{getMobileErrorMessage(error, t, 'errors.loadNotification')}</Text>
            <PrototypeButton onPress={() => void load()}>{t('common.retry')}</PrototypeButton>
          </PrototypeCard>
        ) : item ? (
          <View style={styles.content}>
            <PrototypeCard style={styles.detailCard}>
              <View style={styles.detailHeader}><View style={styles.icon}><Bell size={20} color={theme.colors.accentDeep} /></View><View style={styles.headerCopy}><Text style={styles.title}>{item.copy[language].title}</Text><Text style={styles.date}>{new Date(item.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })}</Text></View></View>
              <Text style={styles.body}>{item.copy[language].body}</Text>
              {markReadError !== null && <Text style={styles.recovery}>{t('notifications.markReadFailed')}</Text>}
            </PrototypeCard>
            {actionLabel && <PrototypeButton icon={ArrowRight} onPress={performAction}>{actionLabel}</PrototypeButton>}
          </View>
        ) : null}
      </StateTransition>
      {(permissionStatus === 'denied' || configurationError) && (
        <PrototypeCard style={styles.permissionCard}>
          <Text style={styles.permissionText}>{configurationError || t('notifications.denied')}</Text>
          {permissionStatus === 'denied' && <PrototypeButton icon={Settings} variant="secondary" onPress={() => void openSettings()}>{t('notifications.openSettings')}</PrototypeButton>}
        </PrototypeCard>
      )}
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7 },
  backText: { color: theme.colors.accentDeep, fontSize: 13, fontFamily: theme.typography.semiBold },
  content: { gap: 14 },
  detailCard: { gap: 20 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: theme.radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint },
  headerCopy: { flex: 1, gap: 5 },
  title: { color: theme.colors.fg, fontSize: 18, fontFamily: theme.typography.bold, lineHeight: 24 },
  date: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  body: { color: theme.colors.fg, fontSize: 15, lineHeight: 24, fontFamily: theme.typography.regular },
  recovery: { color: theme.colors.statusWarnDeep, fontSize: 12, lineHeight: 18, fontFamily: theme.typography.semiBold },
  stateCard: { alignItems: 'center', gap: 12, marginTop: 20 },
  stateTitle: { color: theme.colors.fg, fontSize: 16, fontFamily: theme.typography.bold, textAlign: 'center' },
  stateText: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontFamily: theme.typography.regular, textAlign: 'center' },
  permissionCard: { marginTop: 18, gap: 10 },
  permissionText: { color: theme.colors.statusWarnDeep, fontSize: 12, lineHeight: 18, fontFamily: theme.typography.semiBold },
});
