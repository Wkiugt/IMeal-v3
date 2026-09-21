import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { designTokens } from '../designTokens';
import { useReducedMotion } from '../useReducedMotion';
import { ActionButton } from './Controls';
import { AppText, Surface } from './Foundation';

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
};

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({ icon: Icon, title, description, action, style }: EmptyStateProps) {
  return (
    <Surface level={0} padding="2xl" style={[styles.emptyState, style]}>
      <View style={styles.emptyIcon}>
        <Icon color={designTokens.color.semantic.neutral.base} size={25} strokeWidth={1.8} />
      </View>
      <AppText variant="cardTitle" tone="strong" style={styles.emptyTitle}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" tone="secondary" style={styles.emptyDescription}>
          {description}
        </AppText>
      ) : null}
      {action ? (
        <ActionButton
          variant="secondary"
          size="md"
          label={action.label}
          accessibilityHint={action.accessibilityHint}
          onPress={action.onPress}
          style={styles.emptyAction}
        />
      ) : null}
    </Surface>
  );
}

export type LoadingStateVariant = 'content' | 'card' | 'qr';

export type LoadingStateProps = {
  variant: LoadingStateVariant;
  label: string;
  style?: StyleProp<ViewStyle>;
};

export function LoadingState({ variant, label, style }: LoadingStateProps) {
  if (variant === 'qr') {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
        <QrSkeleton />
      </View>
    );
  }

  const content = (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingContent}>
      <ActivityIndicator color={designTokens.color.brand.primary} size="small" />
      <AppText variant="supporting" tone="secondary">
        {label}
      </AppText>
    </View>
  );

  if (variant === 'card') {
    return (
      <Surface level={1} padding="xl" style={style}>
        {content}
      </Surface>
    );
  }

  return <View style={style}>{content}</View>;
}

export type QrSkeletonProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const finderPositions = [
  { top: 0, left: 0 },
  { top: 0, right: 0 },
  { bottom: 0, left: 0 },
] as const;

const modulePositions = [
  [0.48, 0.1],
  [0.58, 0.17],
  [0.68, 0.08],
  [0.78, 0.23],
  [0.43, 0.32],
  [0.56, 0.39],
  [0.68, 0.34],
  [0.8, 0.43],
  [0.36, 0.55],
  [0.5, 0.62],
  [0.63, 0.56],
  [0.76, 0.68],
  [0.44, 0.77],
  [0.58, 0.84],
  [0.72, 0.78],
] as const;

export function QrSkeleton({ size = designTokens.size.qr, style }: QrSkeletonProps) {
  const reduceMotion = useReducedMotion();
  const shimmerProgress = useRef(new Animated.Value(0)).current;
  const finderSize = Math.max(28, Math.round(size * 0.2));
  const finderInnerSize = Math.max(12, Math.round(finderSize * 0.46));
  const moduleSize = Math.max(4, Math.round(size * 0.045));

  useEffect(() => {
    shimmerProgress.stopAnimation();
    shimmerProgress.setValue(0);

    if (reduceMotion) return undefined;

    const animation = Animated.loop(
      Animated.timing(shimmerProgress, {
        toValue: 1,
        duration: designTokens.motion.duration.shimmerCycle,
        easing: designTokens.motion.easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();

    return () => animation.stop();
  }, [reduceMotion, shimmerProgress]);

  const shimmerTranslate = shimmerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-size, size * 2],
  });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading QR code"
      style={[styles.qrSkeleton, { width: size, height: size }, style]}
    >
      {finderPositions.map((position, index) => (
        <View
          key={`finder-${index}`}
          style={[
            styles.finder,
            {
              width: finderSize,
              height: finderSize,
              ...position,
            },
          ]}
        >
          <View style={[styles.finderInner, { width: finderInnerSize, height: finderInnerSize }]} />
        </View>
      ))}
      {modulePositions.map(([top, left], index) => (
        <View
          key={`module-${index}`}
          style={[
            styles.qrModule,
            {
              width: moduleSize,
              height: moduleSize,
              top: Math.round(size * top),
              left: Math.round(size * left),
            },
          ]}
        />
      ))}
      {!reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.shimmer, { width: Math.max(24, size * 0.24), height: size, transform: [{ translateX: shimmerTranslate }] }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: designTokens.radius.inputButton,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.semantic.neutral.tint,
  },
  emptyTitle: {
    textAlign: 'center',
    marginTop: designTokens.space.md,
  },
  emptyDescription: {
    textAlign: 'center',
    marginTop: designTokens.space.sm,
  },
  emptyAction: {
    marginTop: designTokens.space.lg,
  },
  loadingContent: {
    minHeight: designTokens.size.controlLg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.sm,
  },
  qrSkeleton: {
    overflow: 'hidden',
    borderRadius: designTokens.radius.inputButton,
    backgroundColor: designTokens.color.surface.standard,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    position: 'relative',
  },
  finder: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: designTokens.color.text.strong,
    backgroundColor: designTokens.color.surface.standard,
  },
  finderInner: {
    backgroundColor: designTokens.color.text.strong,
  },
  qrModule: {
    position: 'absolute',
    backgroundColor: designTokens.color.text.strong,
    borderRadius: 1,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: designTokens.color.brand.soft,
    opacity: 0.55,
  },
});
