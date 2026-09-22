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
import { Check, ChevronRight, X, type LucideIcon } from 'lucide-react-native';
import type { AppLanguage } from '../../i18n/translations';
import { AppText, Avatar, Divider, Surface } from '../../ui/components';
import { designTokens, getElevationStyle } from '../../ui/designTokens';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ProfileIdentityProps = {
  initials: string;
  name: string;
  roleLabel: string;
  identifier?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProfileIdentity({
  initials: profileInitials,
  name,
  roleLabel,
  identifier,
  style,
}: ProfileIdentityProps): React.JSX.Element {
  return (
    <View style={[styles.identityCard, style]}>
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

export type ProfileSettingsGroupProps = {
  label: string;
  children: React.ReactNode;
  surface?: boolean;
  surfacePadding?: keyof typeof designTokens.space;
  surfaceStyle?: StyleProp<ViewStyle>;
};

export function ProfileSettingsGroup({
  label,
  children,
  surface = true,
  surfacePadding = 'md',
  surfaceStyle,
}: ProfileSettingsGroupProps): React.JSX.Element {
  return (
    <View style={styles.settingsGroup}>
      <AppText
        variant="eyebrow"
        tone="tertiary"
        accessibilityRole="header"
        style={styles.settingsGroupLabel}
      >
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

export type ProfileSettingRowLayoutProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  trailing: React.ReactNode;
  compactLayout: boolean;
  tallLayout?: boolean;
};

export function ProfileSettingRowLayout({
  icon: Icon,
  title,
  supportingText,
  trailing,
  compactLayout,
  tallLayout = false,
}: ProfileSettingRowLayoutProps): React.JSX.Element {
  return (
    <View style={[styles.settingRowLayout, compactLayout && styles.settingRowLayoutCompact]}>
      <View style={styles.settingIconTile}>
        <Icon size={20} color={designTokens.color.brand.primary} strokeWidth={1.9} />
      </View>
      <View style={styles.settingContent}>
        <View
          style={[
            styles.settingMain,
            compactLayout && styles.settingMainCompact,
            tallLayout && styles.settingMainTall,
          ]}
        >
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

export type ProfileNavigationSettingRowProps = {
  icon: LucideIcon;
  title: string;
  supportingText?: string;
  currentValue?: string;
  onPress: () => void;
  accessibilityHint?: string;
  compactLayout: boolean;
  tallLayout?: boolean;
};

export function ProfileNavigationSettingRow({
  icon,
  title,
  supportingText,
  currentValue,
  onPress,
  accessibilityHint,
  compactLayout,
  tallLayout = false,
}: ProfileNavigationSettingRowProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={currentValue ? `${title}, ${currentValue}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.settingPressable, pressed && styles.settingPressed]}
    >
      <ProfileSettingRowLayout
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

export type ProfileLanguageSheetProps = {
  visible: boolean;
  language: AppLanguage;
  title: string;
  closeLabel: string;
  labels: { vi: string; en: string };
  onClose: () => void;
  onSelect: (language: AppLanguage) => void;
};

export function ProfileLanguageSheet({
  visible,
  language,
  title,
  closeLabel,
  labels,
  onClose,
  onSelect,
}: ProfileLanguageSheetProps): React.JSX.Element {
  const options: ReadonlyArray<readonly [AppLanguage, string]> = [
    ['vi', labels.vi],
    ['en', labels.en],
  ];

  return (
    <ProfileSheet
      visible={visible}
      title={title}
      closeLabel={closeLabel}
      onClose={onClose}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.languageOptions}>
        {options.map(([nextLanguage, label]) => {
          const selected = language === nextLanguage;
          return (
            <Pressable
              key={nextLanguage}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() => onSelect(nextLanguage)}
              style={({ pressed }) => [
                styles.languageOption,
                selected && styles.languageOptionSelected,
                pressed && styles.languageOptionPressed,
              ]}
            >
              {selected ? (
                <Check size={16} color={designTokens.color.brand.primary} strokeWidth={2.4} />
              ) : null}
              <AppText variant="buttonLabel" tone={selected ? 'information' : 'secondary'}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </ProfileSheet>
  );
}

export type ProfileSignOutEntryProps = {
  label: string;
  accessibilityHint: string;
  onPress: () => void;
};

export function ProfileSignOutEntry({
  label,
  accessibilityHint,
  onPress,
}: ProfileSignOutEntryProps): React.JSX.Element {
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

export type ProfileLogoutModalProps = {
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

export function ProfileLogoutModal({
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
  const modalScale = useRef(
    new Animated.Value(visible ? 1 : designTokens.motion.pressScale.compact),
  ).current;

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
            {
              maxHeight: modalMaxHeight,
              opacity: backdropOpacity,
              transform: [{ scale: modalScale }],
            },
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
    borderColor: designTokens.border.selected.color,
  },
  languageOptionPressed: {
    backgroundColor: designTokens.color.brand.tint,
  },
});
