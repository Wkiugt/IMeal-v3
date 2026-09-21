import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MapPin } from 'lucide-react-native';
import {
  designTokens,
  type SemanticTone,
} from '../designTokens';
import { useReducedMotion } from '../useReducedMotion';
import { useLanguage } from '../../i18n/LanguageProvider';
import { AppText, Avatar, Surface } from './Foundation';
import { SelectionIndicator, type SelectionIndicatorState } from './Controls';
import { MealTypeChip, type MealType, StatusBadge, type StatusBadgeProps } from './Indicators';

export type MealCardStatus = Pick<StatusBadgeProps, 'label' | 'tone' | 'icon'>;

export type MealCardProps = {
  periodLabel: string;
  status: MealCardStatus;
  title: string;
  description?: string;
  location?: string;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function MealCard({
  periodLabel,
  status,
  title,
  description,
  location,
  footer,
  style,
}: MealCardProps) {
  return (
    <Surface level={1} padding="xl" style={style}>
      <AppText variant="eyebrow" tone="secondary">
        {periodLabel}
      </AppText>
      <View style={styles.mealStatus}>
        <StatusBadge label={status.label} tone={status.tone} icon={status.icon} />
      </View>
      <AppText variant="cardTitle" tone="strong" style={styles.mealTitle}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" tone="secondary" style={styles.mealDescription}>
          {description}
        </AppText>
      ) : null}
      {location ? (
        <View style={styles.locationRow}>
          <MapPin color={designTokens.color.text.tertiary} size={16} strokeWidth={1.8} />
          <AppText variant="supporting" tone="tertiary" style={styles.locationText}>
            {location}
          </AppText>
        </View>
      ) : null}
      {footer ? <View style={styles.mealFooter}>{footer}</View> : null}
    </Surface>
  );
}

export type MealSelectionCardState = SelectionIndicatorState;

export type MealSelectionCardProps = {
  title: string;
  subtitle?: string;
  mealType?: MealType;
  state: MealSelectionCardState;
  variant?: 'selection' | 'toggle-row';
  saving?: boolean;
  badges?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function MealSelectionCard({
  title,
  subtitle,
  mealType,
  state,
  variant = 'selection',
  saving = false,
  badges,
  onPress,
  accessibilityLabel,
  trailing,
  style,
}: MealSelectionCardProps) {
  const reduceMotion = useReducedMotion();
  const checkScale = useRef(new Animated.Value(1)).current;
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = variant === 'selection' && (width < 350 || fontScale > 1.2);
  const isDisabled = state === 'disabled' || state === 'unavailable';
  const isSelected = state === 'selected';
  const { t } = useLanguage();
  const mealTypeLabel = mealType
    ? t(mealType === 'VEGETARIAN' ? 'calendar.mealChoice.vegetarian' : 'calendar.mealChoice.regular')
    : undefined;

  useEffect(() => {
    const target = isSelected ? 1 : 0.9;
    if (reduceMotion) {
      checkScale.setValue(target);
      return;
    }

    Animated.timing(checkScale, {
      toValue: target,
      duration: isSelected ? designTokens.motion.duration.fast : designTokens.motion.duration.instant,
      easing: designTokens.motion.easing.standard,
      useNativeDriver: true,
    }).start();
  }, [checkScale, isSelected, reduceMotion]);

  const cardStyle = [
    styles.mealSelectionCard,
    variant === 'toggle-row' && styles.mealSelectionCardToggleRow,
    compactLayout && styles.mealSelectionCardCompact,
    isSelected && styles.mealSelectionCardSelected,
    state === 'pressed' && styles.mealSelectionCardPressed,
    state === 'disabled' && styles.mealSelectionCardDisabled,
    state === 'unavailable' && styles.mealSelectionCardUnavailable,
    style,
  ];
  const selectionPrimary = (
    <View style={[styles.selectionPrimary, variant === 'toggle-row' && styles.selectionPrimaryToggleRow]}>
      {variant === 'selection' ? (
        <Animated.View style={{ transform: [{ scale: checkScale }] }}>
          <SelectionIndicator state={state} label={accessibilityLabel} interactive={false} />
        </Animated.View>
      ) : null}
      <View style={styles.selectionCopy}>
        <AppText variant="cardTitle" tone={isDisabled ? 'tertiary' : 'strong'}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="supporting" tone="secondary" style={styles.selectionSubtitle}>
            {subtitle}
          </AppText>
        ) : null}
        {mealType ? (
          <MealTypeChip
            type={mealType}
            selected={isSelected}
            disabled={isDisabled}
            accessibilityLabel={mealTypeLabel ?? accessibilityLabel}
            style={styles.selectionMealType}
          />
        ) : null}
        {badges ? <View style={styles.selectionBadges}>{badges}</View> : null}
      </View>
    </View>
  );
  const selectionTrailing = saving ? (
    <ActivityIndicator color={designTokens.color.brand.primary} size="small" />
  ) : trailing ? (
    <View
      style={[
        styles.selectionTrailing,
        variant === 'toggle-row' && styles.selectionTrailingToggleRow,
        compactLayout && styles.selectionTrailingCompact,
      ]}
    >
      {trailing}
    </View>
  ) : null;
  const content = (
    <>
      {selectionPrimary}
      {selectionTrailing}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ checked: isSelected, disabled: isDisabled, busy: saving }}
        disabled={isDisabled || saving}
        onPress={onPress}
        style={({ pressed }) => [cardStyle, pressed && !isDisabled && styles.mealSelectionCardPressed]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={cardStyle}>
      {content}
    </View>
  );
}

export type IdentityCardProps = {
  initials: string;
  name: string;
  roleLabel: string;
  identifier?: string;
  style?: StyleProp<ViewStyle>;
};

export function IdentityCard({ initials, name, roleLabel, identifier, style }: IdentityCardProps) {
  return (
    <Surface level={1} padding="xl" style={[styles.identityCard, style]}>
      <Avatar initials={initials} size="lg" accessibilityLabel={name} style={styles.identityAvatar} />
      <View style={styles.identityCopy}>
        <AppText variant="cardTitle" tone="strong">
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
    </Surface>
  );
}

export type StatisticsMetric = {
  label: string;
  value: string | number | null | undefined;
  tone?: SemanticTone;
};

export type StatisticsCardProps = {
  eyebrow: string;
  metrics: StatisticsMetric[];
  style?: StyleProp<ViewStyle>;
};

export function StatisticsCard({ eyebrow, metrics, style }: StatisticsCardProps) {
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;

  return (
    <Surface level={1} padding="xl" style={style}>
      <AppText variant="eyebrow" tone="secondary">
        {eyebrow}
      </AppText>
      <View style={[styles.statisticsGrid, compactLayout && styles.statisticsGridCompact]}>
        {metrics.map((metric) => (
          <View key={metric.label} style={[styles.statisticsMetric, compactLayout && styles.statisticsMetricCompact]}>
            <AppText variant="metric" tone={metric.tone ?? 'strong'}>
              {metric.value === null || metric.value === undefined ? '—' : String(metric.value)}
            </AppText>
            <AppText variant="supporting" tone="secondary">
              {metric.label}
            </AppText>
          </View>
        ))}
      </View>
    </Surface>
  );
}


const styles = StyleSheet.create({
  mealStatus: {
    marginTop: designTokens.space.md,
  },
  mealTitle: {
    marginTop: designTokens.space.md,
  },
  mealDescription: {
    marginTop: designTokens.space.sm,
  },
  locationRow: {
    marginTop: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  locationText: {
    flex: 1,
  },
  mealFooter: {
    marginTop: designTokens.space.lg,
  },
  mealSelectionCard: {
    minHeight: designTokens.size.touchMin,
    padding: designTokens.space.md,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    backgroundColor: designTokens.color.surface.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  mealSelectionCardToggleRow: {
    paddingVertical: designTokens.space.sm,
    paddingHorizontal: designTokens.space.md,
    gap: designTokens.space.sm,
  },
  mealSelectionCardCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  mealSelectionCardSelected: {
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.tint,
  },
  mealSelectionCardPressed: {
    transform: [{ scale: designTokens.motion.pressScale.card }],
  },
  mealSelectionCardDisabled: {
    borderColor: designTokens.color.border.disabled,
    backgroundColor: designTokens.color.disabled.fill,
  },
  mealSelectionCardUnavailable: {
    borderColor: designTokens.color.semantic.critical.base,
    backgroundColor: designTokens.color.semantic.critical.tint,
  },
  selectionPrimary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.md,
  },
  selectionPrimaryToggleRow: {
    gap: designTokens.space.sm,
  },
  selectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  selectionSubtitle: {
    marginTop: designTokens.space.xs,
  },
  selectionMealType: {
    alignSelf: 'flex-start',
    marginTop: designTokens.space.sm,
  },
  selectionBadges: {
    marginTop: designTokens.space.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.xs,
  },
  selectionTrailing: {
    flexShrink: 0,
  },
  selectionTrailingCompact: {
    width: '100%',
    alignItems: 'flex-end',
  },
  selectionTrailingToggleRow: {
    width: 52,
    overflow: 'hidden',
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  identityAvatar: {
    flexShrink: 0,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityRole: {
    marginTop: designTokens.space.xs,
  },
  identityIdentifier: {
    marginTop: designTokens.space.sm,
  },
  statisticsGrid: {
    marginTop: designTokens.space.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.lg,
  },
  statisticsGridCompact: {
    flexDirection: 'column',
  },
  statisticsMetric: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 100,
  },
  statisticsMetricCompact: {
    width: '100%',
    minWidth: 0,
  },
});
