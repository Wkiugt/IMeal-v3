import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, CalendarDays, MapPin, QrCode } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { registrationAPI } from '../../api/registrationAPI';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import { startOfWeek, toDateKey, formatDay, formatShortDate, initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'EmployeeDashboard'>;

export function EmployeeDashboardScreen({ navigation }: Props) {
  const { token, profile } = useSession();
  const { showNotice } = useNotice();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [todayRegistered, setTodayRegistered] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const dashboardRequestId = useRef(0);

  useFocusEffect(
    React.useCallback(() => {
      if (!token) return undefined;
      const requestId = ++dashboardRequestId.current;
      setLoading(true);
      void registrationAPI.getWeek(toDateKey(startOfWeek(new Date())), token)
        .then(({ registrations }) => {
          if (requestId !== dashboardRequestId.current) return;
          const today = toDateKey(new Date());
          setTodayRegistered(registrations.some((registration) => registration.mealDate.slice(0, 10) === today && registration.status === 'ACTIVE'));
        })
        .catch((error: unknown) => {
          if (requestId !== dashboardRequestId.current) return;
          setTodayRegistered(null);
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
  const statusTone = todayRegistered === true ? 'soft' : 'warn';
  const today = new Date();
  return (
    <PrototypeFrame screenLoadingLabel={screenLoading ? t('dashboard.loadingRegistration') : undefined}>
      <StateTransition
        stateKey={todayRegistered === null ? 'unavailable' : 'loaded'}
      >
        <>
          <View style={styles.greeting}>
            <View style={styles.greetingCopy}>
              <Eyebrow>{`${formatDay(today, locale)}, ${formatShortDate(today, locale)}`.toUpperCase()}</Eyebrow>
              <Text style={styles.greetingName}>{t('auth.greeting', { name: greetingName })}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.openProfile')}
              onPress={() => navigation.navigate('EmployeeProfile', { screen: 'ProfileHome' })}
              style={({ pressed }) => [styles.avatarButton, pressed && styles.avatarPressed]}
            >
              <Avatar initials={initials(profile?.name, 'ME')} />
            </Pressable>
          </View>
          <PrototypeCard style={styles.mealCard}>
            <View style={styles.topRow}>
              <Pill><PillText>{t('dashboard.lunchService')}</PillText></Pill>
              <StateTransition
                stateKey={todayRegistered === null ? 'unavailable' : 'loaded'}
                style={styles.statusTransition}
              >
                <Pill tone={statusTone}><PillText>{status}</PillText></Pill>
              </StateTransition>
            </View>
            <Text style={styles.mealTitle}>{t('dashboard.mealName')}</Text>
            <Text style={styles.mealSub}>{t('dashboard.mealDescription')}</Text>
            <View style={styles.divider} />
            <View style={styles.metaRow}><MapPin size={16} color={theme.colors.accentDeep} strokeWidth={1.6} /><Text style={styles.metaText}>{t('dashboard.location')}</Text></View>
          </PrototypeCard>

          <Pressable accessibilityRole="button" accessibilityLabel={t('dashboard.openMealTicket')} onPress={() => navigation.navigate('PickupIntent')} style={styles.scanCta}>
            <View style={styles.scanIcon}><QrCode size={24} color={theme.colors.surface} strokeWidth={1.6} /></View>
            <View style={styles.scanCopy}><Text style={styles.scanTitle}>{t('dashboard.openMealTicket')}</Text><Text style={styles.scanSub}>{t('dashboard.showDynamicQr')}</Text></View>
            <ArrowRight size={18} color={theme.colors.surface} strokeWidth={1.6} />
          </Pressable>

          <Pressable accessibilityRole="button" accessibilityLabel={t('dashboard.manageWeeklyRegistration')} onPress={() => navigation.navigate('EmployeeCalendar')} style={styles.calendarLink}>
            <CalendarDays size={16} color={theme.colors.accentDeep} /><Text style={styles.calendarLinkText}>{t('dashboard.manageWeeklyRegistration')}</Text>
          </Pressable>
        </>
      </StateTransition>
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  greeting: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 26 },
  greetingCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  avatarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radii.pill },
  avatarPressed: { opacity: 0.7 },
  greetingName: { marginTop: 6, color: theme.colors.fg, fontSize: 24, fontFamily: theme.typography.bold, letterSpacing: -0.25 },
  mealCard: { marginBottom: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  statusTransition: { alignItems: 'flex-end' },
  mealTitle: { color: theme.colors.fg, fontSize: 21, fontFamily: theme.typography.bold, lineHeight: 27, letterSpacing: -0.2 },
  mealSub: { marginTop: 6, color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.regular, lineHeight: 20 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  scanCta: { minHeight: 86, paddingHorizontal: 22, paddingVertical: 20, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, flexDirection: 'row', alignItems: 'center', gap: 16, ...theme.shadows.md },
  scanIcon: { width: 46, height: 46, borderRadius: theme.radii.sm, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  scanCopy: { flex: 1 },
  scanTitle: { color: theme.colors.surface, fontSize: 16, fontFamily: theme.typography.bold },
  scanSub: { marginTop: 2, color: 'rgba(255,255,255,0.78)', fontSize: 13, fontFamily: theme.typography.regular },
  calendarLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 22 },
  calendarLinkText: { color: theme.colors.accentDeep, fontSize: 13, fontFamily: theme.typography.bold },
});
