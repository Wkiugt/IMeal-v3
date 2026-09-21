import { Easing } from 'react-native';
export type SurfaceRole = 0 | 1 | 2 | 3 | 4;

export type SemanticTone =
  | 'information'
  | 'success'
  | 'warning'
  | 'critical'
  | 'neutral';

export const designTokens = {
  color: {
    brand: {
      primary: '#005EA8',
      secondary: '#78BDF2',
      soft: '#DCEEFF',
      tint: '#F1F8FF',
    },
    background: { page: '#F4F8FC' },
    surface: {
      standard: '#FFFFFF',
      elevated: '#FBFDFF',
      glass: 'rgba(248,252,255,0.74)',
      glassFallback: 'rgba(248,252,255,0.94)',
      brand: '#005EA8',
    },
    text: {
      strong: '#172033',
      secondary: '#475569',
      tertiary: '#64748B',
      onBrand: '#FFFFFF',
    },
    border: {
      standard: '#D7E2EC',
      subtle: 'rgba(23,32,51,0.08)',
      selected: '#2F80ED',
      glassHighlight: 'rgba(255,255,255,0.72)',
      disabled: '#E5EAF0',
    },
    divider: '#E7EDF3',
    disabled: { fill: '#E8EEF4', text: '#8A97A7' },
    semantic: {
      information: { base: '#075EA8', tint: '#EAF4FF' },
      success: { base: '#137A48', tint: '#E7F7EE' },
      warning: { base: '#8A5700', tint: '#FFF3D6' },
      critical: { base: '#B4232C', tint: '#FDEBEC' },
      neutral: { base: '#526174', tint: '#EEF2F6' },
    },
    scrim: 'rgba(15,23,42,0.52)',
  },
  typography: {
    family: {
      regular: 'BeVietnamPro_400Regular',
      medium: 'BeVietnamPro_500Medium',
      semiBold: 'BeVietnamPro_600SemiBold',
      bold: 'BeVietnamPro_700Bold',
      mono: 'monospace',
    },
    pageTitle: { fontSize: 28, lineHeight: 34, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.3 },
    heroTitle: { fontSize: 32, lineHeight: 38, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.4 },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.2 },
    cardTitle: { fontSize: 17, lineHeight: 23, fontFamily: 'BeVietnamPro_600SemiBold' },
    body: { fontSize: 15, lineHeight: 22, fontFamily: 'BeVietnamPro_400Regular' },
    supporting: { fontSize: 13, lineHeight: 19, fontFamily: 'BeVietnamPro_400Regular' },
    caption: { fontSize: 12, lineHeight: 16, fontFamily: 'BeVietnamPro_400Regular' },
    eyebrow: { fontSize: 11, lineHeight: 15, fontFamily: 'BeVietnamPro_600SemiBold', letterSpacing: 0.8 },
    buttonLabel: { fontSize: 15, lineHeight: 20, fontFamily: 'BeVietnamPro_600SemiBold' },
    badgeLabel: { fontSize: 12, lineHeight: 16, fontFamily: 'BeVietnamPro_600SemiBold' },
    metric: { fontSize: 32, lineHeight: 38, fontFamily: 'BeVietnamPro_700Bold', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    monoCaption: { fontSize: 12, lineHeight: 16, fontFamily: 'monospace' },
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40, '5xl': 48 },
  radius: { smallControl: 8, inputButton: 12, chip: 10, card: 16, heroCard: 20, floating: 24, full: 999 },
  size: {
    touchMin: 44,
    controlSm: 36,
    controlMd: 44,
    controlLg: 48,
    avatarSm: 40,
    avatarLg: 64,
    qr: 200,
    qrFrame: 232,
    navMinHeight: 60,
    primaryCtaMinHeight: 84,
  },
  border: {
    standard: { width: 1, color: '#D7E2EC' },
    subtle: { width: 1, color: 'rgba(23,32,51,0.08)' },
    selected: { width: 1.5, color: '#2F80ED' },
    glass: { width: 1, color: 'rgba(255,255,255,0.72)' },
    disabled: { width: 1, color: '#E5EAF0' },
  },
  elevation: {
    level0: { offset: { width: 0, height: 0 }, opacity: 0, radius: 0, android: 0 },
    level1: { offset: { width: 0, height: 1 }, opacity: 0.05, radius: 3, android: 1 },
    level2: { offset: { width: 0, height: 6 }, opacity: 0.09, radius: 16, android: 4 },
    level3: { offset: { width: 0, height: 12 }, opacity: 0.12, radius: 28, android: 8 },
    level4: { offset: { width: 0, height: 18 }, opacity: 0.16, radius: 40, android: 12 },
  },
  motion: {
    duration: { instant: 80, fast: 140, standard: 220, emphasized: 320, shimmerCycle: 1400 },
    easing: {
      standard: Easing.bezier(0.2, 0, 0, 1),
      emphasized: Easing.bezier(0.16, 1, 0.3, 1),
      linear: Easing.linear,
    },
    spring: { stiffness: 280, damping: 26, mass: 0.8 },
    distance: { micro: 4, entrance: 8, overlay: 12 },
    pressScale: { card: 0.985, button: 0.98, compact: 0.96 },
  },
  camera: {
    background: '#050b16',
    scrim: 'rgba(5,11,22,0.45)',
    guide: 'rgba(255,255,255,0.88)',
    textSecondary: 'rgba(255,255,255,0.78)',
    textMuted: 'rgba(255,255,255,0.72)',
  },
} as const;

export const semanticToneMap = {
  information: { foreground: designTokens.color.semantic.information.base, tint: designTokens.color.semantic.information.tint, icon: 'Info' },
  success: { foreground: designTokens.color.semantic.success.base, tint: designTokens.color.semantic.success.tint, icon: 'CheckCircle2' },
  warning: { foreground: designTokens.color.semantic.warning.base, tint: designTokens.color.semantic.warning.tint, icon: 'Clock3' },
  critical: { foreground: designTokens.color.semantic.critical.base, tint: designTokens.color.semantic.critical.tint, icon: 'XCircle' },
  neutral: { foreground: designTokens.color.semantic.neutral.base, tint: designTokens.color.semantic.neutral.tint, icon: 'MinusCircle' },
} as const satisfies Record<SemanticTone, { foreground: string; tint: string; icon: string }>;

export function getElevationStyle(level: Exclude<SurfaceRole, 0>) {
  const token = designTokens.elevation[`level${level}`];
  return {
    shadowColor: designTokens.color.text.strong,
    shadowOffset: token.offset,
    shadowOpacity: token.opacity,
    shadowRadius: token.radius,
    elevation: token.android,
  } as const;
}
