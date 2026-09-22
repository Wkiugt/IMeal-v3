import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  AlertTriangle,
  Bell,
  Clock3,
  Languages,
  UsersRound,
  type LucideIcon,
} from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  AppText,
  Divider,
  StatisticsCard,
  StatusDot,
  Toggle,
  type StatusDotStatus,
} from '../../ui/components';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { notificationAPI } from '../../api/notificationAPI';
import { useNotifications } from '../../notifications/NotificationProvider';
import { designTokens } from '../../ui/designTokens';
import { getNotificationPresentation } from './profilePresentation';
import {
  ProfileIdentity,
  ProfileLanguageSheet,
  ProfileLogoutModal,
  ProfileNavigationSettingRow,
  ProfileSettingRowLayout,
  ProfileSettingsGroup,
  ProfileSignOutEntry,
} from '../profile/ProfileComposition';

type Props = ProfileStackScreenProps<'ProfileHome'>;

type ToggleSettingRowProps = {
  icon: LucideIcon;
  title: string;
  supportingText: string;
  value: boolean;
  loading: boolean;
  onValueChange: (value: boolean) => void;
  compactLayout: boolean;
};

function ToggleSettingRow({
  icon,
  title,
  supportingText,
  value,
  loading,
  onValueChange,
  compactLayout,
}: ToggleSettingRowProps): React.JSX.Element {
  return (
    <ProfileSettingRowLayout
      icon={icon}
      title={title}
      supportingText={supportingText}
      compactLayout={compactLayout}
      trailing={
        <Toggle
          value={value}
          disabled={loading}
          loading={loading}
          label={title}
          showLabel={false}
          onValueChange={onValueChange}
        />
      }
    />
  );
}

type StatusSettingRowProps = {
  icon: LucideIcon;
  title: string;
  supportingText: string;
  status: StatusDotStatus;
  statusLabel: string;
  compactLayout: boolean;
};

function StatusSettingRow({
  icon,
  title,
  supportingText,
  status,
  statusLabel,
  compactLayout,
}: StatusSettingRowProps): React.JSX.Element {
  return (
    <ProfileSettingRowLayout
      icon={icon}
      title={title}
      supportingText={supportingText}
      compactLayout={compactLayout}
      trailing={<StatusDot status={status} label={statusLabel} />}
    />
  );
}

type WarningSurfaceProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

function WarningSurface({ message, actionLabel, onAction }: WarningSurfaceProps): React.JSX.Element {
  return (
    <View style={styles.warningSurface}>
      <View style={styles.warningCopy}>
        <AlertTriangle size={18} color={designTokens.color.semantic.warning.base} strokeWidth={1.9} />
        <AppText
          variant="caption"
          tone="warning"
          style={styles.warningMessage}
        >
          {message}
        </AppText>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.warningAction, pressed && styles.warningActionPressed]}
        >
          <AppText variant="caption" tone="warning" style={styles.warningActionLabel}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
type ProfileProgressMeterProps = {
  completed: number;
  total: number;
  label: string;
};

function ProfileProgressMeter({
  completed,
  total,
  label,
}: ProfileProgressMeterProps): React.JSX.Element {
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  const percentage = Math.round((safeCompleted / safeTotal) * 100);

  return (
    <View style={styles.progressMeter}>
      <View style={styles.progressHeading}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {percentage}%
        </AppText>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{
          min: 0,
          max: safeTotal,
          now: safeCompleted,
          text: `${safeCompleted}/${safeTotal} · ${percentage}%`,
        }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${percentage}%` }]} />
      </View>
    </View>
  );
}

export function EmployeeProfileScreen({ navigation }: Props) {
  const { token, profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const { permissionStatus, configurationError, enableNotifications, openSettings, revokeCurrentDevice } = useNotifications();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [confirmedReminders, setConfirmedReminders] = useState(true);
  const [reminderLoading, setReminderLoading] = useState(true);
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [logoutProcessing, setLogoutProcessing] = useState(false);
  const mealStats = { booked: 12, used: 8 };
  const displayName = profile?.name || profile?.email.split('@')[0] || 'Staff 01';
  const userCode = profile?.userId || profile?.id || 'local-staff-staff01';

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
    if (!logoutProcessing) setSignOutModalVisible(true);
  };

  const handleConfirmLogout = async () => {
    if (logoutProcessing) return;
    setLogoutProcessing(true);
    try {
      await performLogout();
      setSignOutModalVisible(false);
    } catch {
      showNotice({ title: t('common.error'), message: t('profile.signOut'), tone: 'warning' });
    } finally {
      setLogoutProcessing(false);
    }
  };

  const handleLanguageChange = async (nextLanguage: 'vi' | 'en') => {
    if (nextLanguage === language) {
      setLanguageSheetVisible(false);
      return;
    }
    try {
      await setLanguage(nextLanguage);
    } catch {
      showNotice({ title: t('common.error'), message: t('profile.languagePersistenceFailed'), tone: 'warning' });
      return;
    }
    setLanguageSheetVisible(false);
    if (!token) return;
    try {
      await notificationAPI.updatePreferences({ locale: nextLanguage }, token);
    } catch {
      showNotice({ title: t('common.error'), message: t('profile.languagePreferenceSyncFailed'), tone: 'warning' });
    }
  };

  const systemStatus = getNotificationPresentation(permissionStatus, {
    enabled: t('profile.notificationEnabled'),
    disabled: t('profile.notificationDisabled'),
    notConfigured: t('profile.notificationNotConfigured'),
    unavailable: t('profile.notificationUnavailable'),
  });


  return (
    <AppFrame>
      <SectionHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <ProfileIdentity
        initials={initials(profile?.name, 'S0')}
        name={displayName}
        roleLabel={t('profile.employeeAccount')}
        identifier={userCode}
      />

      <ProfileSettingsGroup label={t('profile.groupStatistics')} surface={false}>
        <View style={[styles.statsHero, compactLayout && styles.statsHeroCompact]}>
          <StatisticsCard
            eyebrow={t('profile.thisMonth')}
            metrics={[
              { label: t('profile.mealsBooked'), value: mealStats.booked },
              { label: t('profile.mealsEnjoyed'), value: mealStats.used },
            ]}
            style={[styles.statsCard, compactLayout && styles.statsCardCompact]}
          />
          <ProfileProgressMeter
            completed={mealStats.used}
            total={mealStats.booked}
            label={t('profile.progressUsed', {
              completed: mealStats.used,
              total: mealStats.booked,
            })}
          />
        </View>
      </ProfileSettingsGroup>

      <ProfileSettingsGroup
        label={t('profile.groupNotifications')}
        surfacePadding="sm"
        surfaceStyle={styles.settingsGroupSurface}
      >
        <ToggleSettingRow
          icon={Clock3}
          title={t('profile.bookingReminders')}
          supportingText={t('profile.remindersHint')}
          value={confirmedReminders}
          loading={reminderLoading}
          onValueChange={(value) => void handleReminderChange(value)}
          compactLayout={compactLayout}
        />
        <Divider style={styles.settingsDivider} />
        <StatusSettingRow
          icon={Bell}
          title={t('profile.systemNotifications')}
          supportingText={t('profile.systemNotificationsHint')}
          status={systemStatus.status}
          statusLabel={systemStatus.label}
          compactLayout={compactLayout}
        />
        {systemStatus.showWarning ? (
          <WarningSurface
            message={t('profile.notificationsDisabledWarning')}
            actionLabel={`${t('profile.openSettings')} →`}
            onAction={() => void openSettings()}
          />
        ) : null}
        {permissionStatus === 'undetermined' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('notifications.enable')} →`}
            onPress={() => void enableNotifications()}
            style={({ pressed }) => [styles.quietLink, pressed && styles.quietLinkPressed]}
          >
            <AppText variant="buttonLabel" tone="information">
              {t('notifications.enable')} →
            </AppText>
          </Pressable>
        ) : null}
        {permissionStatus === 'simulator' ? (
          <WarningSurface message={t('notifications.physicalDeviceRequired')} />
        ) : null}
        {permissionStatus === 'unavailable' ? (
          <AppText variant="supporting" tone="secondary" style={styles.unavailableHint}>
            {t('profile.notificationsUnavailableHint')}
          </AppText>
        ) : null}
        {configurationError ? <WarningSurface message={configurationError} /> : null}
      </ProfileSettingsGroup>

      <ProfileSettingsGroup
        label={t('profile.groupApp')}
        surfacePadding="sm"
        surfaceStyle={styles.settingsGroupSurface}
      >
        <ProfileNavigationSettingRow
          icon={Languages}
          title={t('profile.language')}
          currentValue={language === 'vi' ? t('profile.vietnamese') : t('profile.english')}
          onPress={() => setLanguageSheetVisible(true)}
          compactLayout={compactLayout}
        />
      </ProfileSettingsGroup>

      <ProfileSettingsGroup
        label={t('profile.groupPermissionsSharing')}
        surfacePadding="sm"
        surfaceStyle={styles.settingsGroupSurface}
      >
        <ProfileNavigationSettingRow
          icon={UsersRound}
          title={t('profile.delegations')}
          supportingText={t('profile.delegationsHint')}
          onPress={() => navigation.navigate('Delegation')}
          compactLayout={compactLayout}
          tallLayout
        />
      </ProfileSettingsGroup>
      <View style={styles.logoutSection}>
        <ProfileSignOutEntry
          label={t('profile.signOut')}
          accessibilityHint={t('profile.signOutHint')}
          onPress={handleLogout}
        />
      </View>

      <ProfileLanguageSheet
        visible={languageSheetVisible}
        language={language}
        title={t('profile.language')}
        closeLabel={t('profile.closeLanguage')}
        labels={{ vi: t('profile.vietnamese'), en: t('profile.english') }}
        onClose={() => setLanguageSheetVisible(false)}
        onSelect={(nextLanguage) => void handleLanguageChange(nextLanguage)}
      />

      <ProfileLogoutModal
        visible={signOutModalVisible}
        title={t('profile.signOut')}
        message={t('profile.signOutConfirm')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('profile.signOut')}
        processingLabel={t('common.processing')}
        processing={logoutProcessing}
        onClose={() => setSignOutModalVisible(false)}
        onConfirm={() => void handleConfirmLogout()}
      />
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  statsHero: {
    position: 'relative',
  },
  statsHeroCompact: {
    minHeight: 240,
  },
  statsCard: {
    minHeight: 160,
    marginBottom: 0,
    paddingTop: designTokens.space.xl,
    paddingHorizontal: designTokens.space.xl,
    paddingBottom: designTokens.space.xl,
    backgroundColor: designTokens.color.surface.elevated,
    borderRadius: designTokens.radius.floating,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.color.border.subtle,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  statsCardCompact: {
    minHeight: 240,
  },
  progressMeter: {
    position: 'absolute',
    left: designTokens.space.xl,
    right: designTokens.space.xl,
    bottom: designTokens.space.md,
    gap: designTokens.space.xs,
  },
  progressHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.sm,
  },
  progressTrack: {
    height: designTokens.space.sm,
    borderRadius: designTokens.radius.full,
    overflow: 'hidden',
    backgroundColor: designTokens.color.semantic.neutral.tint,
  },
  progressFill: {
    height: '100%',
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.brand.primary,
  },
  settingsGroupSurface: {
    borderRadius: designTokens.radius.card + designTokens.space.xs / 2,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.color.border.subtle,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  settingsDivider: {
    marginTop: 0,
    marginBottom: 0,
    marginLeft: designTokens.space.sm * 2 + 40 + designTokens.space.md,
  },
  warningSurface: {
    minHeight: 44,
    marginTop: designTokens.space.sm,
    paddingHorizontal: designTokens.space.md,
    paddingVertical: designTokens.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    borderRadius: designTokens.radius.chip,
    backgroundColor: designTokens.color.semantic.warning.tint,
    gap: designTokens.space.sm,
  },
  warningCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  warningMessage: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  warningAction: {
    minHeight: designTokens.size.touchMin,
    justifyContent: 'center',
    flexShrink: 0,
  },
  warningActionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: designTokens.typography.family.semiBold,
  },
  warningActionPressed: {
    opacity: 0.7,
  },
  quietLink: {
    minHeight: designTokens.size.touchMin,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    marginTop: designTokens.space.xs,
  },
  unavailableHint: {
    marginTop: designTokens.space.sm,
  },
  quietLinkPressed: {
    opacity: 0.7,
  },
  logoutSection: {
    marginTop: designTokens.space.sm,
    marginBottom: designTokens.space.xl,
  },
});
