import React from 'react';
import {
  BlurView,
  type BlurViewProps,
} from 'expo-blur';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  designTokens,
  getElevationStyle,
  semanticToneMap,
  type SemanticTone,
  type SurfaceRole,
} from '../designTokens';

export type AppTextVariant = Exclude<keyof typeof designTokens.typography, 'family'>;
export type AppTextTone =
  | 'strong'
  | 'secondary'
  | 'tertiary'
  | 'onBrand'
  | SemanticTone;

export type AppTextProps = TextProps & {
  variant: AppTextVariant;
  tone?: AppTextTone;
};

function resolveTextColor(tone: AppTextTone): string {
  if (tone in semanticToneMap) {
    return semanticToneMap[tone as SemanticTone].foreground;
  }

  return designTokens.color.text[tone as keyof typeof designTokens.color.text];
}

export function AppText({ variant, tone = 'strong', style, ...props }: AppTextProps) {
  const recipe = designTokens.typography[variant] as TextStyle;

  return <Text {...props} style={[recipe, { color: resolveTextColor(tone) }, style]} />;
}

type SurfaceBaseProps = Omit<ViewProps, 'children' | 'style'> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export type SurfaceProps = SurfaceBaseProps & {
  level?: Exclude<SurfaceRole, 3>;
  selected?: boolean;
  padding?: keyof typeof designTokens.space;
};

export function Surface({
  children,
  level = 1,
  selected = false,
  padding = 'xl',
  style,
  ...props
}: SurfaceProps) {
  const isSelected = selected || level === 2;

  return (
    <View
      {...props}
      style={[
        styles.surface,
        { padding: designTokens.space[padding] },
        level === 0 && styles.surfaceLevel0,
        level === 1 && styles.surfaceLevel1,
        level === 2 && styles.surfaceLevel2,
        level === 4 && styles.surfaceLevel4,
        isSelected && styles.surfaceSelected,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type GlassSurfaceProps = Omit<ViewProps, 'children' | 'style'> & {
  children: React.ReactNode;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
};


export function GlassSurface({
  children,
  intensity = 64,
  style,
  ...props
}: GlassSurfaceProps) {
  const sharedStyle = [styles.glassSurface, getElevationStyle(3), style];

  if (Platform.OS === 'ios' || Platform.OS === 'web') {
    return (
      <BlurView
        {...(props as BlurViewProps)}
        intensity={intensity}
        tint="light"
        style={sharedStyle}
      >
        {children}
      </BlurView>
    );
  }

  return (
    <View {...props} style={[sharedStyle, styles.glassFallback]}>
      {children}
    </View>
  );
}

export type FloatingSurfaceProps = GlassSurfaceProps;

export function FloatingSurface({ children, style, ...props }: FloatingSurfaceProps) {
  return (
    <GlassSurface {...props} style={[styles.floatingSurface, style]}>
      {children}
    </GlassSurface>
  );
}

export type DividerProps = {
  inset?: number;
  orientation?: 'horizontal' | 'vertical';
  style?: StyleProp<ViewStyle>;
};

export function Divider({ inset = 0, orientation = 'horizontal', style }: DividerProps) {
  return (
    <View
      accessible={false}
      style={[
        orientation === 'horizontal' ? styles.dividerHorizontal : styles.dividerVertical,
        orientation === 'horizontal'
          ? { marginHorizontal: inset }
          : { marginVertical: inset },
        style,
      ]}
    />
  );
}

export type AvatarProps = Omit<ViewProps, 'children' | 'style'> & {
  initials: string;
  size?: 'sm' | 'lg';
  style?: StyleProp<ViewStyle>;
};

export function Avatar({
  initials,
  size = 'sm',
  accessibilityLabel,
  style,
  ...props
}: AvatarProps) {
  const resolvedLabel = accessibilityLabel ?? initials;

  return (
    <View
      {...props}
      accessible
      accessibilityRole="image"
      accessibilityLabel={resolvedLabel}
      style={[styles.avatar, size === 'lg' && styles.avatarLarge, style]}
    >
      <AppText variant={size === 'lg' ? 'cardTitle' : 'supporting'} tone="strong" style={styles.avatarText}>
        {initials}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: designTokens.radius.card,
  },
  surfaceLevel0: {
    backgroundColor: 'transparent',
  },
  surfaceLevel1: {
    backgroundColor: designTokens.color.surface.standard,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.border.standard.color,
    ...getElevationStyle(1),
  },
  surfaceLevel2: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.border.selected.color,
    ...getElevationStyle(1),
  },
  surfaceLevel4: {
    minHeight: designTokens.size.primaryCtaMinHeight,
    backgroundColor: designTokens.color.surface.brand,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    borderTopColor: designTokens.color.border.glassHighlight,
    ...getElevationStyle(2),
  },
  surfaceSelected: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.border.selected.color,
  },
  glassSurface: {
    overflow: 'hidden',
    borderRadius: designTokens.radius.floating,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    backgroundColor: designTokens.color.surface.glass,
    ...getElevationStyle(3),
  },
  glassFallback: {
    backgroundColor: designTokens.color.surface.glassFallback,
  },
  floatingSurface: {
    borderRadius: designTokens.radius.floating,
  },
  dividerHorizontal: {
    height: 1,
    backgroundColor: designTokens.color.divider,
  },
  dividerVertical: {
    width: 1,
    backgroundColor: designTokens.color.divider,
  },
  avatar: {
    width: designTokens.size.avatarSm,
    height: designTokens.size.avatarSm,
    borderRadius: designTokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.brand.soft,
  },
  avatarLarge: {
    width: designTokens.size.avatarLg,
    height: designTokens.size.avatarLg,
  },
  avatarText: {
    textAlign: 'center',
  },
});
