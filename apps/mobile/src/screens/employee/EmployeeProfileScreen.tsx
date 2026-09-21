import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Languages,
  Leaf,
  LogOut,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import type { AppTabParamList, ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  Divider,
  IdentityCard,
  StatisticsCard,
  StatusDot,
  Surface,
  Toggle,
  type StatusDotStatus,
} from '../../ui/components';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { notificationAPI } from '../../api/notificationAPI';
import { useNotifications } from '../../notifications/NotificationProvider';
import { designTokens } from '../../ui/designTokens';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = ProfileStackScreenProps<'ProfileHome'>;
type TabNavigation = BottomTabNavigationProp<AppTabParamList>;

type SettingsGroupProps = {
  label: string;
  children: React.ReactNode;
};

function SettingsGroup({ label, children }: SettingsGroupProps): React.JSX.Element {
  return (
    <View style={styles.settingsGroup}>
      <AppText variant="eyebrow" tone="tertiary" accessibilityRole="header">
        {label}
      </AppText>
      <Surface level={1} padding="lg">
        {children}
      </Surface>
    </View>
  );
}

type SettingRowLayoutProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  trailing: React.ReactNode;
  compactLayout: boolean;
};

function SettingRowLayout({
  icon: Icon,
  title,
  supportingText,
  trailing,
  compactLayout,
}: SettingRowLayoutProps): React.JSX.Element {
  return (
    <View style={[styles.settingRowLayout, compactLayout && styles.settingRowLayoutCompact]}>
      <View style={styles.settingIconTile}>
        <Icon size={18} color={designTokens.color.brand.primary} strokeWidth={1.9} />
      </View>
      <View style={styles.settingContent}>
        <View style={[styles.settingMain, compactLayout && styles.settingMainCompact]}>
          <View style={styles.settingCopy}>
            <AppText variant="body">{title}</AppText>
            {supportingText ? (
              <AppText variant="supporting" tone="secondary" style={styles.settingSupporting}>
                {supportingText}
              </AppText>
            ) : null}
          </View>
          <View style={[styles.settingTrailing, compactLayout && styles.settingTrailingCompact]}>
            {trailing}
          </View>
        </View>
      </View>
    </View>
  );
}

type NavigationSettingRowProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  currentValue?: string;
  onPress: () => void;
  accessibilityHint?: string;
  compactLayout: boolean;
};

function NavigationSettingRow({
  icon,
  title,
  supportingText,
  currentValue,
  onPress,
  accessibilityHint,
  compactLayout,
}: NavigationSettingRowProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={currentValue ? `${title}, ${currentValue}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.settingPressable, pressed && styles.settingPressed]}
    >
      <SettingRowLayout
        icon={icon}
        title={title}
        supportingText={supportingText}
        compactLayout={compactLayout}
        trailing={
          <View style={styles.navigationTrailing}>
            {currentValue ? (
              <AppText variant="supporting" tone="secondary" style={styles.navigationValue}>
                {currentValue}
              </AppText>
            ) : null}
            <ChevronRight size={18} color={designTokens.color.text.secondary} strokeWidth={1.9} />
          </View>
        }
      />
    </Pressable>
  );
}

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
    <SettingRowLayout
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
    <SettingRowLayout
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
        <AlertTriangle size={17} color={designTokens.color.semantic.warning.base} strokeWidth={1.9} />
        <AppText variant="supporting" tone="warning" style={styles.warningMessage}>
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
          <AppText variant="buttonLabel" tone="warning">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

type ProfileSheetProps = {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
};

function ProfileSheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
}: ProfileSheetProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={[styles.sheetBackdrop, { paddingBottom: insets.bottom }]}>
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <AppText variant="sectionTitle" accessibilityRole="header" style={styles.sheetTitle}>
              {title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.sheetClosePressed]}
            >
              <X size={20} color={designTokens.color.text.strong} strokeWidth={1.9} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function EmployeeProfileScreen({ navigation }: Props) {
  const { token, profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const { permissionStatus, configurationError, enableNotifications, openSettings, revokeCurrentDevice } = useNotifications();
  const tabNavigation = useNavigation<TabNavigation>();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [confirmedReminders, setConfirmedReminders] = useState(true);
  const [reminderLoading, setReminderLoading] = useState(true);
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
  const [signOutSheetVisible, setSignOutSheetVisible] = useState(false);
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
    setSignOutSheetVisible(true);
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
      showNotice({ title: t('common.error'), message: t('profile.languagePersistenceFailed'), tone: 'warning' });
    }
  };

  const systemStatus = permissionStatus === 'granted'
    ? { status: 'active' as const, label: t('profile.notificationEnabled') }
    : permissionStatus === 'denied'
      ? { status: 'inactive' as const, label: t('profile.notificationDisabled') }
      : permissionStatus === 'undetermined'
        ? { status: 'pending' as const, label: t('profile.notificationNotConfigured') }
        : { status: 'inactive' as const, label: t('profile.notificationUnavailable') };

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

      <SettingsGroup label={t('profile.groupMeal')}>
        <NavigationSettingRow
          icon={Leaf}
          title={t('profile.dietaryPreferences')}
          supportingText={t('profile.mealPreferencesHint')}
          currentValue={t('profile.notSet')}
          onPress={() => tabNavigation.navigate('EmployeeCalendar')}
          compactLayout={compactLayout}
        />
      </SettingsGroup>

      <SettingsGroup label={t('profile.groupNotifications')}>
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
        {permissionStatus === 'denied' ? (
          <WarningSurface
            message={t('profile.notificationsDisabledWarning')}
            actionLabel={`${t('notifications.openSettings')} →`}
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
      </SettingsGroup>

      <SettingsGroup label={t('profile.groupApp')}>
        <NavigationSettingRow
          icon={Languages}
          title={t('profile.language')}
          currentValue={language === 'vi' ? t('profile.vietnamese') : t('profile.english')}
          onPress={() => setLanguageSheetVisible(true)}
          compactLayout={compactLayout}
        />
      </SettingsGroup>

      <SettingsGroup label={t('profile.groupPermissionsSharing')}>
        <NavigationSettingRow
          icon={UsersRound}
          title={t('profile.delegations')}
          supportingText={t('profile.delegationsHint')}
          onPress={() => navigation.navigate('Delegation')}
          compactLayout={compactLayout}
        />
      </SettingsGroup>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.signOut')}
        onPress={handleLogout}
        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
      >
        <LogOut size={18} color={designTokens.color.semantic.critical.base} strokeWidth={1.8} />
        <AppText variant="buttonLabel" tone="critical">{t('profile.signOut')}</AppText>
      </Pressable>

      <ProfileSheet
        visible={languageSheetVisible}
        title={t('profile.language')}
        closeLabel={t('profile.closeLanguage')}
        onClose={() => setLanguageSheetVisible(false)}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.language')} style={styles.languageOptions}>
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
                style={({ pressed }) => [
                  styles.languageOption,
                  selected && styles.languageOptionSelected,
                  pressed && styles.languageOptionPressed,
                ]}
              >
                {selected ? <Check size={16} color={designTokens.color.brand.primary} strokeWidth={2.4} /> : null}
                <AppText variant="buttonLabel" tone={selected ? 'information' : 'secondary'}>
                  {t(labelKey)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </ProfileSheet>

      <ProfileSheet
        visible={signOutSheetVisible}
        title={t('profile.signOut')}
        closeLabel={t('common.close')}
        onClose={() => setSignOutSheetVisible(false)}
      >
        <AppText variant="body" tone="secondary" style={styles.signOutMessage}>
          {t('profile.signOutConfirm')}
        </AppText>
        <ActionButton
          variant="critical"
          size="lg"
          label={t('profile.signOut')}
          icon={LogOut}
          onPress={() => {
            setSignOutSheetVisible(false);
            void performLogout();
          }}
        />
        <ActionButton
          variant="ghost"
          size="md"
          label={t('common.cancel')}
          onPress={() => setSignOutSheetVisible(false)}
          style={styles.cancelButton}
        />
      </ProfileSheet>
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
  settingsGroup: {
    gap: designTokens.space.xs,
    marginBottom: designTokens.space.lg,
  },
  settingPressable: {
    minHeight: designTokens.size.touchMin,
    borderRadius: designTokens.radius.smallControl,
  },
  settingPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  settingRowLayout: {
    minHeight: designTokens.size.touchMin,
    paddingVertical: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.md,
  },
  settingRowLayoutCompact: {
    alignItems: 'flex-start',
  },
  settingIconTile: {
    width: designTokens.size.controlSm,
    height: designTokens.size.controlSm,
    borderRadius: designTokens.radius.smallControl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.brand.tint,
    flexShrink: 0,
  },
  settingContent: {
    flex: 1,
    minWidth: 0,
  },
  settingMain: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  settingMainCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: designTokens.space.xs,
  },
  settingCopy: {
    flex: 1,
    minWidth: 0,
  },
  settingSupporting: {
    marginTop: designTokens.space.xs,
  },
  settingTrailing: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  settingTrailingCompact: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  navigationTrailing: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  navigationValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  settingsDivider: {
    marginTop: designTokens.space.xs,
    marginBottom: designTokens.space.xs,
    marginLeft: designTokens.size.controlSm + designTokens.space.md,
  },
  warningSurface: {
    marginTop: designTokens.space.md,
    padding: designTokens.space.md,
    borderRadius: designTokens.radius.smallControl,
    backgroundColor: designTokens.color.semantic.warning.tint,
    gap: designTokens.space.sm,
  },
  warningCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
  },
  warningMessage: {
    flex: 1,
    minWidth: 0,
  },
  warningAction: {
    minHeight: designTokens.size.touchMin,
    alignSelf: 'flex-end',
    justifyContent: 'center',
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
  quietLinkPressed: {
    opacity: 0.7,
  },
  unavailableHint: {
    marginTop: designTokens.space.md,
  },
  logout: {
    minHeight: designTokens.size.touchMin,
    marginTop: designTokens.space['3xl'],
    marginBottom: designTokens.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: designTokens.space.sm,
  },
  logoutPressed: {
    opacity: 0.7,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: designTokens.color.scrim,
  },
  sheetCard: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    padding: designTokens.space.xl,
    borderTopLeftRadius: designTokens.radius.floating,
    borderTopRightRadius: designTokens.radius.floating,
    backgroundColor: designTokens.color.surface.standard,
    gap: designTokens.space.md,
  },
  sheetHeader: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
  },
  sheetClose: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.smallControl,
  },
  sheetClosePressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  languageOptions: {
    gap: designTokens.space.sm,
  },
  languageOption: {
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.smallControl,
  },
  languageOptionSelected: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  languageOptionPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  signOutMessage: {
    marginBottom: designTokens.space.xs,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
