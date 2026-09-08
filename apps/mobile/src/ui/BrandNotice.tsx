import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react-native';
import { theme } from '../theme';
import { useReducedMotion } from './useReducedMotion';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export type ShowNoticeInput = {
  title: string;
  message: string;
  tone?: NoticeTone;
  durationMs?: number;
};

type NoticeContextValue = {
  showNotice: (input: ShowNoticeInput) => void;
  dismissNotice: () => void;
};

const NoticeContext = createContext<NoticeContextValue | null>(null);

const toneStyles: Record<NoticeTone, { tint: string; deep: string; icon: typeof Info }> = {
  info: { tint: theme.colors.accentTint, deep: theme.colors.accentDeep, icon: Info },
  success: { tint: theme.colors.statusGoodTint, deep: theme.colors.statusGoodDeep, icon: CheckCircle2 },
  warning: { tint: theme.colors.statusWarnTint, deep: theme.colors.statusWarnDeep, icon: AlertTriangle },
  error: { tint: theme.colors.statusBadTint, deep: theme.colors.statusBadDeep, icon: XCircle },
};

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<ShowNoticeInput | null>(null);
  const [visibleNotice, setVisibleNotice] = useState<ShowNoticeInput | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const reduceMotion = useReducedMotion();
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismissNotice = useCallback(() => {
    clearTimeout(dismissTimer.current);
    if (!visibleNotice) return;
    if (reduceMotion) {
      setNotice(null);
      setVisibleNotice(null);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -8, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        setNotice(null);
        setVisibleNotice(null);
      }
    });
  }, [opacity, reduceMotion, translateY, visibleNotice]);

  const showNotice = useCallback((input: ShowNoticeInput) => {
    clearTimeout(dismissTimer.current);
    setNotice(input);
    setVisibleNotice(input);
  }, []);

  useEffect(() => {
    if (!notice) return;
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
    } else {
      opacity.setValue(0);
      translateY.setValue(-8);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }

    void AccessibilityInfo.announceForAccessibility(`${notice.title}. ${notice.message}`);
    const duration = notice.durationMs ?? (notice.tone === 'warning' || notice.tone === 'error' ? 0 : 4000);
    if (duration > 0) {
      dismissTimer.current = setTimeout(dismissNotice, duration);
    }
    return () => {
      clearTimeout(dismissTimer.current);
    };
  }, [dismissNotice, notice, opacity, reduceMotion, translateY]);

  const tone = visibleNotice?.tone || 'info';
  const palette = toneStyles[tone];
  const Icon = palette.icon;
  const value = React.useMemo(() => ({ showNotice, dismissNotice }), [dismissNotice, showNotice]);

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
                <Icon size={19} color={palette.deep} strokeWidth={1.8} />
              </View>
              <View style={styles.copy}>
                <Text style={styles.title}>{visibleNotice.title}</Text>
                <Text style={styles.message}>{visibleNotice.message}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notification"
                onPress={dismissNotice}
                style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
              >
                <X size={19} color={theme.colors.muted} strokeWidth={1.8} />
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
  noticeSurface: { width: '100%', maxWidth: 390, alignSelf: 'center', paddingHorizontal: theme.spacing.gutter, paddingTop: 8 },
  card: { minHeight: 72, padding: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'flex-start', gap: 11, ...theme.shadows.md },
  iconWrap: { width: 34, height: 34, borderRadius: theme.radii.sm, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 },
  title: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  message: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -1, marginRight: -7 },
  dismissPressed: { opacity: 0.65 },
});
