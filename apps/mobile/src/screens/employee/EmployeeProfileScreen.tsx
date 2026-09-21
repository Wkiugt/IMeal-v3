import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Bell, Check, ChevronRight, Leaf, LogOut, Settings, UsersRound } from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  Divider,
  IdentityCard,
  StatisticsCard,
  StatusBadge,
  Surface,
  Toggle,
} from '../../ui/components';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { notificationAPI } from '../../api/notificationAPI';
import { useNotifications } from '../../notifications/NotificationProvider';
import { designTokens, type SemanticTone } from '../../ui/designTokens';

type Props = ProfileStackScreenProps<'ProfileHome'>;

export function EmployeeProfileScreen({ navigation }: Props) {
  const { token, profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const { permissionStatus, configurationError, enableNotifications, openSettings, revokeCurrentDevice } = useNotifications();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [confirmedReminders, setConfirmedReminders] = useState(true);
  const [reminderLoading, setReminderLoading] = useState(true);
  const displayName = profile?.name || profile?.email.split('@')[0] || t('profile.employeeAccount');
  const userCode = profile?.userId || profile?.id || '—';

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    setReminderLoading(true);
    void notificationAPI.getPreferences(token).then((preferences) => {
      if (!mounted) return;
      setConfirmedReminders(preferences.remindersEnabled);
    }).catch(() => {
      if (mounted) showNotice({ title: t('common.error'), message: t('profile.preferenceLoadFailed'), tone: 'warning' });
    }).finally(() => {
      if (mounted) setReminderLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [showNotice, t, token]);

  const handleReminderChange = async (nextValue: boolean) => {
    if (!token || reminderLoading) return;
    const previousValue = confirmedReminders;
    setReminderLoading(true);
    try {
      const preferences = await notificationAPI.updatePreferences({ remindersEnabled: nextValue }, token);
      setConfirmedReminders(preferences.remindersEnabled);
    } catch {
      setConfirmedReminders(previousValue);
      showNotice({ title: t('common.error'), message: t('profile.preferenceSaveFailed'), tone: 'warning' });
    } finally {
      setReminderLoading(false);
    }
  };

  const performLogout = async () => {
    await revokeCurrentDevice().catch(() => undefined);
    await logout();
  };

  const handleLogout = () => {
    Alert.alert(t('auth.logOut'), t('profile.logOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.logOut'), style: 'destructive', onPress: () => { void performLogout(); } },
    ]);
  };

  const handleLanguageChange = async (nextLanguage: 'vi' | 'en') => {
    if (nextLanguage === language) return;
    try {
      await setLanguage(nextLanguage);
    } catch {
      showNotice({ title: t('common.error'), message: t('profile.languagePersistenceFailed'), tone: 'warning' });
      return;
    }
    if (!token) return;
    try {
      await notificationAPI.updatePreferences({ locale: nextLanguage }, token);
    } catch {
      showNotice({ title: t('common.error'), message: t('profile.languagePersistenceFailed'), tone: 'warning' });
    }
  };

  const systemStatus = permissionStatus === 'granted'
    ? t('notifications.enabled')
    : permissionStatus === 'denied'
      ? t('notifications.denied')
      : permissionStatus === 'simulator'
        ? t('notifications.physicalDeviceRequired')
        : t('notifications.notEnabled');
  const systemTone: SemanticTone = permissionStatus === 'granted'
    ? 'success'
    : permissionStatus === 'denied'
      ? 'warning'
      : permissionStatus === 'undetermined'
        ? 'information'
        : 'neutral';
  const systemAction = permissionStatus === 'denied' ? openSettings : enableNotifications;
  const systemActionLabel = permissionStatus === 'denied' ? t('notifications.openSettings') : t('notifications.enable');

  return (
    <AppFrame>
      <SectionHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <IdentityCard
        initials={initials(profile?.name, 'ME')}
        name={displayName}
        roleLabel={t('profile.employeeAccount')}
        identifier={userCode}
        style={styles.identityCard}
      />

      <StatisticsCard
        eyebrow={t('profile.thisMonth')}
        metrics={[
          { label: t('profile.mealsBooked'), value: '—' },
          { label: t('profile.mealsEnjoyed'), value: '—' },
        ]}
        style={styles.statsCard}
      />

      <Surface level={1} padding="xl" style={styles.preferencesCard}>
        <View style={styles.preferenceGroup}>
          <View style={[styles.preferenceRow, compactLayout && styles.preferenceRowCompact]}>
            <View style={styles.preferenceCopy}>
              <AppText variant="body">{t('profile.dietaryPreferences')}</AppText>
              <AppText variant="supporting" tone="secondary" style={styles.preferenceHint}>
                {t('profile.managedByAccount')}
              </AppText>
            </View>
            <StatusBadge label={t('profile.notSet')} tone="neutral" icon={Leaf} />
          </View>
        </View>

        <Divider style={styles.preferenceDivider} />

        <View style={styles.preferenceGroup}>
          <Toggle
            value={confirmedReminders}
            disabled={reminderLoading}
            loading={reminderLoading}
            label={t('profile.bookingReminders')}
            onValueChange={(value) => void handleReminderChange(value)}
          />
          <AppText variant="supporting" tone="secondary" style={styles.preferenceHint}>
            {t('profile.remindersHint')}
          </AppText>
        </View>

        <View style={[styles.preferenceRow, compactLayout && styles.preferenceRowCompact]}>
          <View style={styles.preferenceCopy}>
            <AppText variant="body">{t('profile.systemNotifications')}</AppText>
            <StatusBadge label={systemStatus} tone={systemTone} />
          </View>
          <ActionButton
            variant="secondary"
            size="md"
            label={systemActionLabel}
            icon={permissionStatus === 'denied' ? Settings : Bell}
            disabled={permissionStatus === 'simulator' || permissionStatus === 'unavailable'}
            onPress={() => void systemAction()}
            style={[styles.systemAction, compactLayout && styles.systemActionCompact]}
          />
        </View>
        {configurationError ? (
          <AppText variant="supporting" tone="warning" style={styles.recovery}>
            {configurationError}
          </AppText>
        ) : null}

        <Divider style={styles.preferenceDivider} />

        <View style={styles.languageSection}>
          <View style={styles.preferenceCopy}>
            <AppText variant="body">{t('profile.language')}</AppText>
            <AppText variant="supporting" tone="secondary" style={styles.preferenceHint}>
              {t('profile.languageHint')}
            </AppText>
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.language')} style={[styles.languageSelector, compactLayout && styles.languageSelectorCompact]}>
            {([
              ['vi', 'profile.vietnamese'],
              ['en', 'profile.english'],
            ] as const).map(([nextLanguage, labelKey]) => {
              const selected = language === nextLanguage;
              return (
                <Pressable
                  key={nextLanguage}
                  accessibilityRole="radio"
                  accessibilityLabel={t(labelKey)}
                  accessibilityState={{ checked: selected }}
                  onPress={() => void handleLanguageChange(nextLanguage)}
                  style={[styles.languageOption, compactLayout && styles.languageOptionCompact, selected && styles.languageOptionSelected]}
                >
                  {selected ? <Check size={16} color={designTokens.color.brand.primary} strokeWidth={2.4} /> : null}
                  <AppText variant="buttonLabel" tone={selected ? 'information' : 'secondary'}>
                    {t(labelKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Surface>

      <Divider style={styles.delegationDivider} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.delegations')}
        onPress={() => navigation.navigate('Delegation')}
        style={({ pressed }) => [styles.delegationRow, pressed && styles.delegationPressed]}
      >
        <View style={styles.delegationIcon}>
          <UsersRound size={18} color={designTokens.color.brand.primary} strokeWidth={1.9} />
        </View>
        <View style={styles.delegationCopy}>
          <AppText variant="body">{t('profile.delegations')}</AppText>
          <AppText variant="supporting" tone="secondary" style={styles.delegationHint}>
            {t('profile.delegationsHint')}
          </AppText>
        </View>
        <ChevronRight size={18} color={designTokens.color.text.secondary} strokeWidth={1.9} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('auth.logOut')}
        onPress={handleLogout}
        style={styles.logout}
      >
        <LogOut size={18} color={designTokens.color.semantic.critical.base} strokeWidth={1.8} />
        <AppText variant="buttonLabel" tone="critical">{t('auth.logOut')}</AppText>
      </Pressable>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  identityCard: {
    marginBottom: designTokens.space.lg,
  },
  statsCard: {
    marginBottom: designTokens.space.lg,
  },
  preferencesCard: {
    gap: designTokens.space.lg,
  },
  preferenceGroup: {
    gap: designTokens.space.xs,
  },
  preferenceRow: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  preferenceRowCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  preferenceCopy: {
    flex: 1,
    minWidth: 0,
  },
  preferenceHint: {
    marginTop: designTokens.space.xs,
  },
  preferenceDivider: {
    marginVertical: designTokens.space.xs,
  },
  systemAction: {
    flexShrink: 0,
  },
  systemActionCompact: {
    alignSelf: 'stretch',
  },
  recovery: {
    marginTop: designTokens.space.xs,
  },
  languageSection: {
    gap: designTokens.space.sm,
  },
  languageSelector: {
    flexDirection: 'row',
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.smallControl,
    overflow: 'hidden',
  },
  languageSelectorCompact: {
    flexDirection: 'column',
  },
  languageOption: {
    flex: 1,
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.surface.standard,
  },
  languageOptionCompact: {
    width: '100%',
    flex: 0,
  },
  languageOptionSelected: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  delegationDivider: {
    marginTop: designTokens.space.lg,
  },
  delegationRow: {
    minHeight: designTokens.size.controlLg,
    paddingVertical: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  delegationPressed: {
    transform: [{ scale: designTokens.motion.pressScale.compact }],
  },
  delegationIcon: {
    width: designTokens.size.controlMd,
    height: designTokens.size.controlMd,
    borderRadius: designTokens.radius.smallControl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.brand.tint,
  },
  delegationCopy: {
    flex: 1,
    minWidth: 0,
  },
  delegationHint: {
    marginTop: designTokens.space.xs,
  },
  logout: {
    minHeight: designTokens.size.touchMin,
    marginTop: designTokens.space.sm,
    marginBottom: designTokens.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.sm,
  },
});
