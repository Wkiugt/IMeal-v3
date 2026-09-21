import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputFocusEventData,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  ArrowRight,
  Check,
  Lock,
  QrCode,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { designTokens, getElevationStyle } from '../designTokens';
import { useReducedMotion } from '../useReducedMotion';
import { AppText, Surface } from './Foundation';

export type ActionButtonVariant = 'primary' | 'secondary' | 'ghost' | 'critical';
export type ActionButtonSize = 'md' | 'lg';

export type ActionButtonProps = {
  variant: ActionButtonVariant;
  size: ActionButtonSize;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function ActionButton({
  variant,
  size,
  label,
  icon: Icon,
  disabled = false,
  loading = false,
  onPress,
  accessibilityHint,
  style,
}: ActionButtonProps) {
  const isDisabled = disabled || loading;
  const foreground = isDisabled
    ? designTokens.color.disabled.text
    : variant === 'primary' || variant === 'critical'
      ? designTokens.color.text.onBrand
      : designTokens.color.text.strong;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        size === 'lg' ? styles.actionButtonLarge : styles.actionButtonMedium,
        variant === 'primary' && styles.actionButtonPrimary,
        variant === 'secondary' && styles.actionButtonSecondary,
        variant === 'ghost' && styles.actionButtonGhost,
        variant === 'critical' && styles.actionButtonCritical,
        pressed && !isDisabled && styles.actionButtonPressed,
        isDisabled && styles.actionButtonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <>
          {Icon ? <Icon color={foreground} size={18} strokeWidth={1.9} /> : null}
          <AppText
            variant="buttonLabel"
            tone={foreground === designTokens.color.text.onBrand ? 'onBrand' : isDisabled ? 'tertiary' : 'strong'}
            style={styles.actionButtonLabel}
          >
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export type TicketActionCardProps = {
  title: string;
  supportingText?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function TicketActionCard({
  title,
  supportingText,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
}: TicketActionCardProps) {
  const reduceMotion = useReducedMotion();
  const pressScale = useRef(new Animated.Value(1)).current;
  const arrowTranslation = useRef(new Animated.Value(0)).current;

  const animatePress = (pressed: boolean) => {
    const toValue = pressed ? designTokens.motion.pressScale.button : 1;
    const toArrow = pressed ? designTokens.motion.distance.micro : 0;

    if (reduceMotion) {
      pressScale.setValue(toValue);
      arrowTranslation.setValue(toArrow);
      return;
    }

    Animated.parallel([
      Animated.timing(pressScale, {
        toValue,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
      Animated.timing(arrowTranslation, {
        toValue: toArrow,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Animated.View style={[styles.ticketActionAnimated, { transform: [{ scale: pressScale }] }]}>
      <Surface level={4} padding="lg" style={[styles.ticketActionSurface, disabled && styles.ticketActionDisabled, style]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          onPressIn={() => animatePress(true)}
          onPressOut={() => animatePress(false)}
          style={styles.ticketActionPressable}
        >
          <View style={styles.ticketIconTile}>
            <QrCode color={designTokens.color.text.onBrand} size={23} strokeWidth={1.9} />
          </View>
          <View style={styles.ticketActionCopy}>
            <AppText variant="cardTitle" tone="onBrand" style={styles.ticketActionTitle}>
              {title}
            </AppText>
            {supportingText ? (
              <AppText variant="supporting" tone="onBrand" style={styles.ticketSupportingText}>
                {supportingText}
              </AppText>
            ) : null}
          </View>
          <Animated.View style={{ transform: [{ translateX: arrowTranslation }] }}>
            <ArrowRight color={designTokens.color.text.onBrand} size={22} strokeWidth={2.1} />
          </Animated.View>
        </Pressable>
      </Surface>
    </Animated.View>
  );
}

export type ToggleProps = {
  value: boolean;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  showLabel?: boolean;
  onValueChange: (value: boolean) => void;
};

export function Toggle({
  value,
  disabled = false,
  loading = false,
  label,
  showLabel = true,
  onValueChange,
}: ToggleProps) {
  const isDisabled = disabled || loading;

  return (
    <View style={styles.toggleRow}>
      {showLabel ? (
        <AppText variant="body" tone="strong" style={styles.toggleLabel}>
          {label}
        </AppText>
      ) : null}
      <View style={styles.toggleControl}>
        <View style={styles.toggleSwitchWrap}>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel={label}
            accessibilityState={{ checked: value, disabled: isDisabled, busy: loading }}
            disabled={isDisabled}
            value={value}
            onValueChange={onValueChange}
            trackColor={{
              false: designTokens.color.border.standard,
              true: designTokens.color.brand.primary,
            }}
            thumbColor={designTokens.color.surface.standard}
            ios_backgroundColor={designTokens.color.border.standard}
          />
          {loading ? (
            <View pointerEvents="none" style={styles.toggleLoadingOverlay}>
              <ActivityIndicator color={designTokens.color.brand.primary} size="small" />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
export type SelectionIndicatorState = 'default' | 'pressed' | 'selected' | 'disabled' | 'unavailable';

export type SelectionIndicatorProps = {
  state: SelectionIndicatorState;
  label: string;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SelectionIndicator({ state, label, interactive = true, style }: SelectionIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const checkScale = useRef(new Animated.Value(state === 'selected' ? 1 : 0.9)).current;

  useEffect(() => {
    const toValue = state === 'selected' ? 1 : 0.9;
    if (reduceMotion) {
      checkScale.setValue(toValue);
      return;
    }

    Animated.timing(checkScale, {
      toValue,
      duration: state === 'selected' ? designTokens.motion.duration.fast : designTokens.motion.duration.instant,
      easing: designTokens.motion.easing.standard,
      useNativeDriver: true,
    }).start();
  }, [checkScale, reduceMotion, state]);

  const isSelected = state === 'selected';
  const isUnavailable = state === 'unavailable';
  const isDisabled = state === 'disabled' || isUnavailable;

  return (
    <Animated.View
      accessible={interactive}
      accessibilityRole={interactive ? 'checkbox' : undefined}
      accessibilityLabel={interactive ? label : undefined}
      accessibilityState={interactive ? { checked: isSelected, disabled: isDisabled, selected: isSelected } : undefined}
      style={[
        styles.selectionIndicator,
        state === 'pressed' && styles.selectionIndicatorPressed,
        isSelected && styles.selectionIndicatorSelected,
        state === 'disabled' && styles.selectionIndicatorDisabled,
        isUnavailable && styles.selectionIndicatorUnavailable,
        style,
      ]}
    >
      {isSelected ? (
        <Animated.View style={{ transform: [{ scale: checkScale }] }}>
          <Check color={designTokens.color.brand.primary} size={16} strokeWidth={2.4} />
        </Animated.View>
      ) : state === 'disabled' ? (
        <Lock color={designTokens.color.disabled.text} size={15} strokeWidth={2} />
      ) : isUnavailable ? (
        <X color={designTokens.color.semantic.critical.base} size={16} strokeWidth={2.2} />
      ) : null}
    </Animated.View>
  );
}

type TextFieldBaseProps = Omit<
  TextInputProps,
  'editable' | 'onChangeText' | 'value' | 'style'
> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  icon?: LucideIcon;
  hint?: string;
  error?: string;
  disabled?: boolean;
  editable?: boolean;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

export type TextFieldProps = TextFieldBaseProps;

export function TextField({
  label,
  value,
  onChangeText,
  icon: Icon,
  hint,
  error,
  disabled = false,
  style: inputStyle,
  containerStyle,
  accessibilityLabel,
  accessibilityHint,
  editable = true,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...props
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const resolvedPlaceholderColor = placeholderTextColor ?? designTokens.color.text.tertiary;
  const resolvedAccessibilityLabel = accessibilityLabel ?? label;
  const fieldDescription = error ?? hint;
  const resolvedAccessibilityHint = [accessibilityHint, fieldDescription]
    .filter((part): part is string => Boolean(part))
    .join('. ');
  const handleFocus = (event: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(true);
    onFocus?.(event);
  };

  const handleBlur = (event: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(false);
    onBlur?.(event);
  };

  return (
    <View style={containerStyle}>
      <AppText variant="supporting" tone="strong" style={styles.fieldLabel}>
        {label}
      </AppText>
      <View
        style={[
          styles.fieldInputWrap,
          focused && styles.fieldInputFocused,
          disabled && styles.fieldInputDisabled,
          Boolean(error) && styles.fieldInputError,
        ]}
      >
        {Icon ? <Icon color={focused ? designTokens.color.brand.primary : designTokens.color.text.secondary} size={18} strokeWidth={1.8} /> : null}
        <TextInput
          {...props}
          {...(error ? { 'aria-invalid': true } : {})}
          accessibilityLabel={resolvedAccessibilityLabel}
          accessibilityHint={resolvedAccessibilityHint || undefined}
          accessibilityState={{ disabled }}
          editable={disabled ? false : editable}
          onBlur={handleBlur}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          placeholderTextColor={resolvedPlaceholderColor}
          style={[styles.fieldInput, inputStyle]}
          value={value}
        />
      </View>
      {error ? (
        <AppText variant="caption" tone="critical" style={styles.fieldMessage}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="tertiary" style={styles.fieldMessage}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    minHeight: designTokens.size.controlMd,
    paddingHorizontal: designTokens.space.lg,
    paddingVertical: designTokens.space.sm,
    borderRadius: designTokens.radius.inputButton,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.sm,
  },
  actionButtonLabel: {
    flexShrink: 1,
    textAlign: 'center',
  },
  actionButtonMedium: {
    minHeight: designTokens.size.controlMd,
  },
  actionButtonLarge: {
    minHeight: designTokens.size.controlLg,
  },
  actionButtonPrimary: {
    backgroundColor: designTokens.color.surface.brand,
    ...getElevationStyle(2),
  },
  actionButtonSecondary: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
  },
  actionButtonGhost: {
    backgroundColor: 'transparent',
  },
  actionButtonCritical: {
    backgroundColor: designTokens.color.semantic.critical.base,
    ...getElevationStyle(2),
  },
  actionButtonPressed: {
    transform: [{ scale: designTokens.motion.pressScale.button }],
  },
  actionButtonDisabled: {
    backgroundColor: designTokens.color.disabled.fill,
    borderColor: designTokens.color.border.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  ticketActionAnimated: {
    width: '100%',
  },
  ticketActionSurface: {
    borderRadius: designTokens.radius.heroCard,
    padding: 0,
    overflow: 'hidden',
  },
  ticketActionDisabled: {
    opacity: 0.65,
  },
  ticketActionPressable: {
    minHeight: designTokens.size.primaryCtaMinHeight,
    paddingHorizontal: designTokens.space.lg,
    paddingVertical: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  ticketIconTile: {
    width: 46,
    height: 46,
    borderRadius: designTokens.radius.inputButton,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.surface.glass,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
  },
  ticketActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  ticketActionTitle: {
    flexShrink: 1,
  },
  ticketSupportingText: {
    opacity: 0.86,
    marginTop: designTokens.space.xs,
  },
  toggleRow: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  toggleLabel: {
    flex: 1,
  },
  toggleControl: {
    width: 52,
    minHeight: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleSwitchWrap: {
    width: '100%',
    minHeight: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  toggleLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionIndicator: {
    width: 24,
    height: 24,
    borderRadius: designTokens.radius.full,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    backgroundColor: designTokens.color.surface.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionIndicatorPressed: {
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.tint,
  },
  selectionIndicatorSelected: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.soft,
  },
  selectionIndicatorDisabled: {
    borderColor: designTokens.color.border.disabled,
    backgroundColor: designTokens.color.disabled.fill,
  },
  selectionIndicatorUnavailable: {
    borderColor: designTokens.color.semantic.critical.base,
    backgroundColor: designTokens.color.semantic.critical.tint,
  },
  fieldLabel: {
    marginBottom: designTokens.space.sm,
  },
  fieldInputWrap: {
    minHeight: designTokens.size.controlLg,
    paddingHorizontal: designTokens.space.md,
    gap: designTokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.inputButton,
    backgroundColor: designTokens.color.surface.standard,
  },
  fieldInputFocused: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  fieldInputDisabled: {
    backgroundColor: designTokens.color.disabled.fill,
    borderColor: designTokens.color.border.disabled,
  },
  fieldInputError: {
    borderColor: designTokens.color.semantic.critical.base,
  },
  fieldInput: {
    flex: 1,
    minHeight: designTokens.size.controlMd,
    paddingVertical: 0,
    color: designTokens.color.text.strong,
    fontFamily: designTokens.typography.family.regular,
    fontSize: designTokens.typography.body.fontSize,
    lineHeight: designTokens.typography.body.lineHeight,
  },
  fieldMessage: {
    marginTop: designTokens.space.xs,
  },
});
