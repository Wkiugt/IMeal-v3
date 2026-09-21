import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Pause, XCircle } from 'lucide-react-native';
import {
  designTokens,
  semanticToneMap,
  type SemanticTone,
} from '../designTokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { TranslationKey } from '../../i18n/translations';
import { useReducedMotion } from '../useReducedMotion';
import { ActionButton } from './Controls';
import { AppText, Avatar } from './Foundation';
import { QrSkeleton } from './Feedback';
import { ProgressMeter, StatusBadge, StatusDot, type StatusDotStatus } from './Indicators';

export type QrTicketState = 'loading' | 'active' | 'refreshing' | 'paused' | 'expired' | 'invalid';

export type QrTicketProps = {
  state: QrTicketState;
  value?: string;
  ownerName: string;
  ownerId: string;
  mealLabel: string;
  mealTypeLabel: string;
  selectedCount: number;
  secondsRemaining: number;
  totalSeconds: number;
  onRetry: () => void;
  onToggleActive: () => void;
  style?: StyleProp<ViewStyle>;
};

const stateLabelKeys: Record<QrTicketState, TranslationKey> = {
  loading: 'pickup.generatingQr',
  active: 'pickup.ticketActive',
  refreshing: 'pickup.refreshingCode',
  paused: 'pickup.ticketPaused',
  expired: 'pickup.ticketExpired',
  invalid: 'pickup.ticketInvalid',
};

const stateTones: Record<QrTicketState, SemanticTone> = {
  loading: 'information',
  active: 'success',
  refreshing: 'information',
  paused: 'neutral',
  expired: 'critical',
  invalid: 'critical',
};

const stateDots: Record<QrTicketState, StatusDotStatus> = {
  loading: 'pending',
  active: 'active',
  refreshing: 'pending',
  paused: 'paused',
  expired: 'expired',
  invalid: 'expired',
};

const announcedStates: Record<QrTicketState, boolean> = {
  loading: false,
  active: true,
  refreshing: false,
  paused: true,
  expired: true,
  invalid: true,
};

export function QrTicket({
  state,
  value,
  ownerName,
  ownerId,
  mealLabel,
  mealTypeLabel,
  selectedCount,
  secondsRemaining,
  totalSeconds,
  onRetry,
  onToggleActive,
  style,
}: QrTicketProps) {
  const reduceMotion = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const { t } = useLanguage();
  const previousState = useRef<QrTicketState | null>(null);
  const qrOpacity = useRef(new Animated.Value(state === 'active' ? 1 : 0.82)).current;
  const qrScale = useRef(new Animated.Value(state === 'active' ? 1 : 0.995)).current;
  const ownerInitials = ownerName
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const tone = stateTones[state];
  const statusLabel = t(stateLabelKeys[state]);
  const safeSeconds = Number.isFinite(secondsRemaining) ? Math.max(0, secondsRemaining) : 0;
  const hasQr = Boolean(value) && (state === 'active' || state === 'refreshing');
  const ticketAccessibilityLabel = `${t('pickup.title')}: ${mealLabel}; ${ownerName}; ${t('pickup.selectedCount', { count: selectedCount })}; ${t('pickup.expires', { seconds: safeSeconds })}`;

  useEffect(() => {
    const previous = previousState.current;
    if (previous !== null && previous !== state && announcedStates[state]) {
      void AccessibilityInfo.announceForAccessibility(statusLabel);
    }
    previousState.current = state;
  }, [state, statusLabel]);

  useEffect(() => {
    if (reduceMotion) {
      qrOpacity.setValue(state === 'active' ? 1 : state === 'refreshing' ? 0.82 : 0);
      qrScale.setValue(state === 'active' ? 1 : state === 'refreshing' ? 0.995 : 1);
      return;
    }

    const targetOpacity = state === 'active' ? 1 : state === 'refreshing' ? 0.82 : 0;
    const targetScale = state === 'active' ? 1 : state === 'refreshing' ? 0.995 : 1;
    Animated.parallel([
      Animated.timing(qrOpacity, {
        toValue: targetOpacity,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
      Animated.timing(qrScale, {
        toValue: targetScale,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]).start();
  }, [qrOpacity, qrScale, reduceMotion, state, value]);

  return (
    <View style={[styles.ticket, style]}>
      <View style={[styles.ticketHeader, compactLayout && styles.ticketHeaderCompact]}>
        <View style={styles.ticketStatus}>
          <StatusDot status={stateDots[state]} label={statusLabel} />
          <StatusBadge label={statusLabel} tone={tone} />
        </View>
        <AppText variant="supporting" tone="tertiary" style={styles.mealTypeLabel}>
          {mealTypeLabel}
        </AppText>
      </View>

      <View style={styles.qrFrame} accessible accessibilityLabel={ticketAccessibilityLabel}>
        {state === 'loading' || (state === 'refreshing' && !hasQr) ? (
          <QrSkeleton size={designTokens.size.qr} />
        ) : hasQr ? (
          <Animated.View style={{ opacity: qrOpacity, transform: [{ scale: qrScale }] }}>
            <QRCode
              value={value ?? ''}
              size={designTokens.size.qr}
              color={designTokens.color.text.strong}
              backgroundColor={designTokens.color.surface.standard}
            />
          </Animated.View>
        ) : state === 'paused' ? (
          <View style={[styles.qrStateTile, { backgroundColor: semanticToneMap.neutral.tint }]}>
            <Pause color={semanticToneMap.neutral.foreground} size={34} strokeWidth={1.8} />
            <AppText variant="supporting" tone="neutral" style={styles.qrStateLabel}>
              {statusLabel}
            </AppText>
          </View>
        ) : (
          <View style={[styles.qrStateTile, { backgroundColor: semanticToneMap.critical.tint }]}>
            <XCircle color={semanticToneMap.critical.foreground} size={34} strokeWidth={1.8} />
            <AppText variant="supporting" tone="critical" style={styles.qrStateLabel}>
              {statusLabel}
            </AppText>
          </View>
        )}
      </View>

      <View style={styles.identityRow}>
        <Avatar initials={ownerInitials || 'ME'} size="sm" accessibilityLabel={ownerName} />
        <View style={styles.identityCopy}>
          <AppText variant="cardTitle" tone="strong">
            {ownerName}
          </AppText>
          <AppText variant="monoCaption" tone="tertiary">
            {ownerId || '—'}
          </AppText>
        </View>
      </View>

      <View style={styles.metadata}>
        <View style={[styles.metadataRow, compactLayout && styles.metadataRowCompact]}>
          <AppText variant="supporting" tone="secondary">
            {t('pickup.meal')}
          </AppText>
          <AppText variant="supporting" tone="strong">
            {mealLabel}
          </AppText>
        </View>
        <View style={[styles.metadataRow, compactLayout && styles.metadataRowCompact]}>
          <AppText variant="supporting" tone="secondary">
            {t('common.selected')}
          </AppText>
          <AppText variant="supporting" tone="strong">
            {t('pickup.selectedCount', { count: selectedCount })}
          </AppText>
        </View>
      </View>

      <QrRefreshIndicator
        state={state === 'invalid' ? 'expired' : state === 'loading' ? 'refreshing' : state}
        secondsRemaining={secondsRemaining}
        totalSeconds={totalSeconds}
        label={state === 'loading' ? t('pickup.generatingQr') : state === 'refreshing' ? t('pickup.refreshingCode') : t('pickup.codeRefreshesIn', { seconds: safeSeconds })}
      />

      <View style={styles.actions}>
        {(state === 'active' || state === 'refreshing') ? (
          <ActionButton
            variant="secondary"
            size="md"
            label={t('pickup.pauseTicket')}
            onPress={onToggleActive}
            disabled={state === 'refreshing'}
            style={styles.action}
          />
        ) : state === 'paused' ? (
          <ActionButton
            variant="primary"
            size="md"
            label={t('pickup.reactivateTicket')}
            onPress={onToggleActive}
            style={styles.action}
          />
        ) : state === 'expired' || state === 'invalid' ? (
          <ActionButton
            variant="secondary"
            size="md"
            label={t('pickup.retryQr')}
            onPress={onRetry}
            style={styles.action}
          />
        ) : null}
      </View>
    </View>
  );
}

export type QrRefreshIndicatorState = 'active' | 'refreshing' | 'paused' | 'expired';

export type QrRefreshIndicatorProps = {
  state: QrRefreshIndicatorState;
  secondsRemaining: number;
  totalSeconds: number;
  label: string;
  style?: StyleProp<ViewStyle>;
};

export function QrRefreshIndicator({
  state,
  secondsRemaining,
  totalSeconds,
  label,
  style,
}: QrRefreshIndicatorProps) {
  const { t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const tone: SemanticTone = state === 'active'
    ? 'success'
    : state === 'refreshing'
      ? 'information'
      : state === 'expired'
        ? 'critical'
        : 'neutral';
  const safeSeconds = Number.isFinite(secondsRemaining) ? Math.max(0, secondsRemaining) : 0;
  const countdownLabel = `${label}, ${t('pickup.expires', { seconds: safeSeconds })}`;

  return (
    <View style={[styles.refreshIndicator, style]}>
      <View style={[styles.refreshIndicatorHeader, compactLayout && styles.refreshIndicatorHeaderCompact]}>
        <AppText variant="caption" tone={tone}>
          {label}
        </AppText>
        <AppText variant="caption" tone="tertiary">
          {safeSeconds}s
        </AppText>
      </View>
      <ProgressMeter
        value={safeSeconds}
        max={totalSeconds}
        tone={tone}
        size="sm"
        label={countdownLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: {
    width: '100%',
    padding: designTokens.space.xl,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface.standard,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
  },
  ticketHeader: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  ticketHeaderCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  mealTypeLabel: {
    flexShrink: 1,
  },
  ticketStatus: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: designTokens.space.sm,
  },
  qrFrame: {
    width: designTokens.size.qrFrame,
    height: designTokens.size.qrFrame,
    alignSelf: 'center',
    marginTop: designTokens.space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.inputButton,
    backgroundColor: designTokens.color.surface.standard,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
  },
  qrStateTile: {
    width: designTokens.size.qr,
    height: designTokens.size.qr,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.sm,
  },
  qrStateLabel: {
    textAlign: 'center',
    paddingHorizontal: designTokens.space.lg,
  },
  identityRow: {
    marginTop: designTokens.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.md,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  metadata: {
    marginTop: designTokens.space.lg,
    gap: designTokens.space.sm,
  },
  metadataRow: {
    minHeight: designTokens.size.controlSm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  metadataRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  refreshIndicator: {
    minHeight: 52,
    marginTop: designTokens.space.lg,
    gap: designTokens.space.xs,
  },
  refreshIndicatorHeader: {
    minHeight: designTokens.size.controlSm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.sm,
  },
  refreshIndicatorHeaderCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  actions: {
    marginTop: designTokens.space.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  action: {
    minWidth: 150,
  },
});
