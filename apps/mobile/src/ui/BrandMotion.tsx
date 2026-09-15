import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme';
import { useReducedMotion } from './useReducedMotion';
import { shouldAnimateScreenEntrance } from './screenEntranceState';

const MOTION_DURATION_MS = 260;

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
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={theme.colors.accentDeep}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M6 3v9a3 3 0 0 0 6 0V3M9 8.5V3" />
        <Path d="M17.5 3c-1.4 1.4-2 3-2 5.2 0 1.8.9 2.8 2 3.3V21" />
      </Svg>
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
            duration: 450,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.04,
            duration: 450,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0.6,
            duration: 450,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.96,
            duration: 450,
            easing: Easing.inOut(Easing.cubic),
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
      <Text style={[styles.loaderLabel, compact && styles.loaderLabelCompact]}>
        {label}
      </Text>
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
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 8)).current;

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
    translateY.setValue(8);
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: MOTION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: MOTION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
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
    translateY.setValue(8);
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: MOTION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: MOTION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
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
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accentSoft,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 28,
    backgroundColor: theme.colors.bg,
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
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  loaderLabelCompact: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'left',
  },
});
