import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI } from '../../api/registrationAPI';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { startOfWeek, toDateKey, formatDay, formatShortDate, initials } from '../../businessDate';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  Avatar,
  Divider,
  MealCard,
  StatusBadge,
  TicketActionCard,
} from '../../ui/components';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { designTokens, type SemanticTone } from '../../ui/designTokens';

type Props = AppTabScreenProps<'EmployeeDashboard'>;

export function EmployeeDashboardScreen({ navigation }: Props) {
  const { token, profile } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [todayRegistered, setTodayRegistered] = useState<boolean | null>(null);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const dashboardRequestId = useRef(0);

  useFocusEffect(
    React.useCallback(() => {
      if (!token) return undefined;
      const requestId = ++dashboardRequestId.current;
      setLoading(true);
      setSelectedCount(null);
      void registrationAPI.getWeek(toDateKey(startOfWeek(new Date())), token)
        .then(({ registrations }) => {
          if (requestId !== dashboardRequestId.current) return;
          const today = toDateKey(new Date());
          setTodayRegistered(registrations.some((registration) => registration.mealDate.slice(0, 10) === today && registration.status === 'ACTIVE'));
          setSelectedCount(registrations.filter((registration) => registration.status === 'ACTIVE').length);
        })
        .catch((error: unknown) => {
          if (requestId !== dashboardRequestId.current) return;
          setTodayRegistered(null);
          setSelectedCount(null);
          showNotice({
            title: t('dashboard.unavailable'),
            message: getMobileErrorMessage(error, t, 'errors.loadCalendar'),
            tone: 'error',
          });
        })
        .finally(() => {
          if (requestId === dashboardRequestId.current) setLoading(false);
        });
      return () => {
        dashboardRequestId.current += 1;
      };
    }, [showNotice, t, token]),
  );

  const screenLoading = useScreenLoadingGate(isFocused, !loading);
  const greetingName = profile?.name || profile?.email.split('@')[0] || t('profile.employeeAccount');
  const status = todayRegistered === true
    ? t('dashboard.confirmed')
    : todayRegistered === false
      ? t('dashboard.notRegistered')
      : t('dashboard.unavailable');
  const statusTone: SemanticTone = todayRegistered === true
    ? 'success'
    : todayRegistered === false
      ? 'neutral'
      : 'warning';
  const today = new Date();

  return (
    <AppFrame screenLoadingLabel={screenLoading ? t('dashboard.loadingRegistration') : undefined}>
      <View style={styles.greeting}>
        <View style={styles.greetingCopy}>
          <AppText variant="eyebrow" tone="secondary">
            {`${formatDay(today, locale)}, ${formatShortDate(today, locale)}`}
          </AppText>
          <AppText variant="sectionTitle" style={styles.greetingTitle}>
            {t('auth.greeting', { name: greetingName })}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.openProfile')}
          onPress={() => navigation.navigate('EmployeeProfile', { screen: 'ProfileHome' })}
          style={styles.avatarButton}
        >
          <Avatar initials={initials(profile?.name, 'ME')} />
        </Pressable>
      </View>

      <MealCard
        periodLabel={t('dashboard.lunchService')}
        status={{ label: status, tone: statusTone }}
        title={t('dashboard.mealName')}
        description={t('dashboard.mealDescription')}
        location={t('dashboard.location')}
        style={styles.mealCard}
        footer={selectedCount === null ? undefined : (
          <View style={styles.mealFooter}>
            <Divider style={styles.mealFooterDivider} />
            <StatusBadge
              label={t('pickup.selectedCount', { count: selectedCount })}
              tone="information"
              icon={CalendarDays}
            />
          </View>
        )}
      />

      <TicketActionCard
        title={t('dashboard.openMealTicket')}
        supportingText={t('dashboard.showDynamicQr')}
        accessibilityLabel={t('dashboard.openMealTicket')}
        onPress={() => navigation.navigate('PickupIntent')}
        style={styles.ticketAction}
      />

      <ActionButton
        variant="secondary"
        size="md"
        label={t('dashboard.manageWeeklyRegistration')}
        icon={CalendarDays}
        onPress={() => navigation.navigate('EmployeeCalendar')}
        style={styles.weeklyButton}
      />
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  greeting: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: designTokens.space.lg,
    paddingBottom: designTokens.space.xl,
  },
  greetingCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: designTokens.space.md,
  },
  greetingTitle: {
    marginTop: designTokens.space.sm,
  },
  avatarButton: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.full,
  },
  mealCard: {
    marginBottom: designTokens.space.lg,
  },
  mealFooter: {
    gap: designTokens.space.md,
  },
  mealFooterDivider: {
    marginBottom: designTokens.space.xs,
  },
  ticketAction: {
    marginBottom: designTokens.space.md,
  },
  weeklyButton: {
    alignSelf: 'stretch',
  },
});
