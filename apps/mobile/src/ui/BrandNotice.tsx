import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react-native';
import { designTokens, getElevationStyle, semanticToneMap, type SemanticTone } from './designTokens';
import { useReducedMotion } from './useReducedMotion';
import { useLanguage } from '../i18n/LanguageProvider';
import { AppText } from './components';
export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export type ShowNoticeInput = {
  title: string;
  message: string;
  tone?: NoticeTone;
};

type NoticeContextValue = {
  showNotice: (input: ShowNoticeInput) => void;
  dismissNotice: () => void;
};

const NoticeContext = createContext<NoticeContextValue | null>(null);

const toneSemanticMap: Record<NoticeTone, SemanticTone> = {
  info: 'information',
  success: 'success',
  warning: 'warning',
  error: 'critical',
};

const toneIcons: Record<NoticeTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const noticeTimeoutMs: Record<NoticeTone, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 6000,
};

type CurrentNotice = {
  input: ShowNoticeInput;
  generation: number;
};

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [notice, setNotice] = useState<CurrentNotice | null>(null);
  const [visibleNotice, setVisibleNotice] = useState<ShowNoticeInput | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-designTokens.motion.distance.entrance)).current;
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  const dismissTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const noticeGeneration = useRef(0);
  reduceMotionRef.current = reduceMotion;

  const stopAnimations = useCallback(() => {
    opacity.stopAnimation();
    translateY.stopAnimation();
  }, [opacity, translateY]);

  const dismissGeneration = useCallback((generation: number) => {
    if (generation !== noticeGeneration.current) return;
    clearTimeout(dismissTimer.current);
    stopAnimations();

    if (reduceMotionRef.current) {
      setNotice(null);
      setVisibleNotice(null);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: designTokens.motion.duration.standard, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -designTokens.motion.distance.entrance, duration: designTokens.motion.duration.standard, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && generation === noticeGeneration.current) {
        setNotice(null);
        setVisibleNotice(null);
      }
    });
  }, [opacity, stopAnimations, translateY]);

  const dismissNotice = useCallback(() => {
    if (notice) dismissGeneration(notice.generation);
  }, [dismissGeneration, notice]);

  const showNotice = useCallback((input: ShowNoticeInput) => {
    const generation = noticeGeneration.current + 1;
    noticeGeneration.current = generation;
    clearTimeout(dismissTimer.current);
    stopAnimations();
    setNotice({ input, generation });
    setVisibleNotice(input);
  }, [stopAnimations]);

  useEffect(() => {
    if (!notice) return;
    const { input, generation } = notice;

    stopAnimations();
    if (reduceMotionRef.current) {
      opacity.setValue(1);
      translateY.setValue(0);
    } else {
      opacity.setValue(0);
      translateY.setValue(-designTokens.motion.distance.entrance);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: designTokens.motion.duration.standard, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: designTokens.motion.duration.standard, useNativeDriver: true }),
      ]).start();
    }

    void AccessibilityInfo.announceForAccessibility(`${input.title}. ${input.message}`);
    const tone = input.tone ?? 'info';
    dismissTimer.current = setTimeout(() => dismissGeneration(generation), noticeTimeoutMs[tone]);

    return () => {
      clearTimeout(dismissTimer.current);
      stopAnimations();
    };
  }, [dismissGeneration, notice, opacity, stopAnimations, translateY]);

  const value = React.useMemo(() => ({ showNotice, dismissNotice }), [dismissNotice, showNotice]);
  const tone = visibleNotice?.tone ?? 'info';
  const palette = semanticToneMap[toneSemanticMap[tone]];
  const Icon = toneIcons[tone];

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {visibleNotice && (
        <SafeAreaView pointerEvents="box-none" style={styles.overlay} edges={['top']}>
          <View pointerEvents="box-none" style={styles.noticeSurface}>
            <Animated.View
              accessibilityRole="alert"
              accessibilityLiveRegion={tone === 'warning' || tone === 'error' ? 'assertive' : 'polite'}
              style={[styles.card, { opacity, transform: [{ translateY }] }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: palette.tint }]}>
                <Icon size={19} color={palette.foreground} strokeWidth={1.8} />
              </View>
              <View style={styles.copy}>
                <AppText variant="cardTitle" tone="strong">{visibleNotice.title}</AppText>
                <AppText variant="supporting" tone="secondary">{visibleNotice.message}</AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('notice.dismiss')}
                onPress={dismissNotice}
                style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
              >
                <X size={19} color={designTokens.color.text.secondary} strokeWidth={1.8} />
              </Pressable>
            </Animated.View>
          </View>
        </SafeAreaView>
      )}
    </NoticeContext.Provider>
  );
}

export function useNotice(): NoticeContextValue {
  const context = useContext(NoticeContext);
  if (!context) throw new Error('useNotice must be used within NoticeProvider');
  return context;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  noticeSurface: { width: '100%', maxWidth: 390, alignSelf: 'center', paddingHorizontal: designTokens.space['2xl'], paddingTop: 8 },
  card: { minHeight: 72, padding: 14, borderWidth: 1, borderColor: designTokens.color.border.standard, borderRadius: designTokens.radius.heroCard, backgroundColor: designTokens.color.surface.standard, flexDirection: 'row', alignItems: 'flex-start', gap: 11, ...getElevationStyle(2) },
  iconWrap: { width: 34, height: 34, borderRadius: designTokens.radius.smallControl, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -1, marginRight: -7 },
  dismissPressed: { opacity: 0.65 },
});
