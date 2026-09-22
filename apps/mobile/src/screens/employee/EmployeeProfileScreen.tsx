import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Languages,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  AppText,
  Avatar,
  Divider,
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
import { designTokens, getElevationStyle } from '../../ui/designTokens';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotificationPresentation } from './profilePresentation';


type Props = ProfileStackScreenProps<'ProfileHome'>;

type SettingsGroupProps = {
  label: string;
  children: React.ReactNode;
  surface?: boolean;
  surfacePadding?: keyof typeof designTokens.space;
  surfaceStyle?: StyleProp<ViewStyle>;
};

function SettingsGroup({
  label,
  children,
  surface = true,
  surfacePadding = 'md',
  surfaceStyle,
}: SettingsGroupProps): React.JSX.Element {
  return (
    <View style={styles.settingsGroup}>
      <AppText variant="eyebrow" tone="tertiary" accessibilityRole="header" style={styles.settingsGroupLabel}>
        {label}
      </AppText>
      {surface ? (
        <Surface level={1} padding={surfacePadding} style={surfaceStyle}>
          {children}
        </Surface>
      ) : (
        children
      )}
    </View>
  );
}

type ProfileIdentityProps = {
  initials: string;
  name: string;
  roleLabel: string;
  identifier?: string;
};

function ProfileIdentity({ initials: profileInitials, name, roleLabel, identifier }: ProfileIdentityProps): React.JSX.Element {
  return (
    <View style={styles.identityCard}>
      <Avatar
        initials={profileInitials}
        size="lg"
        accessibilityLabel={name}
        style={styles.identityAvatar}
      />
      <View style={styles.identityCopy}>
        <AppText variant="cardTitle" tone="strong" style={styles.identityName}>
          {name}
        </AppText>
        <AppText variant="supporting" tone="secondary" style={styles.identityRole}>
          {roleLabel}
        </AppText>
        {identifier ? (
          <AppText variant="monoCaption" tone="tertiary" style={styles.identityIdentifier}>
            {identifier}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

type SettingRowLayoutProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  trailing: React.ReactNode;
  compactLayout: boolean;
  tallLayout?: boolean;
};

function SettingRowLayout({
  icon: Icon,
  title,
  supportingText,
  trailing,
  compactLayout,
  tallLayout = false,
}: SettingRowLayoutProps): React.JSX.Element {
  return (
    <View style={[styles.settingRowLayout, compactLayout && styles.settingRowLayoutCompact]}>
      <View style={styles.settingIconTile}>
        <Icon size={20} color={designTokens.color.brand.primary} strokeWidth={1.9} />
      </View>
      <View style={styles.settingContent}>
        <View style={[
          styles.settingMain,
          compactLayout && styles.settingMainCompact,
          tallLayout && styles.settingMainTall,
        ]}>
          <View style={styles.settingCopy}>
            <AppText variant="body" style={styles.settingTitle}>
              {title}
            </AppText>
            {supportingText ? (
              <AppText
                variant="supporting"
                tone="secondary"
                style={styles.settingSupporting}
                numberOfLines={2}
              >
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
  tallLayout?: boolean;
};

function NavigationSettingRow({
  icon,
  title,
  supportingText,
  currentValue,
  onPress,
  accessibilityHint,
  compactLayout,
  tallLayout = false,
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
        tallLayout={tallLayout}
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

type LogoutCardProps = {
  label: string;
  accessibilityHint: string;
  onPress: () => void;
};

function LogoutCard({ label, accessibilityHint, onPress }: LogoutCardProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const pressScale = useRef(new Animated.Value(1)).current;

  const animatePress = (pressed: boolean) => {
    if (reduceMotion) {
      pressScale.setValue(1);
      return;
    }
    Animated.timing(pressScale, {
      toValue: pressed ? designTokens.motion.pressScale.button : 1,
      duration: designTokens.motion.duration.fast,
      easing: designTokens.motion.easing.standard,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.logoutCardAnimated, { transform: [{ scale: pressScale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        onPressIn={() => animatePress(true)}
        onPressOut={() => animatePress(false)}
        style={({ pressed }) => [styles.logoutCard, pressed && styles.logoutCardPressed]}
      >
        <AppText variant="buttonLabel" tone="critical" style={styles.logoutLabel}>
          {label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

type ProfileLogoutModalProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  processingLabel: string;
  processing: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ProfileLogoutModal({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  processingLabel,
  processing,
  onClose,
  onConfirm,
}: ProfileLogoutModalProps): React.JSX.Element | null {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const modalMaxHeight = Math.max(
    designTokens.size.controlLg * 3,
    height - insets.top - insets.bottom - designTokens.space['2xl'],
  );
  const [rendered, setRendered] = useState(visible);
  const renderedRef = useRef(visible);
  const animationGeneration = useRef(0);
  const backdropOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const modalScale = useRef(new Animated.Value(visible ? 1 : designTokens.motion.pressScale.compact)).current;

  useEffect(() => {
    const generation = animationGeneration.current + 1;
    animationGeneration.current = generation;
    backdropOpacity.stopAnimation();
    modalScale.stopAnimation();

    if (visible) {
      renderedRef.current = true;
      setRendered(true);
      if (reduceMotion) {
        backdropOpacity.setValue(1);
        modalScale.setValue(1);
        return;
      }
      backdropOpacity.setValue(0);
      modalScale.setValue(designTokens.motion.pressScale.compact);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: designTokens.motion.duration.standard,
          easing: designTokens.motion.easing.standard,
          useNativeDriver: true,
        }),
        Animated.timing(modalScale, {
          toValue: 1,
          duration: designTokens.motion.duration.standard,
          easing: designTokens.motion.easing.standard,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!renderedRef.current) return;
    if (reduceMotion) {
      backdropOpacity.setValue(0);
      modalScale.setValue(designTokens.motion.pressScale.compact);
      renderedRef.current = false;
      setRendered(false);
      return;
    }

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
      Animated.timing(modalScale, {
        toValue: designTokens.motion.pressScale.compact,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && animationGeneration.current === generation) {
        renderedRef.current = false;
        setRendered(false);
      }
    });
  }, [backdropOpacity, modalScale, reduceMotion, visible]);

  const handleClose = () => {
    if (!processing) onClose();
  };

  if (!rendered) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <Pressable
        accessibilityRole="none"
        onPress={handleClose}
        style={[
          styles.logoutModalBackdrop,
          {
            paddingTop: insets.top + designTokens.space.md,
            paddingBottom: insets.bottom + designTokens.space.md,
            paddingHorizontal: designTokens.space.md,
          },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.logoutModalScrim, { opacity: backdropOpacity }]}
        />
        <Animated.View
          style={[
            styles.logoutModalCard,
            { maxHeight: modalMaxHeight, opacity: backdropOpacity, transform: [{ scale: modalScale }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.logoutModalScroll}
            contentContainerStyle={styles.logoutModalContent}
          >
          <AppText
            variant="cardTitle"
            tone="critical"
            accessibilityRole="header"
            style={styles.logoutModalTitle}
          >
            {title}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.logoutModalMessage}>
            {message}
          </AppText>
          <Divider style={styles.logoutModalDivider} />
          <View style={styles.logoutModalActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              accessibilityState={{ disabled: processing }}
              disabled={processing}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.logoutModalAction,
                pressed && !processing && styles.logoutModalActionPressed,
              ]}
            >
              <AppText variant="buttonLabel" tone="secondary">
                {cancelLabel}
              </AppText>
            </Pressable>
            <View style={styles.logoutModalActionDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={processing ? processingLabel : confirmLabel}
              accessibilityState={{ busy: processing, disabled: processing }}
              disabled={processing}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.logoutModalAction,
                pressed && !processing && styles.logoutModalActionPressed,
              ]}
            >
              <AppText variant="buttonLabel" tone="critical">
                {processing ? processingLabel : confirmLabel}
              </AppText>
            </Pressable>
          </View>
          </ScrollView>
        </Animated.View>
      </Pressable>
    </Modal>
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

      <SettingsGroup label={t('profile.groupStatistics')} surface={false}>
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
      </SettingsGroup>

      <SettingsGroup
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
      </SettingsGroup>

      <SettingsGroup
        label={t('profile.groupApp')}
        surfacePadding="sm"
        surfaceStyle={styles.settingsGroupSurface}
      >
        <NavigationSettingRow
          icon={Languages}
          title={t('profile.language')}
          currentValue={language === 'vi' ? t('profile.vietnamese') : t('profile.english')}
          onPress={() => setLanguageSheetVisible(true)}
          compactLayout={compactLayout}
        />
      </SettingsGroup>

      <SettingsGroup
        label={t('profile.groupPermissionsSharing')}
        surfacePadding="sm"
        surfaceStyle={styles.settingsGroupSurface}
      >
        <NavigationSettingRow
          icon={UsersRound}
          title={t('profile.delegations')}
          supportingText={t('profile.delegationsHint')}
          onPress={() => navigation.navigate('Delegation')}
          compactLayout={compactLayout}
          tallLayout
        />
      </SettingsGroup>
      <View style={styles.logoutSection}>
        <LogoutCard
          label={t('profile.signOut')}
          accessibilityHint={t('profile.signOutHint')}
          onPress={handleLogout}
        />
      </View>



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
  identityCard: {
    marginTop: designTokens.space.xs,
    marginBottom: designTokens.space['2xl'],
    padding: 0,
    gap: designTokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityAvatar: {
    width: designTokens.size.avatarLg - designTokens.space.xs,
    height: designTokens.size.avatarLg - designTokens.space.xs,
    flexShrink: 0,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    fontSize: 19,
    lineHeight: 25,
  },
  identityRole: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
  },
  identityIdentifier: {
    marginTop: designTokens.space.xs,
    fontSize: 13,
    lineHeight: 18,
  },
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
  settingsGroup: {
    gap: designTokens.space.sm,
    marginBottom: designTokens.space['2xl'],
  },
  settingsGroupLabel: {
    marginLeft: designTokens.space.xs,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: designTokens.typography.family.semiBold,
    letterSpacing: 0.8,
    opacity: 0.9,
  },
  settingsGroupSurface: {
    borderRadius: designTokens.radius.card + designTokens.space.xs / 2,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.color.border.subtle,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  settingPressable: {
    minHeight: designTokens.size.touchMin,
    borderRadius: designTokens.radius.smallControl,
  },
  settingPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  settingRowLayout: {
    minHeight: 48,
    paddingHorizontal: designTokens.space.sm,
    paddingVertical: designTokens.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  settingRowLayoutCompact: {
    alignItems: 'flex-start',
  },
  settingIconTile: {
    width: 40,
    height: 40,
    borderRadius: designTokens.radius.inputButton,
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
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  settingMainTall: {
    minHeight: 48,
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
  settingTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: designTokens.typography.family.medium,
  },
  settingSupporting: {
    marginTop: 0,
    fontSize: 13,
    lineHeight: 18,
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
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
    flexShrink: 0,
  },
  navigationValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 20,
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
  logoutCardAnimated: {
    width: '100%',
  },
  logoutCard: {
    minHeight: 60,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.color.border.subtle,
    backgroundColor: designTokens.color.surface.standard,
    ...getElevationStyle(1),
  },
  logoutCardPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  logoutLabel: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: designTokens.typography.family.semiBold,
    color: designTokens.color.semantic.critical.base,
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
  logoutModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutModalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.32)',
  },
  logoutModalCard: {
    width: '84%',
    maxWidth: 390,
    padding: designTokens.space.xl,
    borderRadius: designTokens.radius.heroCard,
    borderWidth: designTokens.border.subtle.width,
    borderColor: designTokens.color.border.subtle,
    backgroundColor: designTokens.color.surface.standard,
    ...getElevationStyle(2),
  },
  logoutModalScroll: {
    flexShrink: 1,
  },
  logoutModalContent: {
    flexGrow: 1,
  },
  logoutModalTitle: {
    textAlign: 'center',
    fontFamily: designTokens.typography.family.semiBold,
  },
  logoutModalMessage: {
    marginTop: designTokens.space.sm,
    textAlign: 'center',
  },
  logoutModalDivider: {
    marginTop: designTokens.space.xl,
  },
  logoutModalActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  logoutModalAction: {
    flex: 1,
    minHeight: designTokens.size.controlLg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.space.sm,
    borderRadius: designTokens.radius.smallControl,
  },
  logoutModalActionPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
  logoutModalActionDivider: {
    width: designTokens.border.subtle.width,
    minHeight: designTokens.size.controlLg,
    backgroundColor: designTokens.color.divider,
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
});
