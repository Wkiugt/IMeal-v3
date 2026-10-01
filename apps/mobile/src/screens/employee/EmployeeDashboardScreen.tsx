import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI } from '../../api/registrationAPI';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import {
  formatDay,
  formatShortDate,
  parseDateKey,
  startOfWeek,
  toBusinessDateKey,
  toDateKey,
  initials,
} from '../../businessDate';
import {
  projectHomeToday,
  countHomeWeekRegistrations,
  type HomeLifecycle,
} from './dashboardState';
import type { HomeProjection } from './dashboardState';
import { AppFrame } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  Avatar,
  Divider,
  MealCard,
  StatusBadge,
  Surface,
  TicketActionCard,
} from '../../ui/components';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { TranslationKey } from '../../i18n/translations';
import { designTokens, type SemanticTone } from '../../ui/designTokens';

type Props = AppTabScreenProps<'EmployeeDashboard'>;
type DashboardData = {
  today: HomeProjection;
  businessDate: string;
  registeredCount: number;
  enabledMenuDays: number;
};

const LIFECYCLE_KEYS: Record<HomeLifecycle, TranslationKey> = {
  ACTIVE: 'dashboard.todayActive',
  SERVED: 'dashboard.todayServed',
  NO_SHOW: 'dashboard.todayNoShow',
  CANCELLED: 'dashboard.todayCancelled',
  UNREGISTERED: 'dashboard.todayUnregistered',
  NO_MENU: 'dashboard.todayNoMenu',
};

const LIFECYCLE_TONES: Record<HomeLifecycle, SemanticTone> = {
  ACTIVE: 'success',
  SERVED: 'success',
  NO_SHOW: 'warning',
  CANCELLED: 'neutral',
  UNREGISTERED: 'neutral',
  NO_MENU: 'warning',
};

export function EmployeeDashboardScreen({ navigation }: Props) {
  const { token, profile } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const dashboardRequestId = useRef(0);
  const dataRef = useRef<DashboardData | null>(null);
  dataRef.current = data;

  useFocusEffect(
    React.useCallback(() => {
      if (!token) return undefined;
      const requestId = ++dashboardRequestId.current;
      setLoading(true);
      const load = async () => {
        try {
          const initialStart = toDateKey(startOfWeek(new Date()));
          let response = await registrationAPI.getWeek(initialStart, token);
          const businessDate = toBusinessDateKey(
            response.registrationWindow.serverNow,
          );
          const businessWeekStart = toDateKey(
            startOfWeek(parseDateKey(businessDate)),
          );
          if (businessWeekStart !== initialStart) {
            response = await registrationAPI.getWeek(businessWeekStart, token);
          }
          if (requestId !== dashboardRequestId.current) return;
          const todayKey = toBusinessDateKey(
            response.registrationWindow.serverNow,
          );
          const todayDay = response.days.find(
            (day) => day.mealDate === todayKey,
          );
          if (!todayDay) {
            throw new Error(
              `Week response did not include business date ${todayKey}`,
            );
          }
          const enabledMenuDays = response.days.filter(
            (day) =>
              day.menu !== null &&
              day.menu.isEnabled &&
              !day.menu.isHoliday &&
              day.menu.menuRevisionId !== null &&
              day.menu.mealName !== null,
          ).length;
          setData({
            today: projectHomeToday(todayDay),
            businessDate: todayKey,
            registeredCount: countHomeWeekRegistrations(response.days),
            enabledMenuDays,
          });
          setLoadError(null);
        } catch (error: unknown) {
          if (requestId !== dashboardRequestId.current) return;
          setLoadError(error);
          if (dataRef.current) {
            showNotice({
              title: t('common.error'),
              message: getMobileErrorMessage(error, t, 'errors.loadCalendar'),
              tone: 'error',
            });
          }
        } finally {
          if (requestId === dashboardRequestId.current) setLoading(false);
        }
      };
      void load();
      return () => {
        dashboardRequestId.current += 1;
      };
    }, [reloadNonce, showNotice, t, token]),
  );

  const greetingName =
    profile?.name ||
    profile?.email.split('@')[0] ||
    t('profile.employeeAccount');
  const greetingDate = parseDateKey(
    data?.businessDate ?? toBusinessDateKey(new Date().toISOString()),
  );
  const initialError = loadError !== null && data === null && !loading;
  const screenLoadingGate = useScreenLoadingGate(isFocused, !loading);
  const screenLoading = !initialError && screenLoadingGate;
  const lifecycle = data?.today.lifecycle;
  const status = t(LIFECYCLE_KEYS[lifecycle ?? 'NO_MENU']);
  const statusTone: SemanticTone = lifecycle
    ? LIFECYCLE_TONES[lifecycle]
    : 'neutral';
  const menu = data?.today.menu;
  const title = menu?.mealName ?? t('dashboard.noMenuTitle');
  const description =
    menu?.description ??
    (lifecycle === 'NO_MENU' ? t('dashboard.noMenuDescription') : undefined);
  const location =
    data?.today.location?.displayName ??
    (lifecycle ? t('dashboard.noLocation') : undefined);
  const showTicketAction =
    lifecycle === 'ACTIVE' && Boolean(data?.today.canOpenQr);

  return (
    <AppFrame
      screenLoadingLabel={
        screenLoading ? t('dashboard.loadingRegistration') : undefined
      }
    >
      {initialError ? (
        <Surface level={1} padding="lg" style={styles.retrySurface}>
          <AppText
            variant="supporting"
            tone="critical"
            style={styles.retryText}
          >
            {getMobileErrorMessage(loadError, t, 'errors.loadCalendar')}
          </AppText>
          <ActionButton
            variant="secondary"
            size="md"
            label={t('common.retry')}
            onPress={() => setReloadNonce((value) => value + 1)}
          />
        </Surface>
      ) : data ? (
        <>
          <View style={styles.greeting}>
            <View style={styles.greetingCopy}>
              <AppText
                variant="eyebrow"
                tone="secondary"
              >{`${formatDay(greetingDate, locale)}, ${formatShortDate(greetingDate, locale)}`}</AppText>
              <AppText variant="sectionTitle" style={styles.greetingTitle}>
                {t('auth.greeting', { name: greetingName })}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.openProfile')}
              onPress={() =>
                navigation.navigate('EmployeeProfile', {
                  screen: 'ProfileHome',
                })
              }
              style={styles.avatarButton}
            >
              <Avatar initials={initials(profile?.name, 'ME')} />
            </Pressable>
          </View>
          <MealCard
            periodLabel={t('dashboard.mealPeriod')}
            status={{ label: status, tone: statusTone }}
            title={title}
            description={description}
            location={location}
            style={styles.mealCard}
            footer={
              <View style={styles.mealFooter}>
                <Divider style={styles.mealFooterDivider} />
                <StatusBadge
                  label={t('dashboard.weekCount', {
                    count: data.registeredCount,
                    total: data.enabledMenuDays,
                  })}
                  tone="information"
                  icon={CalendarDays}
                />
              </View>
            }
          />
          {showTicketAction ? (
            <TicketActionCard
              title={t('dashboard.openMealTicket')}
              supportingText={t('dashboard.showDynamicQr')}
              accessibilityLabel={t('dashboard.openMealTicket')}
              onPress={() => navigation.navigate('PickupIntent')}
              style={styles.ticketAction}
            />
          ) : null}
          <ActionButton
            variant="secondary"
            size="md"
            label={t('dashboard.manageWeeklyRegistration')}
            icon={CalendarDays}
            onPress={() => navigation.navigate('EmployeeCalendar')}
            style={styles.weeklyButton}
          />
        </>
      ) : null}
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
  greetingCopy: { flex: 1, minWidth: 0, paddingRight: designTokens.space.md },
  greetingTitle: { marginTop: designTokens.space.sm },
  avatarButton: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.full,
  },
  mealCard: { marginBottom: designTokens.space.lg },
  mealFooter: { gap: designTokens.space.md },
  mealFooterDivider: { marginBottom: designTokens.space.xs },
  ticketAction: { marginBottom: designTokens.space.md },
  weeklyButton: { alignSelf: 'stretch' },
  retrySurface: {
    marginTop: designTokens.space.xl,
    gap: designTokens.space.lg,
  },
  retryText: { marginBottom: designTokens.space.sm },
});
