import React from 'react';
import {
  CheckCircle2,
  Clock3,
  Info,
  Leaf,
  MinusCircle,
  Utensils,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  designTokens,
  semanticToneMap,
  type SemanticTone,
} from '../designTokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import { AppText } from './Foundation';

export type StatusBadgeProps = {
  label: string;
  tone: SemanticTone;
  icon?: LucideIcon | null;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
};

const defaultToneIcons: Record<SemanticTone, LucideIcon> = {
  information: Info,
  success: CheckCircle2,
  warning: Clock3,
  critical: XCircle,
  neutral: MinusCircle,
};

export function StatusBadge({ label, tone, icon, size = 'sm', style }: StatusBadgeProps) {
  const Icon = icon === null ? null : icon ?? defaultToneIcons[tone];
  const toneColors = semanticToneMap[tone];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.statusBadge,
        size === 'md' && styles.statusBadgeMedium,
        { backgroundColor: toneColors.tint },
        style,
      ]}
    >
      {Icon ? <Icon color={toneColors.foreground} size={size === 'md' ? 17 : 15} strokeWidth={2} /> : null}
      <AppText variant="badgeLabel" tone={tone}>
        {label}
      </AppText>
    </View>
  );
}

export type MealType = 'REGULAR' | 'VEGETARIAN';

export type MealTypeChipProps = {
  type: MealType;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

export function MealTypeChip({
  type,
  selected = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  style,
}: MealTypeChipProps) {
  const { t } = useLanguage();
  const mealTypeKey = type === 'VEGETARIAN'
    ? 'calendar.mealChoice.vegetarian'
    : 'calendar.mealChoice.regular';
  const mealTypeLabel = t(mealTypeKey);
  const resolvedAccessibilityLabel = accessibilityLabel || mealTypeLabel;
  const Icon = type === 'VEGETARIAN' ? Leaf : Utensils;
  const content = (
    <>
      <Icon
        color={disabled ? designTokens.color.disabled.text : designTokens.color.brand.primary}
        size={17}
        strokeWidth={1.9}
      />
      <AppText variant="badgeLabel" tone={disabled ? 'tertiary' : selected ? 'information' : 'secondary'}>
        {mealTypeLabel}
      </AppText>
    </>
  );

  const sharedStyle = [
    styles.mealTypeChip,
    selected && styles.mealTypeChipSelected,
    disabled && styles.mealTypeChipDisabled,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={resolvedAccessibilityLabel}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [sharedStyle, pressed && !disabled && styles.mealTypeChipPressed]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={resolvedAccessibilityLabel} style={sharedStyle}>
      {content}
    </View>
  );
}

export type StatusDotStatus = 'active' | 'inactive' | 'live' | 'paused' | 'pending' | 'expired';

export type StatusDotProps = {
  status: StatusDotStatus;
  label: string;
  style?: StyleProp<ViewStyle>;
};

const statusDotColors: Record<StatusDotStatus, string> = {
  active: designTokens.color.semantic.success.base,
  inactive: designTokens.color.semantic.neutral.base,
  live: designTokens.color.semantic.success.base,
  paused: designTokens.color.semantic.neutral.base,
  pending: designTokens.color.semantic.warning.base,
  expired: designTokens.color.semantic.critical.base,
};

export function StatusDot({ status, label, style }: StatusDotProps) {
  const dotColor = statusDotColors[status];

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.statusDotRow, style]}>
      <View style={[styles.statusDotOuter, status === 'live' && styles.statusDotLive]}>
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      </View>
      <AppText variant="supporting" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

export type ProgressMeterProps = {
  value: number;
  max: number;
  tone?: SemanticTone;
  size?: 'sm' | 'md';
  label: string;
  showValue?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ProgressMeter({
  value,
  max,
  tone = 'information',
  size = 'sm',
  label,
  showValue = false,
  style,
}: ProgressMeterProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const progress = safeValue / safeMax;
  const toneColors = semanticToneMap[tone];
  const valueText = `${safeValue} / ${safeMax}`;

  return (
    <View style={[styles.progressMeter, style]}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: safeMax, now: safeValue, text: valueText }}
        style={[styles.progressTrack, size === 'md' && styles.progressTrackMedium]}
      >
        <View
          style={[
            styles.progressFill,
            size === 'md' && styles.progressFillMedium,
            { backgroundColor: toneColors.foreground, width: `${progress * 100}%` },
          ]}
        />
      </View>
      {showValue ? (
        <AppText variant="caption" tone="tertiary" style={styles.progressValue}>
          {valueText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  statusBadge: {
    alignSelf: 'flex-start',
    minHeight: designTokens.size.controlSm,
    paddingHorizontal: designTokens.space.sm,
    paddingVertical: designTokens.space.xs,
    borderRadius: designTokens.radius.chip,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  statusBadgeMedium: {
    minHeight: designTokens.size.controlMd,
    paddingHorizontal: designTokens.space.md,
  },
  mealTypeChip: {
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.md,
    borderRadius: designTokens.radius.chip,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    backgroundColor: designTokens.color.surface.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
  },
  mealTypeChipSelected: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.soft,
  },
  mealTypeChipPressed: {
    transform: [{ scale: designTokens.motion.pressScale.compact }],
  },
  mealTypeChipDisabled: {
    backgroundColor: designTokens.color.disabled.fill,
    borderColor: designTokens.color.border.disabled,
  },
  statusDotRow: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  statusDotOuter: {
    width: 12,
    height: 12,
    borderRadius: designTokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDotLive: {
    borderWidth: 2,
    borderColor: designTokens.color.semantic.success.tint,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: designTokens.radius.full,
  },
  progressMeter: {
    width: '100%',
    gap: designTokens.space.xs,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    overflow: 'hidden',
    borderRadius: designTokens.radius.full,
    backgroundColor: designTokens.color.semantic.neutral.tint,
  },
  progressTrackMedium: {
    height: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: designTokens.radius.full,
  },
  progressFillMedium: {
    height: '100%',
  },
  progressValue: {
    alignSelf: 'flex-end',
  },
});
