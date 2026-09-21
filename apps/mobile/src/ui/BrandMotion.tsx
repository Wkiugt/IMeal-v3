import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Utensils } from 'lucide-react-native';
import { designTokens } from './designTokens';
import { useReducedMotion } from './useReducedMotion';
import { shouldAnimateScreenEntrance } from './screenEntranceState';
import { AppText } from './components';

type BrandMarkProps = {
  size?: number;
  containerSize?: number;
  style?: StyleProp<ViewStyle>;
};

export function BrandMark({
  size = 28,
  containerSize = 56,
  style,
}: BrandMarkProps) {
  return (
    <View
      style={[
        styles.brandMark,
        { width: containerSize, height: containerSize },
        style,
      ]}
    >
      <Utensils
        size={size}
        color={designTokens.color.brand.primary}
        strokeWidth={2}
      />
    </View>
  );
}

type BrandLoaderProps = {
  label: string;
  compact?: boolean;
};

export function BrandLoader({ label, compact = false }: BrandLoaderProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      scale.setValue(1);
      return () => {
        opacity.stopAnimation();
        scale.stopAnimation();
      };
    }

    opacity.setValue(0.6);
    scale.setValue(0.96);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: designTokens.motion.duration.shimmerCycle / 2,
            easing: designTokens.motion.easing.standard,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.04,
            duration: designTokens.motion.duration.shimmerCycle / 2,
            easing: designTokens.motion.easing.standard,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0.6,
            duration: designTokens.motion.duration.shimmerCycle / 2,
            easing: designTokens.motion.easing.standard,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.96,
            duration: designTokens.motion.duration.shimmerCycle / 2,
            easing: designTokens.motion.easing.standard,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    pulse.start();
    return () => {
      pulse.stop();
      opacity.stopAnimation();
      scale.stopAnimation();
    };
  }, [opacity, reduceMotion, scale]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.loader, compact && styles.loaderCompact]}
    >
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <BrandMark
          size={compact ? 18 : 28}
          containerSize={compact ? 36 : 56}
        />
      </Animated.View>
      <AppText variant="supporting" tone="secondary" style={[styles.loaderLabel, compact && styles.loaderLabelCompact]}>
        {label}
      </AppText>
    </View>
  );
}

export function ScreenLoading({ label }: { label: string }) {
  return (
    <View style={styles.screenLoading}>
      <BrandLoader label={label} />
    </View>
  );
}

type StateTransitionProps = {
  stateKey: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function StateTransition({
  stateKey,
  children,
  style,
}: StateTransitionProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : designTokens.motion.distance.entrance)).current;

  useEffect(() => {
    opacity.stopAnimation();
    translateY.stopAnimation();

    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return () => {
        opacity.stopAnimation();
        translateY.stopAnimation();
      };
    }

    opacity.setValue(0);
    translateY.setValue(designTokens.motion.distance.entrance);
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: designTokens.motion.duration.standard,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: designTokens.motion.duration.standard,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]);

    entrance.start();
    return () => {
      entrance.stop();
      opacity.stopAnimation();
      translateY.stopAnimation();
    };
  }, [opacity, reduceMotion, stateKey, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

type ScreenEntranceProps = {
  active: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenEntrance({
  active,
  children,
  style,
}: ScreenEntranceProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const hasEntered = useRef(false);

  useEffect(() => {
    opacity.stopAnimation();
    translateY.stopAnimation();
    const shouldAnimate = shouldAnimateScreenEntrance(active, hasEntered.current);
    if (active) hasEntered.current = true;

    if (reduceMotion || !shouldAnimate) {
      opacity.setValue(1);
      translateY.setValue(0);
      return () => {
        opacity.stopAnimation();
        translateY.stopAnimation();
      };
    }

    opacity.setValue(0);
    translateY.setValue(designTokens.motion.distance.entrance);
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: designTokens.motion.duration.standard,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: designTokens.motion.duration.standard,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]);

    entrance.start();
    return () => {
      entrance.stop();
      opacity.stopAnimation();
      translateY.stopAnimation();
    };
  }, [active, opacity, reduceMotion, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  brandMark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.heroCard,
    backgroundColor: designTokens.color.brand.soft,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 28,
    backgroundColor: designTokens.color.background.page,
  },
  screenLoading: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.background.page,
  },
  loaderCompact: {
    flex: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 8,
    paddingVertical: 0,
    backgroundColor: 'transparent',
  },
  loaderLabel: {
    flexShrink: 1,
    textAlign: 'center',
  },
  loaderLabelCompact: {
    textAlign: 'left',
  },
});
